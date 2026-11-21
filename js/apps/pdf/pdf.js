// PDF editor: open a PDF, write on it with a pen, highlighter or text boxes,
// then save a filled-in copy as a new PDF (for Gradescope, Brightspace, forms).
//
// The PDF itself is a file from js/files.js (Transfer, a milestone, or added here
// with scope "pdf"). Your marks are saved separately, so the original never changes
// and you can come back and keep going:
//   app "pdf", id <file id>: { pages: { "<n>": { strokes: [...], texts: [...] } }, updated, doc?, ref? }
//     doc, ref: the notes panel's doc and whether it's open (js/notes-panel.js)
//     stroke: { t: "pen" | "hl", c: color, w: width (pt), p: [x, y, x, y, ...] (pt from the top left) }
//     text:   { id, x, y (pt, top left), s: size (pt), c: color, v: text }
// "Save as PDF" draws each page and your marks into an image and builds a new PDF (makepdf.js).
import * as store from "../../store.js";
import * as files from "../../files.js";
import { svg } from "../../icons.js";
import { makePdf } from "./makepdf.js";
import { notesPanel, notesButton } from "../../notes-panel.js";

const APP = "pdf";
const COLORS = ["#111827", "#2f5bea", "#e5484d", "#22a45d"];
const HL = "#ffe45c";
const PEN_W = 1.6, HL_W = 12, TEXT_S = 12;
const EXPORT_SCALE = 2;   // 144 dpi: sharp enough to read, small enough to upload
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const r1 = n => Math.round(n * 10) / 10;

let pdfjsP = null;
function pdfjs() {
  if (!pdfjsP) pdfjsP = import("../../vendor/pdfjs/pdf.min.mjs").then(m => { m.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href; return m; });
  return pdfjsP;
}

/* ---------- state for the open document ---------- */
let ctx0, root, $ = s => root.querySelector(s);
let task = null, doc = null, fileId = null, meta = null, marks = null, pages = [];   // pages: [{ n, vp (scale 1), wrap, pdfC, inkC, texts, rendered }]
let zoom = 1, tool = "pen", color = COLORS[0], undo = [], saveT = null, observer = null, loadToken = 0, notes = null;
const isTouch = matchMedia("(pointer: coarse)").matches;

const pageData = n => (marks.pages[n] ||= { strokes: [], texts: [] });
function snapshot(n) { undo.push({ n, before: JSON.stringify(pageData(n)) }); if (undo.length > 100) undo.shift(); updateUndo(); }
function updateUndo() { const b = $("#pf-undo"); if (b) b.disabled = !undo.length; }
/** What gets saved: empty text boxes are left out (unless you're typing in one right now). */
function savable() {
  const typing = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.tid : null;
  const out = {};
  for (const [n, d] of Object.entries(marks.pages)) out[n] = { strokes: d.strokes, texts: d.texts.filter(t => t.v.trim() || t.id === typing) };
  return out;
}
function saveNow() { if (fileId && marks) return store.put(APP, fileId, { pages: savable(), updated: Date.now(), ...(marks.doc ? { doc: marks.doc } : {}), ...(marks.ref ? { ref: true } : {}) }); }
function persist() { clearTimeout(saveT); saveT = setTimeout(saveNow, 700); }

/* ---------- list of PDFs ---------- */
async function renderList() {
  cleanup();
  $("#pf-title").textContent = "PDF editor";
  $("#pf-tools").hidden = true; $("#pf-back").hidden = true; root.querySelector("[data-home]").hidden = false;
  notes.paint();
  const all = (await files.list()).filter(files.isPdf);
  const marked = new Set((await store.list(APP)).filter(r => r.data && r.data.pages && Object.values(r.data.pages).some(p => p.strokes.length || p.texts.length)).map(r => r.id));
  const where = f => f.scope === "transfer" ? "Transfer" : f.scope === "milestone" ? "Milestones" : "Added here";
  $("#pf-main").innerHTML = `<div class="ap-body">
    <label class="ap-card pf-drop" tabindex="0"><input type="file" id="pf-pick" accept="application/pdf,.pdf" hidden>
      <span class="pf-drop-ic">${svg("filePen")}</span><b>Open a PDF</b><span>Drop one here or tap to choose. Write on it, then save a filled-in copy.</span></label>
    <section class="ap-sec"><h3>Your PDFs<span class="n">${all.length}</span></h3>
      ${all.length ? `<div class="ap-card">${all.map(f => `<button class="ap-row pf-item" data-open-pdf="${esc(f.id)}">
          <span class="pf-ic">${svg("fileText")}</span><span class="grow"><span class="t">${esc(f.name)}</span><span class="s">${esc([where(f), files.sizeText(f.size), marked.has(f.id) ? "has your marks" : ""].filter(Boolean).join(" · "))}</span></span>${svg("chevronRight")}</button>`).join("")}</div>`
        : `<div class="ap-card"><div class="ap-empty"><b>No PDFs yet</b>Open one above, send one with Transfer, or attach one to a milestone.</div></div>`}
    </section></div>`;
  $("#pf-pick").onchange = e => { const f = e.target.files[0]; e.target.value = ""; if (f) addAndOpen(f); };
}

async function addAndOpen(file) {
  if (!files.isPdf(file)) { ctx0.toast("That's not a PDF."); return; }
  try { const f = await files.add(file, { scope: "pdf" }); go(f.id); }
  catch (e) { ctx0.toast(files.errorText(e)); }
}

/* ---------- open one ---------- */
async function openDoc(id) {
  cleanup();
  const token = ++loadToken;
  fileId = id; meta = await files.get(id);
  $("#pf-back").hidden = false; root.querySelector("[data-home]").hidden = true;
  if (!meta) { $("#pf-main").innerHTML = `<div class="ap-body"><div class="ap-card"><div class="ap-empty"><b>That PDF isn't here anymore</b>It may have been deleted on another device.</div></div></div>`; return; }
  $("#pf-title").textContent = meta.name;
  $("#pf-main").innerHTML = `<div class="ap-body"><div class="ap-card"><div class="ap-empty"><b>Opening…</b>${esc(meta.name)}</div></div></div>`;
  let bytes;
  try { bytes = new Uint8Array(await (await files.blob(id)).arrayBuffer()); }
  catch (e) { $("#pf-main").innerHTML = `<div class="ap-body"><div class="ap-card"><div class="ap-empty"><b>Couldn't open it</b>${esc(files.errorText(e))}</div></div></div>`; return; }
  const lib = await pdfjs();
  try { task = lib.getDocument({ data: bytes }); doc = await task.promise; }
  catch (e) { $("#pf-main").innerHTML = `<div class="ap-body"><div class="ap-card"><div class="ap-empty"><b>Couldn't read this PDF</b>It might be damaged or password protected.</div></div></div>`; return; }
  if (token !== loadToken) return;
  const saved = await store.get(APP, id);
  marks = { pages: (saved && saved.pages) || {}, doc: saved && saved.doc, ref: !!(saved && saved.ref) };
  notes.paint();
  undo = []; updateUndo();
  $("#pf-tools").hidden = false;
  $("#pf-main").innerHTML = `<div class="pf-pages" id="pf-pages"></div>`;
  const box = $("#pf-pages");
  pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const pg = await doc.getPage(n);
    const vp = pg.getViewport({ scale: 1 });
    const wrap = document.createElement("div"); wrap.className = "pf-page"; wrap.dataset.n = n;
    wrap.innerHTML = `<canvas class="pf-pdf"></canvas><canvas class="pf-ink"></canvas><div class="pf-texts"></div><span class="pf-num">${n} / ${doc.numPages}</span>`;
    box.appendChild(wrap);
    pages.push({ n, pg, vp, wrap, pdfC: wrap.querySelector(".pf-pdf"), inkC: wrap.querySelector(".pf-ink"), textsEl: wrap.querySelector(".pf-texts"), rendered: 0 });
  }
  fitWidth();
  setTool(isTouch ? "hand" : "pen");
  observer = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) renderPage(pages[+e.target.dataset.n - 1]); }), { root: $("#pf-main"), rootMargin: "600px 0px" });
  pages.forEach(p => observer.observe(p.wrap));
}

function fitWidth() {
  const w = $("#pf-main").clientWidth - 24, widest = Math.max(...pages.map(p => p.vp.width));
  setZoom(Math.max(0.4, Math.min(2.5, w / widest)));
}
function setZoom(z) {
  zoom = Math.round(z * 100) / 100;
  for (const p of pages) {
    p.wrap.style.width = `${p.vp.width * zoom}px`; p.wrap.style.height = `${p.vp.height * zoom}px`;
    p.rendered = 0;
    if (p.wrap.getBoundingClientRect().top < innerHeight + 800) renderPage(p);
  }
  const lvl = $("#pf-zlvl"); if (lvl) lvl.textContent = `${Math.round(zoom * 100)}%`;
}

async function renderPage(p) {
  const want = zoom * (devicePixelRatio || 1);
  if (p.rendered === want) return;
  p.rendered = want;
  const vp = p.pg.getViewport({ scale: want });
  const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  try { await p.pg.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise; } catch (e) { p.rendered = 0; return; }
  if (p.rendered !== want) return;   // zoom changed while drawing
  p.pdfC.width = c.width; p.pdfC.height = c.height; p.pdfC.getContext("2d").drawImage(c, 0, 0);
  p.inkC.width = c.width; p.inkC.height = c.height;
  drawInk(p); drawTexts(p);
}

/* ---------- marks ---------- */
function strokePath(g, s, k) {
  const pts = s.p; if (pts.length < 2) return;
  g.save();
  g.lineCap = "round"; g.lineJoin = "round";
  g.strokeStyle = s.c; g.lineWidth = s.w * k;
  if (s.t === "hl") { g.globalAlpha = 0.38; g.globalCompositeOperation = "multiply"; g.lineCap = "butt"; }
  g.beginPath(); g.moveTo(pts[0] * k, pts[1] * k);
  if (pts.length === 2) g.lineTo(pts[0] * k + 0.01, pts[1] * k);
  for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i] * k, pts[i + 1] * k);
  g.stroke(); g.restore();
}
function drawInk(p) {
  const g = p.inkC.getContext("2d"), k = p.inkC.width / p.vp.width;
  g.clearRect(0, 0, p.inkC.width, p.inkC.height);
  for (const s of pageData(p.n).strokes) strokePath(g, s, k);
}
function drawTexts(p) {
  const list = pageData(p.n).texts;
  p.textsEl.innerHTML = list.map(t => `<textarea class="pf-text" data-tid="${t.id}" spellcheck="false" rows="1"
    style="left:${t.x * zoom}px;top:${t.y * zoom}px;font-size:${t.s * zoom}px;color:${t.c}">${esc(t.v)}</textarea>`).join("");
  p.textsEl.querySelectorAll("textarea").forEach(fit);
}
function fit(ta) { ta.style.height = "auto"; ta.style.width = "auto"; ta.style.height = ta.scrollHeight + "px"; ta.style.width = Math.max(40, ta.scrollWidth + 4) + "px"; }

function pagePoint(p, e) { const r = p.inkC.getBoundingClientRect(); return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]; }

function hitStroke(s, x, y, rad) {
  const pts = s.p, r = rad + s.w / 2;
  for (let i = 0; i < pts.length; i += 2) {
    const dx = pts[i] - x, dy = pts[i + 1] - y;
    if (dx * dx + dy * dy <= r * r) return true;
    if (i + 3 < pts.length) {   // and along the segment to the next point
      const ax = pts[i], ay = pts[i + 1], bx = pts[i + 2], by = pts[i + 3], L = (bx - ax) ** 2 + (by - ay) ** 2;
      if (L > 0) { const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / L)); const qx = ax + t * (bx - ax) - x, qy = ay + t * (by - ay) - y; if (qx * qx + qy * qy <= r * r) return true; }
    }
  }
  return false;
}

let live = null;   // { p, stroke } while drawing, { p, erased } while erasing
function onDown(e) {
  if (tool === "hand" && e.pointerType !== "pen") return;
  const wrap = e.target.closest(".pf-page"); if (!wrap) return;
  if (e.target.closest(".pf-text")) return;   // typing in a box
  const p = pages[+wrap.dataset.n - 1], [x, y] = pagePoint(p, e);
  const t = tool === "hand" ? "pen" : tool;   // a stylus draws even in hand mode
  if (t === "text") { e.preventDefault(); addText(p, x, y); return; }
  e.preventDefault();
  try { p.inkC.setPointerCapture(e.pointerId); } catch (err) { /* keep drawing without capture */ }
  snapshot(p.n);
  if (t === "eraser") { live = { p, erase: true }; eraseAt(p, x, y); return; }
  const stroke = { t: t === "hl" ? "hl" : "pen", c: t === "hl" ? HL : color, w: t === "hl" ? HL_W : PEN_W, p: [r1(x), r1(y)] };
  pageData(p.n).strokes.push(stroke);
  live = { p, stroke };
  drawInk(p);
}
function onMove(e) {
  if (!live) return;
  const [x, y] = pagePoint(live.p, e);
  if (live.erase) { eraseAt(live.p, x, y); return; }
  const pts = live.stroke.p, lx = pts[pts.length - 2], ly = pts[pts.length - 1];
  if ((x - lx) ** 2 + (y - ly) ** 2 < 0.25) return;
  if (live.stroke.t === "hl") { pts.push(r1(x), r1(y)); drawInk(live.p); return; }   // redraw so overlaps don't darken
  const g = live.p.inkC.getContext("2d"), k = live.p.inkC.width / live.p.vp.width;
  g.save(); g.strokeStyle = live.stroke.c; g.lineWidth = live.stroke.w * k; g.lineCap = "round"; g.lineJoin = "round";
  g.beginPath(); g.moveTo(lx * k, ly * k); g.lineTo(x * k, y * k); g.stroke(); g.restore();
  pts.push(r1(x), r1(y));
}
function onUp() {
  if (!live) return;
  const p = live.p; live = null;
  drawInk(p); persist();
}
function eraseAt(p, x, y) {
  const d = pageData(p.n), before = d.strokes.length;
  d.strokes = d.strokes.filter(s => !hitStroke(s, x, y, 6 / zoom));
  if (d.strokes.length !== before) drawInk(p);
}

function addText(p, x, y) {
  snapshot(p.n);
  const t = { id: uid(), x: r1(x), y: r1(Math.max(0, y - TEXT_S * 0.7)), s: TEXT_S, c: color, v: "" };
  pageData(p.n).texts.push(t);
  drawTexts(p);
  const ta = p.textsEl.querySelector(`[data-tid="${t.id}"]`); ta.focus();
}
function onTextInput(e) {
  const ta = e.target.closest(".pf-text"); if (!ta) return;
  const p = pages[+ta.closest(".pf-page").dataset.n - 1];
  const t = pageData(p.n).texts.find(x => x.id === ta.dataset.tid); if (!t) return;
  t.v = ta.value; fit(ta); persist();
}
function onTextBlur(e) {
  const ta = e.target.closest && e.target.closest(".pf-text"); if (!ta) return;
  const p = pages[+ta.closest(".pf-page").dataset.n - 1], d = pageData(p.n);
  if (!ta.value.trim()) { d.texts = d.texts.filter(x => x.id !== ta.dataset.tid); ta.remove(); persist(); }
}
function onTextTap(e) {
  if (tool !== "eraser") return;
  const ta = e.target.closest(".pf-text"); if (!ta) return;
  e.preventDefault();
  const p = pages[+ta.closest(".pf-page").dataset.n - 1];
  snapshot(p.n);
  const d = pageData(p.n); d.texts = d.texts.filter(x => x.id !== ta.dataset.tid);
  drawTexts(p); persist();
}

function setTool(t) {
  tool = t;
  root.querySelectorAll("[data-tool]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tool === t)));
  const box = $("#pf-pages"); if (box) box.dataset.tool = t;
  const hint = $("#pf-hint");
  if (hint) hint.textContent = t === "hand" ? "Scroll and zoom. A stylus still writes." : t === "text" ? "Tap where you want to type." : t === "eraser" ? "Drag over a mark to erase it. Tap a text box to delete it." : "";
}

/* ---------- save as PDF ---------- */
function wrapLines(g, text, maxW) {
  const out = [];
  for (const para of String(text).split("\n")) {
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const tryLine = line + word;
      if (line && g.measureText(tryLine).width > maxW) { out.push(line.trimEnd()); line = word.trimStart(); } else line = tryLine;
    }
    out.push(line);
  }
  return out;
}
async function exportPdf(btn) {
  if (!doc) return;
  btn.disabled = true; const label = btn.innerHTML;
  try {
    const out = [];
    for (const p of pages) {
      btn.textContent = `Page ${p.n} of ${pages.length}…`;
      const vp = p.pg.getViewport({ scale: EXPORT_SCALE });
      const c = document.createElement("canvas"); c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
      const g = c.getContext("2d");
      g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
      // "print" draws in one go instead of frame by frame, so it finishes even if you switch tabs
      await p.pg.render({ canvasContext: g, viewport: vp, intent: "print" }).promise;
      const k = c.width / p.vp.width, d = pageData(p.n);
      for (const s of d.strokes) strokePath(g, s, k);
      for (const t of d.texts) {
        if (!t.v.trim()) continue;
        g.save(); g.fillStyle = t.c; g.font = `${t.s * k}px Helvetica, Arial, sans-serif`; g.textBaseline = "top";
        const lh = t.s * 1.25 * k;
        wrapLines(g, t.v, (p.vp.width - t.x - 4) * k).forEach((ln, i) => g.fillText(ln, (t.x + 2) * k, (t.y + 2) * k + i * lh));
        g.restore();
      }
      const jpeg = new Uint8Array(await (await new Promise(r => c.toBlob(r, "image/jpeg", 0.88))).arrayBuffer());
      out.push({ jpeg, px: [c.width, c.height], pt: [p.vp.width, p.vp.height] });
    }
    const blob = makePdf(out);
    const name = meta.name.replace(/\.pdf$/i, "") + " (filled).pdf";
    exportSheet(blob, name);
  } catch (e) { console.error(e); ctx0.toast("Couldn't make the PDF. Try again."); }
  finally { btn.disabled = false; btn.innerHTML = label; }
}
function exportSheet(blob, name) {
  const back = document.createElement("div"); back.className = "ap-back";
  const forMs = meta.scope === "milestone" && meta.owner;
  back.innerHTML = `<div class="ap-sheet pf-sheet" role="dialog" aria-modal="true"><h2>Your PDF is ready</h2>
    <p class="note">${esc(name)} · ${files.sizeText(blob.size)}</p>
    <button class="pill-btn" data-x="dl">${svg("download")} Download</button>
    <button class="pill-btn secondary" data-x="send">${svg("arrowLeftRight")} Send to my other devices</button>
    ${forMs ? `<button class="pill-btn secondary" data-x="attach">${svg("paperclip")} Attach to the same milestone</button>` : ""}
    <div class="acts"><span></span><button class="pill-btn secondary" data-x="close">Done</button></div></div>`;
  root.appendChild(back);
  const close = () => back.remove();
  back.addEventListener("click", async e => {
    if (e.target === back) return close();
    const x = e.target.closest("[data-x]")?.dataset.x; if (!x) return;
    if (x === "close") return close();
    if (x === "dl") { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 20000); return; }
    try {
      const file = new File([blob], name, { type: "application/pdf" });
      if (x === "send") { await files.add(file, { scope: "transfer" }); ctx0.toast("Sent. It's in Transfer on your other devices."); }
      if (x === "attach") { await files.add(file, { scope: "milestone", owner: meta.owner }); ctx0.toast("Attached to the milestone."); }
      e.target.closest("[data-x]").disabled = true;
    } catch (err) { ctx0.toast(files.errorText(err)); }
  });
}

/* ---------- app plumbing ---------- */
function cleanup() {
  if (observer) { observer.disconnect(); observer = null; }
  if (saveT && fileId && marks) { clearTimeout(saveT); saveNow(); }
  saveT = null;
  if (task) { Promise.resolve(task.destroy()).catch(() => {}); task = null; }
  doc = null;
  pages = []; marks = null; fileId = null; live = null; undo = [];
}
function go(id) { history.replaceState(null, "", id ? `#${APP}/${encodeURIComponent(id)}` : `#${APP}`); return id ? openDoc(id) : renderList(); }

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./pdf.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap", "pf");
  el.innerHTML = `<div class="ap-bar">
      <button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button>
      <button class="ap-home" id="pf-back" hidden>${svg("chevronLeft")}PDFs</button>
      <span class="ap-title" id="pf-title">PDF editor</span><span class="ap-spacer"></span>
    </div>
    <div class="pf-tools" id="pf-tools" hidden>
      <div class="pf-tgroup" role="group" aria-label="Tool">
        <button data-tool="hand" title="Scroll" aria-label="Scroll">${svg("hand")}</button>
        <button data-tool="pen" title="Pen" aria-label="Pen">${svg("pencil")}</button>
        <button data-tool="hl" title="Highlighter" aria-label="Highlighter">${svg("highlighter")}</button>
        <button data-tool="text" title="Text" aria-label="Text">${svg("type")}</button>
        <button data-tool="eraser" title="Eraser" aria-label="Eraser">${svg("eraser")}</button>
      </div>
      <div class="pf-colors" role="group" aria-label="Color">${COLORS.map((c, i) => `<button data-color="${c}" aria-label="Color ${i + 1}" aria-pressed="${i === 0}"><i style="background:${c}"></i></button>`).join("")}</div>
      <button class="icon-btn" id="pf-undo" aria-label="Undo" title="Undo" disabled>${svg("undo2")}</button>
      <span class="pf-zoom"><button class="icon-btn" id="pf-zout" aria-label="Zoom out">${svg("zoomOut")}</button><span id="pf-zlvl">100%</span><button class="icon-btn" id="pf-zin" aria-label="Zoom in">${svg("zoomIn")}</button></span>
      <span class="pf-hint" id="pf-hint"></span>
      <span class="ap-spacer"></span>
      ${notesButton("pf-notes")}
      <button class="pill-btn" id="pf-export">${svg("download")} Save as PDF</button>
    </div>
    <div class="pf-split"><div class="ap-scroll pf-main" id="pf-main"></div><aside id="pf-np"></aside></div>`;
  notes = notesPanel({ host: el, panel: $("#pf-np"), button: el.querySelector(".pf-notes"), key: "pf-np-h",
    get: () => marks, set: async patch => { if (!marks) return; Object.assign(marks, patch); clearTimeout(saveT); saveT = null; await saveNow(); } });
  el.querySelector(".pf-notes").onclick = () => notes.toggle();
  $("#pf-back").onclick = () => go("");
  el.querySelectorAll("[data-tool]").forEach(b => b.onclick = () => setTool(b.dataset.tool));
  el.querySelectorAll("[data-color]").forEach(b => b.onclick = () => {
    color = b.dataset.color; el.querySelectorAll("[data-color]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    if (tool === "hl" || tool === "eraser" || tool === "hand") setTool("pen");
  });
  $("#pf-undo").onclick = () => {
    const u = undo.pop(); if (!u) return;
    marks.pages[u.n] = JSON.parse(u.before);
    const p = pages[u.n - 1]; if (p) { drawInk(p); drawTexts(p); }
    updateUndo(); persist();
  };
  $("#pf-zin").onclick = () => setZoom(Math.min(3, zoom * 1.2));
  $("#pf-zout").onclick = () => setZoom(Math.max(0.3, zoom / 1.2));
  $("#pf-export").onclick = e => exportPdf(e.currentTarget);
  const main = $("#pf-main");
  main.addEventListener("pointerdown", e => { if (e.target.closest(".pf-text")) onTextTap(e); else onDown(e); });
  main.addEventListener("pointermove", onMove);
  main.addEventListener("pointerup", onUp);
  main.addEventListener("pointercancel", onUp);
  main.addEventListener("input", onTextInput);
  main.addEventListener("focusout", onTextBlur);
  main.addEventListener("click", e => { const b = e.target.closest("[data-open-pdf]"); if (b) go(b.dataset.openPdf); });
  main.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) e.preventDefault(); });
  main.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) { e.preventDefault(); addAndOpen(f); } });
  addEventListener("keydown", e => {
    if (!ctx0.isActive() || !doc || /textarea|input/i.test(document.activeElement?.tagName || "")) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); $("#pf-undo").click(); }
    const k = { h: "hand", p: "pen", l: "hl", t: "text", e: "eraser" }[e.key.toLowerCase()];
    if (k && !e.ctrlKey && !e.metaKey) setTool(k);
  });
  let rz = null;
  addEventListener("resize", () => { if (!doc || !ctx0.isActive()) return; clearTimeout(rz); rz = setTimeout(fitWidth, 200); });
  // opening or closing the notes panel changes the page width: fit the pages to it
  let lastW = 0;
  new ResizeObserver(() => { const w = $("#pf-main").clientWidth; if (!doc || !ctx0.isActive() || Math.abs(w - lastW) < 2) return; lastW = w; clearTimeout(rz); rz = setTimeout(fitWidth, 120); }).observe($("#pf-main"));
  store.onChange(ch => {
    // marks changed on another device while this one is open: show them (unless you're mid-stroke)
    if (ch.app === APP && ch.source === "remote" && fileId && (ch.ids || []).includes(fileId) && !live) {
      store.get(APP, fileId).then(d => { if (d && marks) { marks.pages = d.pages || {}; pages.forEach(p => { drawInk(p); drawTexts(p); }); } });
    }
  });
}

/** show("") list · show("<file id>") open that PDF */
async function show(arg) {
  const id = typeof arg === "string" && arg ? decodeURIComponent(arg) : "";
  if (id && id === fileId && doc) return;
  return id ? openDoc(id) : renderList();
}
function hide() { if (saveT && fileId && marks) { clearTimeout(saveT); saveT = null; saveNow(); } }

export default { id: APP, name: "PDF editor", icon: "filePen", tint: "red", mount, show, hide };
