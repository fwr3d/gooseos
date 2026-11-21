// Whiteboard app: pen, highlighter, eraser, shapes, text, multiple boards.
// Boards are saved through the shared store as items of app "whiteboard":
//   { name, bg, strokes, created }
// Each stroke is { t, c, w, p: [x, y, ...], s? } in board coordinates.
// Pan/zoom position is kept per device only (localStorage), so it doesn't sync.
import { svg } from "../../icons.js";

const APP = "whiteboard";

const TOOLS = [["hand", "Move (Space)", "hand"], ["pen", "Pen (P)", "pencil"], ["hl", "Highlighter (H)", "highlighter"], ["eraser", "Eraser (E)", "eraser"], ["sep"],
  ["line", "Line (L)", "slash"], ["arrow", "Arrow (A)", "moveUpRight"], ["rect", "Rectangle (R)", "square"], ["ell", "Circle (O)", "circle"], ["text", "Text (T)", "type"]];
const KEYMAP = { v: "hand", p: "pen", h: "hl", e: "eraser", l: "line", a: "arrow", r: "rect", o: "ell", t: "text" };
const COLORS = ["ink", "#2f5bea", "#e5484d", "#22a45d", "#f2a20c", "#8b5cf6", "#0ea5b7", "#ec4899"];
const HL_COLORS = ["#ffe45c", "#7ee08a", "#7cc8ff", "#ff9ec3", "#ffb35c"];
const SIZES = [2, 4, 8];
const BGS = [["dots", "Dots"], ["grid", "Grid"], ["lines", "Lined"], ["blank", "Blank"]];

const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const rnd = v => Math.round(v * 10) / 10;
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const textSize = w => (w === 2 ? 22 : w === 4 ? 32 : 48);
const clampZ = z => Math.min(6, Math.max(0.15, z));
const measure = document.createElement("canvas").getContext("2d");

let ctx0;          // shell context: { store, toast, isActive }
let root;          // this app's container
const $ = s => root.querySelector(s);

let boards = [];   // [{ id, name, bg, strokes, created }]
let board = null;
let view = { x: 0, y: 0, z: 1 };
let undoStack = [], redoStack = [];
let tool = "pen", color = "ink", hlColor = "#ffe45c", size = 4;
let cv, cx, stage, W = 0, H = 0, dpr = 1;
let live = null, raf = 0, textBox = null;
let saveT = null;

/* ---------- boards ---------- */
function newBoard(name) {
  return { id: "b-" + uid(), name: name || "Board " + (boards.length + 1), bg: "dots", strokes: [], created: Date.now() };
}
async function loadBoards() {
  const rows = await ctx0.store.list(APP);
  boards = rows.map(r => ({ id: r.id, ...r.data })).filter(b => Array.isArray(b.strokes))
    .sort((a, b) => (a.created || 0) - (b.created || 0));
  if (!boards.length) { const b = newBoard("Board 1"); boards.push(b); await ctx0.store.put(APP, b.id, dataOf(b)); }
  const lastId = lsGet("wb-last");
  board = boards.find(b => b.id === (board && board.id)) || boards.find(b => b.id === lastId) || boards[0];
  loadView();
}
const dataOf = b => ({ name: b.name, bg: b.bg, strokes: b.strokes, created: b.created });
function save(now) {
  setStatus("saving");
  clearTimeout(saveT);
  const b = board;
  const go = () => ctx0.store.put(APP, b.id, dataOf(b)).then(() => setStatus("saved")).catch(() => setStatus("error"));
  if (now) go(); else saveT = setTimeout(go, 400);
}
function setStatus(s) {
  const el = $("#wb-status"); if (!el) return;
  el.innerHTML = s === "error" ? svg("cloudOff") : s === "saving" ? svg("refreshCw") : svg("check");
  el.title = s === "error" ? "Couldn't save" : s === "saving" ? "Saving…" : "Saved";
}

function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
function loadView() {
  try { const v = JSON.parse(lsGet("wb-view-" + board.id) || "null"); view = v && v.z ? v : { x: 0, y: 0, z: 1 }; } catch (e) { view = { x: 0, y: 0, z: 1 }; }
  lsSet("wb-last", board.id);
}
let viewT = null;
function saveView() { clearTimeout(viewT); viewT = setTimeout(() => lsSet("wb-view-" + board.id, JSON.stringify(view)), 400); }

function renderBar() {
  $("#wb-board-name").textContent = board.name;
  updateUndo(); updateZoom();
}
function switchTo(b) { commitText(); board = b; undoStack = []; redoStack = []; loadView(); renderBar(); redraw(); }

/* ---------- undo ---------- */
function snapshot() { undoStack.push(JSON.stringify(board.strokes)); if (undoStack.length > 60) undoStack.shift(); redoStack = []; updateUndo(); }
function undo() { if (!undoStack.length) return; commitText(); redoStack.push(JSON.stringify(board.strokes)); board.strokes = JSON.parse(undoStack.pop()); redraw(); save(); updateUndo(); }
function redo() { if (!redoStack.length) return; undoStack.push(JSON.stringify(board.strokes)); board.strokes = JSON.parse(redoStack.pop()); redraw(); save(); updateUndo(); }
function updateUndo() { $("#wb-undo").disabled = !undoStack.length; $("#wb-redo").disabled = !redoStack.length; }

/* ---------- drawing ---------- */
const toWorld = (sx, sy) => [(sx - view.x) / view.z, (sy - view.y) / view.z];
function resize() {
  const r = stage.getBoundingClientRect();
  if (!r.width || !r.height) return;
  dpr = window.devicePixelRatio || 1; W = r.width; H = r.height;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); redraw();
}
function drawBg(c, v, w, h, bgCol, dotCol, bg) {
  c.fillStyle = bgCol; c.fillRect(0, 0, w, h);
  if (bg === "blank") return;
  const step = 32 * v.z; if (step < 8) return;
  const ox = ((v.x % step) + step) % step, oy = ((v.y % step) + step) % step;
  c.fillStyle = dotCol; c.strokeStyle = dotCol; c.lineWidth = 1;
  if (bg === "dots") { const r = Math.max(1, 1.3 * Math.min(v.z, 1.4)); for (let x = ox; x < w; x += step) for (let y = oy; y < h; y += step) { c.beginPath(); c.arc(x, y, r, 0, 7); c.fill(); } }
  else if (bg === "grid") { c.beginPath(); for (let x = ox; x < w; x += step) { c.moveTo(Math.round(x) + .5, 0); c.lineTo(Math.round(x) + .5, h); } for (let y = oy; y < h; y += step) { c.moveTo(0, Math.round(y) + .5); c.lineTo(w, Math.round(y) + .5); } c.stroke(); }
  else if (bg === "lines") { c.beginPath(); for (let y = oy; y < h; y += step) { c.moveTo(0, Math.round(y) + .5); c.lineTo(w, Math.round(y) + .5); } c.stroke(); }
}
function drawStroke(c, s, ink) {
  const p = s.p; c.lineCap = "round"; c.lineJoin = "round";
  c.globalAlpha = s.t === "hl" ? 0.38 : 1;
  c.strokeStyle = c.fillStyle = s.c === "ink" ? ink : s.c;
  c.lineWidth = s.t === "hl" ? s.w * 5 : s.w;
  if (s.t === "pen" || s.t === "hl") {
    c.beginPath(); c.moveTo(p[0], p[1]);
    if (p.length === 2) c.lineTo(p[0] + .01, p[1]);
    else { for (let i = 2; i < p.length - 2; i += 2) { const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2; c.quadraticCurveTo(p[i], p[i + 1], mx, my); } c.lineTo(p[p.length - 2], p[p.length - 1]); }
    c.stroke();
  } else if (s.t === "line" || s.t === "arrow") {
    c.beginPath(); c.moveTo(p[0], p[1]); c.lineTo(p[2], p[3]); c.stroke();
    if (s.t === "arrow") {
      const a = Math.atan2(p[3] - p[1], p[2] - p[0]), L = Math.max(10, s.w * 3.5);
      c.beginPath(); c.moveTo(p[2] - L * Math.cos(a - .45), p[3] - L * Math.sin(a - .45)); c.lineTo(p[2], p[3]); c.lineTo(p[2] - L * Math.cos(a + .45), p[3] - L * Math.sin(a + .45)); c.stroke();
    }
  } else if (s.t === "rect") {
    const x = Math.min(p[0], p[2]), y = Math.min(p[1], p[3]), w = Math.abs(p[2] - p[0]), h = Math.abs(p[3] - p[1]);
    c.beginPath(); if (c.roundRect) c.roundRect(x, y, w, h, 4); else c.rect(x, y, w, h); c.stroke();
  } else if (s.t === "ell") {
    c.beginPath(); c.ellipse((p[0] + p[2]) / 2, (p[1] + p[3]) / 2, Math.abs(p[2] - p[0]) / 2, Math.abs(p[3] - p[1]) / 2, 0, 0, 7); c.stroke();
  } else if (s.t === "text") {
    c.font = `500 ${textSize(s.w)}px ${css("--f-hand") || "cursive"}`; c.textBaseline = "top";
    String(s.s).split("\n").forEach((ln, i) => c.fillText(ln, p[0], p[1] + i * textSize(s.w) * 1.15));
  }
  c.globalAlpha = 1;
}
function redraw() {
  if (!W || !board) return;
  cx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawBg(cx, view, W, H, css("--board"), css("--board-dot"), board.bg);
  const ink = css("--ink");
  cx.setTransform(dpr * view.z, 0, 0, dpr * view.z, dpr * view.x, dpr * view.y);
  for (const s of board.strokes) drawStroke(cx, s, ink);
  if (live) drawStroke(cx, live, ink);
  $("#wb-hint").hidden = board.strokes.length > 0 || !!live;
}
const req = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(); }); };

/* ---------- geometry ---------- */
function textBox_(s) { measure.font = `500 ${textSize(s.w)}px ${css("--f-hand")}`; const ls = String(s.s).split("\n"); return { w: Math.max(...ls.map(l => measure.measureText(l).width)), h: ls.length * textSize(s.w) * 1.15 }; }
function boundsOf(strokes) {
  let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity;
  for (const s of strokes) {
    const p = s.p; let ex = 0, ey = 0;
    if (s.t === "text") { const bb = textBox_(s); ex = bb.w; ey = bb.h; }
    const pad = s.t === "hl" ? s.w * 2.5 : s.w / 2;
    for (let i = 0; i < p.length; i += 2) { a = Math.min(a, p[i] - pad); b = Math.min(b, p[i + 1] - pad); c = Math.max(c, p[i] + ex + pad); d = Math.max(d, p[i + 1] + ey + pad); }
  }
  return isFinite(a) ? { x: a, y: b, w: c - a, h: d - b } : null;
}
function segDist(px, py, ax, ay, bx, by) { const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy; let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); }
function hits(s, x, y, r) {
  const p = s.p, pad = r + (s.t === "hl" ? s.w * 2.5 : s.w / 2);
  if (s.t === "pen" || s.t === "hl") { if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) < pad; for (let i = 0; i < p.length - 2; i += 2) if (segDist(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) < pad) return true; return false; }
  if (s.t === "line" || s.t === "arrow") return segDist(x, y, p[0], p[1], p[2], p[3]) < pad;
  if (s.t === "rect") { const [a, b, c, d] = p; return segDist(x, y, a, b, c, b) < pad || segDist(x, y, c, b, c, d) < pad || segDist(x, y, c, d, a, d) < pad || segDist(x, y, a, d, a, b) < pad; }
  if (s.t === "ell") {
    const ccx = (p[0] + p[2]) / 2, ccy = (p[1] + p[3]) / 2, rx = Math.abs(p[2] - p[0]) / 2 || 1, ry = Math.abs(p[3] - p[1]) / 2 || 1;
    for (let i = 0; i < 48; i++) { const a1 = i / 48 * Math.PI * 2, a2 = (i + 1) / 48 * Math.PI * 2; if (segDist(x, y, ccx + rx * Math.cos(a1), ccy + ry * Math.sin(a1), ccx + rx * Math.cos(a2), ccy + ry * Math.sin(a2)) < pad) return true; }
    return false;
  }
  if (s.t === "text") { const b = textBox_(s); return x > p[0] - r && x < p[0] + b.w + r && y > p[1] - r && y < p[1] + b.h + r; }
  return false;
}

/* ---------- pointer input ---------- */
const pointers = new Map();
let mode = null, start = null, pinch = null, erasedAny = false, spaceDown = false;
function local(e) { const r = stage.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
const coalesced = e => { const list = e.getCoalescedEvents ? e.getCoalescedEvents() : []; return list.length ? list : [e]; };
function onDown(e) {
  if (e.target.closest(".wb-dock,.wb-zoom,.wb-text-in")) return;
  closeMenu();
  stage.setPointerCapture(e.pointerId);
  const [sx, sy] = local(e); pointers.set(e.pointerId, [sx, sy]);
  if (pointers.size === 2) {
    live = null; mode = "pinch";
    const [a, b] = [...pointers.values()];
    pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, cx: (a[0] + b[0]) / 2, cy: (a[1] + b[1]) / 2, v: { ...view } };
    req(); return;
  }
  if (pointers.size > 2) return;
  commitText();
  const [wx, wy] = toWorld(sx, sy);
  if (e.button === 1 || e.button === 2 || spaceDown || tool === "hand") { mode = "pan"; start = { sx, sy, vx: view.x, vy: view.y }; stage.classList.add("panning"); e.preventDefault(); return; }
  if (tool === "text") { openText(sx, sy, wx, wy); mode = null; return; }
  if (tool === "eraser") { mode = "erase"; erasedAny = false; eraseAt(wx, wy); return; }
  mode = "draw";
  if (tool === "pen" || tool === "hl") live = { t: tool, c: tool === "hl" ? hlColor : color, w: size, p: [rnd(wx), rnd(wy)] };
  else live = { t: tool, c: color, w: size, p: [rnd(wx), rnd(wy), rnd(wx), rnd(wy)] };
  req();
}
function onMove(e) {
  if (!pointers.has(e.pointerId)) return;
  const [sx, sy] = local(e); pointers.set(e.pointerId, [sx, sy]);
  if (mode === "pinch" && pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a[0] - b[0], a[1] - b[1]), mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
    const z = clampZ(pinch.v.z * d / pinch.d), wx = (pinch.cx - pinch.v.x) / pinch.v.z, wy = (pinch.cy - pinch.v.y) / pinch.v.z;
    view = { x: mx - wx * z, y: my - wy * z, z }; updateZoom(); req(); return;
  }
  if (mode === "pan") { view.x = start.vx + (sx - start.sx); view.y = start.vy + (sy - start.sy); req(); return; }
  if (mode === "erase") { for (const ce of coalesced(e)) { const [a, b] = local(ce); const [x, y] = toWorld(a, b); eraseAt(x, y); } return; }
  if (mode === "draw" && live) {
    if (live.t === "pen" || live.t === "hl") {
      for (const ce of coalesced(e)) { const [a, b] = local(ce); const [x, y] = toWorld(a, b); const p = live.p; if (Math.hypot(x - p[p.length - 2], y - p[p.length - 1]) * view.z > 1.5) p.push(rnd(x), rnd(y)); }
    } else {
      let [x, y] = toWorld(sx, sy); const p = live.p;
      if (e.shiftKey) {
        if (live.t === "rect" || live.t === "ell") { const d = Math.max(Math.abs(x - p[0]), Math.abs(y - p[1])); x = p[0] + Math.sign(x - p[0] || 1) * d; y = p[1] + Math.sign(y - p[1] || 1) * d; }
        else { const a = Math.round(Math.atan2(y - p[1], x - p[0]) / (Math.PI / 4)) * (Math.PI / 4), r = Math.hypot(x - p[0], y - p[1]); x = p[0] + r * Math.cos(a); y = p[1] + r * Math.sin(a); }
      }
      p[2] = rnd(x); p[3] = rnd(y);
    }
    req();
  }
}
function onUp(e) {
  if (!pointers.has(e.pointerId)) return; pointers.delete(e.pointerId);
  if (mode === "pinch") { if (pointers.size === 0) { mode = null; saveView(); } return; }
  if (mode === "pan") { stage.classList.remove("panning"); mode = null; saveView(); return; }
  if (mode === "erase") { if (erasedAny) save(); mode = null; return; }
  if (mode === "draw" && live) {
    const p = live.p, tiny = (live.t !== "pen" && live.t !== "hl") && Math.hypot(p[2] - p[0], p[3] - p[1]) * view.z < 4;
    if (!tiny) { snapshot(); board.strokes.push(live); save(); }
    live = null; req();
  }
  mode = null;
}
function eraseAt(x, y) {
  const r = 10 / view.z, before = board.strokes.length;
  const keep = board.strokes.filter(s => !hits(s, x, y, r));
  if (keep.length !== before) { if (!erasedAny) snapshot(); erasedAny = true; board.strokes = keep; req(); }
}

/* ---------- zoom ---------- */
function zoomAt(sx, sy, f) { const z = clampZ(view.z * f), wx = (sx - view.x) / view.z, wy = (sy - view.y) / view.z; view = { x: sx - wx * z, y: sy - wy * z, z }; updateZoom(); req(); saveView(); }
function updateZoom() { const el = $("#wb-zlvl"); if (el) el.textContent = Math.round(view.z * 100) + "%"; }
function fit() {
  const bb = boundsOf(board.strokes), top = 64, bottom = 120;
  if (!bb) view = { x: 0, y: 0, z: 1 };
  else {
    const pad = 40, z = clampZ(Math.min((W - pad * 2) / Math.max(bb.w, 1), (H - top - bottom - pad) / Math.max(bb.h, 1), 2));
    view = { x: W / 2 - (bb.x + bb.w / 2) * z, y: top + (H - top - bottom) / 2 - (bb.y + bb.h / 2) * z, z };
  }
  updateZoom(); req(); saveView();
}

/* ---------- text ---------- */
function openText(sx, sy, wx, wy) {
  const inp = document.createElement("textarea"); inp.className = "wb-text-in"; inp.rows = 1;
  inp.style.left = sx + "px"; inp.style.top = sy + "px"; inp.style.fontSize = textSize(size) * view.z + "px";
  inp.style.color = color === "ink" ? "var(--ink)" : color; inp.setAttribute("aria-label", "Type text");
  stage.appendChild(inp);
  const grow = () => { inp.style.height = "auto"; inp.style.height = inp.scrollHeight + "px"; inp.style.width = "auto"; inp.style.width = Math.max(60, inp.scrollWidth + 8) + "px"; };
  inp.addEventListener("input", grow); grow();
  inp.addEventListener("keydown", e => { if (e.key === "Escape") { inp.value = ""; commitText(); } else if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); } });
  inp.addEventListener("blur", () => setTimeout(commitText, 0));
  textBox = { el: inp, wx, wy, c: color, w: size };
  setTimeout(() => inp.focus(), 0);
}
function commitText() {
  if (!textBox) return; const tb = textBox; textBox = null;
  const v = tb.el.value.replace(/\s+$/, ""); tb.el.remove();
  if (v) { snapshot(); board.strokes.push({ t: "text", c: tb.c, w: tb.w, p: [rnd(tb.wx), rnd(tb.wy)], s: v }); save(); req(); }
}

/* ---------- tool dock ---------- */
function drawStyles() {
  const cols = tool === "hl" ? HL_COLORS : COLORS, cur = tool === "hl" ? hlColor : color;
  $("#wb-styles").innerHTML = cols.map(c => `<button class="wb-sw" data-color="${c}" aria-label="Color ${c === "ink" ? "black" : c}" aria-pressed="${c === cur}" style="background:${c === "ink" ? "var(--ink)" : c}"></button>`).join("") +
    `<span class="wb-sep"></span>` + SIZES.map(s => `<button class="wb-sz" data-size="${s}" aria-label="Size ${s}" aria-pressed="${s === size}"><i style="width:${s + 3}px;height:${s + 3}px"></i></button>`).join("");
  $("#wb-styles").hidden = tool === "hand" || tool === "eraser";
}
function setTool(t) {
  commitText(); tool = t;
  root.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", b.dataset.tool === t));
  stage.className = "wb-stage " + (t === "hand" ? "pan" : t === "eraser" ? "erase" : t === "text" ? "text" : "draw");
  drawStyles();
}

/* ---------- menus ---------- */
let menuEl = null;
function closeMenu() { if (menuEl) { menuEl.remove(); menuEl = null; } }
function openMenu(anchor, html, wire) {
  closeMenu();
  const m = document.createElement("div"); m.className = "wb-menu"; m.setAttribute("role", "menu"); m.innerHTML = html;
  root.appendChild(m); menuEl = m;
  const r = anchor.getBoundingClientRect(), rr = root.getBoundingClientRect();
  m.style.top = (r.bottom - rr.top + 6) + "px";
  const left = Math.min(Math.max(8, r.left - rr.left), rr.width - m.offsetWidth - 8);
  m.style.left = left + "px";
  wire(m);
}
function boardMenu(anchor) {
  const html = `<div class="wb-mlabel">Boards</div>` +
    boards.map(b => `<button class="wb-mi ${b.id === board.id ? "on" : ""}" data-b="${b.id}">${svg(b.id === board.id ? "check" : "layers")}<span class="grow">${esc(b.name)}</span></button>`).join("") +
    `<div class="wb-msep"></div>
     <button class="wb-mi" data-act="new">${svg("plus")}<span class="grow">New board</span></button>
     <button class="wb-mi" data-act="rename">${svg("pencilLine")}<span class="grow">Rename “${esc(board.name)}”</span></button>
     <button class="wb-mi danger" data-act="delete">${svg("trash2")}<span class="grow">Delete “${esc(board.name)}”</span></button>`;
  openMenu(anchor, html, m => {
    m.querySelectorAll("[data-b]").forEach(b => b.onclick = () => { closeMenu(); switchTo(boards.find(x => x.id === b.dataset.b)); });
    m.querySelector('[data-act="new"]').onclick = () => { closeMenu(); const b = newBoard(); boards.push(b); switchTo(b); save(true); ctx0.toast(`Made “${b.name}”`); };
    m.querySelector('[data-act="rename"]').onclick = () => {
      m.innerHTML = `<div class="wb-mlabel">Rename board</div><form class="wb-rename"><input value="${esc(board.name)}" maxlength="60" aria-label="Board name"></form>
        <div class="wb-ask-row"><button class="pill-btn secondary" data-no>Cancel</button><button class="pill-btn" data-yes>Save</button></div>`;
      const inp = m.querySelector("input"); inp.focus(); inp.select();
      const ok = () => { const v = inp.value.trim(); if (v) { board.name = v; save(true); renderBar(); } closeMenu(); };
      m.querySelector("form").onsubmit = e => { e.preventDefault(); ok(); };
      m.querySelector("[data-yes]").onclick = ok; m.querySelector("[data-no]").onclick = closeMenu;
    };
    m.querySelector('[data-act="delete"]').onclick = () => {
      m.innerHTML = `<div class="wb-ask">Delete “${esc(board.name)}” on all your devices? This can't be undone.</div>
        <div class="wb-ask-row"><button class="pill-btn secondary" data-no>Cancel</button><button class="pill-btn danger" data-yes>Delete</button></div>`;
      m.querySelector("[data-no]").onclick = closeMenu;
      m.querySelector("[data-yes]").onclick = async () => {
        closeMenu();
        const gone = board; await ctx0.store.remove(APP, gone.id);
        boards = boards.filter(b => b !== gone);
        if (!boards.length) { const b = newBoard("Board 1"); boards.push(b); await ctx0.store.put(APP, b.id, dataOf(b)); }
        switchTo(boards[0]); ctx0.toast(`Deleted “${gone.name}”`);
      };
    };
  });
}
function moreMenu(anchor) {
  const html = `<div class="wb-mlabel">Background</div>
    <div class="wb-seg">${BGS.map(([v, l]) => `<button data-bg="${v}" aria-pressed="${board.bg === v}">${l}</button>`).join("")}</div>
    <div class="wb-msep"></div>
    <button class="wb-mi" data-act="fit">${svg("maximize2")}<span class="grow">Fit drawing to screen</span></button>
    <button class="wb-mi" data-act="export">${svg("imageDown")}<span class="grow">Save as image</span></button>
    <button class="wb-mi danger" data-act="clear">${svg("brushCleaning")}<span class="grow">Clear board</span></button>`;
  openMenu(anchor, html, m => {
    m.querySelectorAll("[data-bg]").forEach(b => b.onclick = () => {
      board.bg = b.dataset.bg; redraw(); save();
      m.querySelectorAll("[data-bg]").forEach(x => x.setAttribute("aria-pressed", x === b));
    });
    m.querySelector('[data-act="fit"]').onclick = () => { closeMenu(); fit(); };
    m.querySelector('[data-act="export"]').onclick = () => { closeMenu(); exportImage(); };
    m.querySelector('[data-act="clear"]').onclick = () => {
      if (!board.strokes.length) { closeMenu(); ctx0.toast("This board is already empty."); return; }
      m.innerHTML = `<div class="wb-ask">Erase everything on “${esc(board.name)}”? Undo brings it back.</div>
        <div class="wb-ask-row"><button class="pill-btn secondary" data-no>Cancel</button><button class="pill-btn danger" data-yes>Clear</button></div>`;
      m.querySelector("[data-no]").onclick = closeMenu;
      m.querySelector("[data-yes]").onclick = () => { closeMenu(); snapshot(); board.strokes = []; redraw(); save(); ctx0.toast("Cleared. Undo brings it back."); };
    };
  });
}

/* ---------- save as image ---------- */
function renderTo(c, strokes, bg, w, h, pad) {
  const bb = boundsOf(strokes);
  const v = bb ? (() => { const z = Math.min((w - pad * 2) / Math.max(bb.w, 1), (h - pad * 2) / Math.max(bb.h, 1), 3); return { x: w / 2 - (bb.x + bb.w / 2) * z, y: h / 2 - (bb.y + bb.h / 2) * z, z }; })() : { x: 0, y: 0, z: 1 };
  c.setTransform(1, 0, 0, 1, 0, 0);
  drawBg(c, v, w, h, css("--board"), css("--board-dot"), bg);
  c.setTransform(v.z, 0, 0, v.z, v.x, v.y);
  const ink = css("--ink"); for (const s of strokes) drawStroke(c, s, ink);
  c.setTransform(1, 0, 0, 1, 0, 0);
}
async function exportImage() {
  commitText(); const bb = boundsOf(board.strokes); if (!bb) { ctx0.toast("Draw something first."); return; }
  const scale = 2, w = Math.ceil((bb.w + 80) * scale), h = Math.ceil((bb.h + 80) * scale);
  if (w * h > 40e6) { ctx0.toast("This board is too big to save as one image."); return; }
  const oc = document.createElement("canvas"); oc.width = w; oc.height = h;
  renderTo(oc.getContext("2d"), board.strokes, board.bg, w, h, 40 * scale);
  const blob = await new Promise(r => oc.toBlob(r, "image/png"));
  if (!blob) { ctx0.toast("Couldn't make the image."); return; }
  const name = (board.name || "whiteboard").replace(/[^\w\- ]+/g, "").trim() + ".png";
  const file = new File([blob], name, { type: "image/png" });
  if (matchMedia("(pointer: coarse)").matches && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); } catch (e) { /* closed the share sheet */ }
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ---------- markup ---------- */
const MARKUP = () => `
  <div class="wb-bar">
    <button class="wb-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button>
    <button class="wb-board" id="wb-board" aria-haspopup="menu"><span id="wb-board-name"></span>${svg("chevronDown")}</button>
    <span class="wb-spacer"></span>
    <span class="wb-status" id="wb-status" aria-live="polite"></span>
    <button class="icon-btn" id="wb-undo" aria-label="Undo" title="Undo (Ctrl+Z)">${svg("undo2")}</button>
    <button class="icon-btn" id="wb-redo" aria-label="Redo" title="Redo (Ctrl+Shift+Z)">${svg("redo2")}</button>
    <button class="icon-btn" id="wb-more" aria-label="More" aria-haspopup="menu">${svg("ellipsis")}</button>
  </div>
  <div class="wb-stage draw" id="wb-stage">
    <canvas></canvas>
    <div class="wb-hint" id="wb-hint">Draw anything<small>Pinch or Ctrl + scroll to zoom · Space + drag to move</small></div>
    <div class="wb-zoom surface">
      <button class="icon-btn" id="wb-zout" aria-label="Zoom out">${svg("minus")}</button><span id="wb-zlvl">100%</span><button class="icon-btn" id="wb-zin" aria-label="Zoom in">${svg("plus")}</button>
    </div>
    <div class="wb-dock">
      <div class="wb-styles surface" id="wb-styles"></div>
      <div class="wb-tools surface" id="wb-tools">${TOOLS.map(([id, label, ic]) => id === "sep" ? `<span class="wb-sep"></span>` :
        `<button class="wb-tool" data-tool="${id}" aria-label="${label}" title="${label}" aria-pressed="${id === tool}">${svg(ic)}</button>`).join("")}</div>
    </div>
  </div>`;

/* ---------- app interface ---------- */
let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./whiteboard.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.innerHTML = MARKUP();
  stage = $("#wb-stage"); cv = stage.querySelector("canvas"); cx = cv.getContext("2d");

  stage.addEventListener("pointerdown", onDown);
  stage.addEventListener("pointermove", onMove);
  stage.addEventListener("pointerup", onUp);
  stage.addEventListener("pointercancel", onUp);
  stage.addEventListener("contextmenu", e => e.preventDefault());
  stage.addEventListener("wheel", e => {
    e.preventDefault(); const [sx, sy] = local(e);
    if (e.ctrlKey || e.metaKey) zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0025));
    else { view.x -= e.deltaX; view.y -= e.deltaY; req(); saveView(); }
  }, { passive: false });
  new ResizeObserver(() => { if (ctx0.isActive()) resize(); }).observe(stage);

  $("#wb-tools").addEventListener("click", e => { const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool); });
  $("#wb-styles").addEventListener("click", e => {
    const c = e.target.closest("[data-color]"), s = e.target.closest("[data-size]");
    if (c) { if (tool === "hl") hlColor = c.dataset.color; else color = c.dataset.color; drawStyles(); }
    if (s) { size = +s.dataset.size; drawStyles(); }
  });
  $("#wb-undo").onclick = undo; $("#wb-redo").onclick = redo;
  $("#wb-zin").onclick = () => zoomAt(W / 2, H / 2, 1.25);
  $("#wb-zout").onclick = () => zoomAt(W / 2, H / 2, 0.8);
  $("#wb-board").onclick = e => { e.stopPropagation(); menuEl ? closeMenu() : boardMenu(e.currentTarget); };
  $("#wb-more").onclick = e => { e.stopPropagation(); menuEl ? closeMenu() : moreMenu(e.currentTarget); };
  document.addEventListener("pointerdown", e => { if (menuEl && !menuEl.contains(e.target) && !e.target.closest("#wb-board,#wb-more")) closeMenu(); });

  document.addEventListener("keydown", e => {
    if (!ctx0.isActive() || e.target.matches("input,textarea,select")) return;
    const k = e.key.toLowerCase();
    if (k === "escape") { closeMenu(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === "y") { e.preventDefault(); redo(); return; }
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "Space") { if (!spaceDown) { spaceDown = true; stage.classList.add("pan"); } e.preventDefault(); return; }
    if (KEYMAP[k]) setTool(KEYMAP[k]);
    if (k === "0") fit();
    if (k === "=" || k === "+") zoomAt(W / 2, H / 2, 1.25);
    if (k === "-") zoomAt(W / 2, H / 2, 0.8);
  });
  document.addEventListener("keyup", e => { if (e.code === "Space" && spaceDown) { spaceDown = false; setTool(tool); } });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => redraw());

  // boards changed on another device
  ctx.store.onChange(async ch => {
    if (ch.app !== APP || ch.source !== "remote") return;
    const curId = board && board.id, wasEditing = mode || textBox;
    const keepStrokes = wasEditing ? board.strokes : null;
    await loadBoards();
    if (board.id !== curId) { undoStack = []; redoStack = []; }
    else if (ch.ids.includes(curId)) { if (keepStrokes) board.strokes = keepStrokes; else { undoStack = []; redoStack = []; } }
    renderBar(); redraw();
  });

  await loadBoards();
  renderBar(); setTool("pen"); setStatus("saved");
  if (document.fonts) document.fonts.ready.then(() => redraw());
}

function show() { requestAnimationFrame(resize); }
function hide() { commitText(); closeMenu(); }

/* ---------- home-screen widget: preview of the latest board ---------- */
async function widget(el, ctx) {
  loadCss();
  const rows = await ctx.store.list(APP);
  const latest = rows.filter(r => r.data && Array.isArray(r.data.strokes)).sort((a, b) => b.updated - a.updated)[0];
  const ago = latest ? timeAgo(latest.updated) : "";
  el.innerHTML = `<div class="w-k">${ctx.svg("presentation")}Whiteboard</div>
    <div class="w-thumb">${latest && latest.data.strokes.length ? "<canvas></canvas>" : `<div class="w-empty">Tap to draw</div>`}</div>
    <div class="w-title">${esc(latest ? latest.data.name : "Board 1")}</div>
    ${ago ? `<div class="w-sub">Edited ${ago}</div>` : ""}`;
  const c = el.querySelector("canvas");
  if (!c) return;
  requestAnimationFrame(() => {
    const r = c.getBoundingClientRect(), d = window.devicePixelRatio || 1;
    if (!r.width) return;
    c.width = Math.round(r.width * d); c.height = Math.round(r.height * d);
    renderTo(c.getContext("2d"), latest.data.strokes, "blank", c.width, c.height, 10 * d);
  });
}
function timeAgo(t) {
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default { id: APP, name: "Whiteboard", icon: "presentation", tint: "teal", dock: true, mount, show, hide, widget };
