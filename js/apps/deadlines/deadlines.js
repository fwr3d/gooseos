// Deadline Hub: one list of every deadline.
// Brightspace due dates come in automatically from your Brightspace calendar
// subscription link; Gradescope, Ed and anything else go in with quick add.
//
// Saved through the shared store as items of app "deadlines":
//   { title, course, list?, due (ms or null), source, done, url?, uid?, edited?, created }
//   list: a list id from js/lists.js (school, frat, personal, money, or yours).
//   Without one, it's School when there's a course and Personal when there isn't.
// Settings live in app "deadlines-config", item "brightspace": { url, lastSync }.
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import * as lists from "../../lists.js";
import { parseCapture, dueLabel, toLocalInput } from "./parse.js";
import { parseICS, eventsToDeadlines, idFor } from "./ics.js";

const APP = "deadlines";
const CFG = "deadlines-config";
const SOURCES = {
  brightspace: { label: "Brightspace", icon: "graduationCap" },
  gradescope: { label: "Gradescope", icon: "listChecks" },
  ed: { label: "Ed", icon: "messageSquare" },
  syllabus: { label: "Syllabus", icon: "inbox" },
  manual: { label: "Added by you", icon: "pencil" },
};
const COURSE_COLORS = ["#2f5bea", "#e5484d", "#22a45d", "#e08a00", "#8b5cf6", "#0e9fb0", "#db2777", "#64748b"];
const SYNC_EVERY = 30 * 60 * 1000;

const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
export function courseColor(c) { let h = 0; for (const ch of String(c)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return COURSE_COLORS[h % COURSE_COLORS.length]; }

/** "in 5h", "in 3d", "2d late", "due now". */
function timeLeft(due, now = Date.now()) {
  if (!due) return { text: "", cls: "" };
  const ms = due - now, abs = Math.abs(ms), m = abs / 60000, h = m / 60, d = h / 24;
  const n = d >= 1 ? `${Math.floor(d)}d` : h >= 1 ? `${Math.floor(h)}h` : `${Math.max(1, Math.floor(m))}m`;
  if (ms < 0) return { text: abs < 60000 ? "now" : `${n} late`, cls: "late" };
  return { text: `in ${n}`, cls: ms < 24 * 3600e3 ? "soon" : "" };
}

/* ---------- data ---------- */
export async function loadDeadlines() {
  const rows = await store.list(APP);
  return rows.map(r => ({ id: r.id, ...r.data })).filter(d => d && d.title !== undefined);
}
/** Courses for matching "cs" → "CS 18000": Schedule's course list first, then courses already used here. */
export async function knownCourses() {
  const seen = new Map();
  try { for (const c of await store.list("courses")) { const code = c.data && c.data.code; if (code) seen.set(code.toLowerCase(), code); } } catch (e) { /* no Schedule yet */ }
  for (const d of await loadDeadlines()) if (d.course && !seen.has(d.course.toLowerCase())) seen.set(d.course.toLowerCase(), d.course);
  return [...seen.values()];
}

/** Exams get the full reminder ramp: tagged by the syllabus scanner, or named like one. */
const isExam = d => d.type === "exam" || (/\b(exam|midterm|final)\b/i.test(d.title || "") && !/\bfinal\s+(project|paper|presentation|report|essay)\b/i.test(d.title || ""));

/** Shared agenda (read by Reminders and Today): open deadlines plus ones finished in the last 2 days. */
export async function agenda() {
  const cutoff = Date.now() - 2 * 864e5, ls = await lists.loadLists();
  return (await loadDeadlines())
    .filter(d => !d.done || (d.due || 0) > cutoff)
    .map(d => ({ key: `${APP}:${d.id}`, title: d.title, due: d.due || null, kind: isExam(d) ? "exam" : "deadline", course: d.course || "", list: lists.listOf(d, ls), done: !!d.done, open: `#${APP}/${d.id}` }));
}

/** Mark one agenda item done ("deadlines:<id>"). */
export async function complete(key) {
  const id = String(key).replace(new RegExp(`^${APP}:`), "");
  const d = await store.get(APP, id);
  if (d && !d.done) await store.put(APP, id, { ...d, done: true });
}
/** Add a deadline from quick-capture text. Returns the saved item, or null if empty. */
export async function addFromText(text) {
  const p = parseCapture(text, new Date(), await knownCourses(), await lists.loadLists());
  if (!p.title && !p.course) return null;
  const id = "d-" + uid();
  const item = { title: p.title || p.course, course: p.course, list: p.list || (p.course ? "school" : "personal"), due: p.due ? p.due.getTime() : null, source: p.source || "manual", done: false, created: Date.now() };
  await store.put(APP, id, item);
  return { id, ...item };
}

async function getConfig() { return (await store.get(CFG, "brightspace")) || {}; }

/** Pull the Brightspace calendar and update the list. Returns { added, updated, removed }. */
export async function syncBrightspace() {
  const cfg = await getConfig();
  if (!cfg.url) throw new Error("not-connected");
  const r = await fetch("/api/ics?url=" + encodeURIComponent(cfg.url), { cache: "no-store" });
  const text = await r.text();
  if (!r.ok) throw new Error(text || `Brightspace sync failed (${r.status}).`);
  const now = Date.now(), from = now - 21 * 864e5, to = now + 200 * 864e5;
  const incoming = eventsToDeadlines(parseICS(text)).filter(e => e.due >= from && e.due <= to);
  const existing = new Map((await loadDeadlines()).filter(d => d.source === "brightspace").map(d => [d.id, d]));
  let added = 0, updated = 0, removed = 0;
  const seen = new Set();
  for (const e of incoming) {
    const id = idFor(e.uid); seen.add(id);
    const cur = existing.get(id);
    if (!cur) { await store.put(APP, id, { title: e.title, course: e.course, due: e.due, source: "brightspace", done: false, url: e.url, uid: e.uid, created: now }); added++; continue; }
    if (cur.edited) continue;
    if (cur.title !== e.title || cur.due !== e.due || cur.course !== e.course || (cur.url || "") !== e.url) {
      const { id: _drop, ...rest } = cur;
      await store.put(APP, id, { ...rest, title: e.title, course: e.course, due: e.due, url: e.url }); updated++;
    }
  }
  // gone from Brightspace (and still upcoming, not done) → remove
  for (const [id, d] of existing) if (!seen.has(id) && !d.done && !d.edited && d.due && d.due > now) { await store.remove(APP, id); removed++; }
  await store.put(CFG, "brightspace", { ...cfg, lastSync: now });
  return { added, updated, removed };
}

/* ---------- view state ---------- */
let ctx0, root;
const $ = s => root.querySelector(s);
let items = [];
let allLists = [];
let listFilter = "all";   // a list id, or "all"
let filter = "all";       // a course, inside the School list
let showAllDone = false;
let lastUndo = null;

function groups(list, now = new Date()) {
  const t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  const t1 = +t0 + 864e5, t2 = +t0 + 2 * 864e5, t7 = +t0 + 7 * 864e5;
  const g = { late: [], today: [], tomorrow: [], week: [], later: [], nodate: [], done: [] };
  for (const d of list) {
    if (d.done) g.done.push(d);
    else if (!d.due) g.nodate.push(d);
    else if (d.due < +now) g.late.push(d);
    else if (d.due < t1) g.today.push(d);
    else if (d.due < t2) g.tomorrow.push(d);
    else if (d.due < t7) g.week.push(d);
    else g.later.push(d);
  }
  for (const k of Object.keys(g)) g[k].sort((a, b) => k === "done" ? (b.due || 0) - (a.due || 0) : (a.due || 0) - (b.due || 0));
  return g;
}

function rowHtml(d) {
  const left = d.done ? { text: "", cls: "" } : timeLeft(d.due);
  const src = SOURCES[d.source] || SOURCES.manual;
  const lid = lists.listOf(d, allLists), l = lists.byId(allLists, lid);
  // School items already show their course; everything else shows its list
  const tag = d.course && lid === "school" ? `<span class="chip course" style="background:${courseColor(d.course)}">${esc(d.course)}</span>`
    : `${l ? `<span class="chip course" style="background:${esc(l.color)}">${esc(l.name)}</span>` : ""}${d.course ? `<span class="chip course" style="background:${courseColor(d.course)}">${esc(d.course)}</span>` : ""}`;
  return `<div class="dl-row ${d.done ? "done" : ""}" data-id="${d.id}">
    <button class="dl-check" data-act="toggle" aria-label="${d.done ? "Mark not done" : "Mark done"}">${svg("check")}</button>
    <button class="dl-main" data-act="edit">
      <span class="t">${esc(d.title)}</span>
      <span class="dl-meta">${tag}<span title="${src.label}">${svg(src.icon)}</span><span>${d.due ? esc(dueLabel(d.due)) : "No date"}</span></span>
    </button>
    ${left.text ? `<span class="dl-left ${left.cls}">${left.text}</span>` : ""}
  </div>`;
}

async function render() {
  [items, allLists] = await Promise.all([loadDeadlines(), lists.loadLists()]);
  const cfg = await getConfig();
  if (listFilter !== "all" && !allLists.some(l => l.id === listFilter)) listFilter = "all";
  const inList = listFilter === "all" ? items : items.filter(d => lists.listOf(d, allLists) === listFilter);
  // course buttons only inside School
  const courses = listFilter === "school" ? [...new Set(inList.filter(d => !d.done && d.course).map(d => d.course))].sort() : [];
  if (filter !== "all" && !courses.includes(filter)) filter = "all";
  const shown = filter === "all" ? inList : inList.filter(d => d.course === filter);
  const g = groups(shown);
  const openIn = id => items.filter(d => !d.done && lists.listOf(d, allLists) === id).length;

  $("#dl-filters").innerHTML = [`<button data-l="all" aria-pressed="${listFilter === "all"}">All</button>`,
    ...allLists.map(l => { const n = openIn(l.id); return `<button data-l="${esc(l.id)}" aria-pressed="${listFilter === l.id}"><i style="background:${esc(l.color)}"></i>${esc(l.name)}${n ? `<span class="dl-fn">${n}</span>` : ""}</button>`; }),
    `<button data-act="lists" aria-label="Edit lists" title="Edit lists">${svg("pencil")}</button>`].join("");
  $("#dl-courses").innerHTML = courses.length > 1 ? [`<button data-f="all" aria-pressed="${filter === "all"}">All classes</button>`,
    ...courses.map(c => `<button data-f="${esc(c)}" aria-pressed="${filter === c}"><i style="background:${courseColor(c)}"></i>${esc(c)}</button>`)].join("") : "";
  $("#dl-courses").hidden = courses.length < 2;

  $("#dl-connect").innerHTML = cfg.url ? "" : connectHtml();
  wireConnect();

  const SECS = [["late", "Overdue"], ["today", "Today"], ["tomorrow", "Tomorrow"], ["week", "This week"], ["later", "Later"], ["nodate", "No date"]];
  let html = SECS.filter(([k]) => g[k].length).map(([k, label]) =>
    `<section class="dl-sec ${k === "late" ? "late" : ""}"><h3>${label}<span class="n">${g[k].length}</span></h3><div class="dl-list">${g[k].map(rowHtml).join("")}</div></section>`).join("");
  if (!html) {
    const ln = listFilter !== "all" ? lists.byId(allLists, listFilter) : null;
    html = ln && listFilter !== "school" ? `<div class="dl-empty"><b>Nothing in ${esc(ln.name)}</b>Add one above, like “${esc(ln.name.toLowerCase())} ${ln.id === "money" ? "pay rent" : ln.id === "frat" ? "chapter meeting" : "call mom"} sun 7pm”.</div>`
      : `<div class="dl-empty"><b>${shown.length ? "All caught up" : "Nothing here yet"}</b>${shown.length ? "No open deadlines. Nice." : "Type one above, like “cs proj 3 fri 11:59”, or connect Brightspace."}</div>`;
  }
  if (g.done.length) {
    const doneList = showAllDone ? g.done : g.done.slice(0, 5);
    html += `<section class="dl-sec"><h3>Done<span class="n">${g.done.length}</span></h3><div class="dl-list">${doneList.map(rowHtml).join("")}</div>
      ${g.done.length > 5 ? `<button class="dl-more" id="dl-more-done">${showAllDone ? "Show fewer" : `Show all ${g.done.length}`}</button>` : ""}</section>`;
  }
  $("#dl-sections").innerHTML = html;
  const more = $("#dl-more-done"); if (more) more.onclick = () => { showAllDone = !showAllDone; render(); };

  const tucked = !cfg.url && cardTucked();
  if (tucked) $("#dl-connect").innerHTML = "";
  $("#dl-bs").hidden = !tucked;
  const sync = $("#dl-sync");
  sync.hidden = !cfg.url;
  sync.title = cfg.lastSync ? `Brightspace synced ${new Date(cfg.lastSync).toLocaleString()}` : "Sync Brightspace";
}

function cardTucked() { try { return localStorage.getItem("dl-connect-tucked") === "1"; } catch (e) { return false; } }
function tuckCard(on) { try { localStorage.setItem("dl-connect-tucked", on ? "1" : "0"); } catch (e) { /* ignore */ } }

function connectHtml() {
  return `<div class="dl-connect">
    <span class="tile-ic" style="background:#2348c9">${svg("graduationCap")}</span>
    <div class="grow">
      <div class="t">Pull in Brightspace automatically</div>
      <div class="s">Brightspace gives every student a private calendar link with all their due dates. Paste it here once and GooseOS keeps your list updated.</div>
      <ol>
        <li>In Brightspace, open <b>Calendar</b>.</li>
        <li>Click <b>Subscribe</b> (top right of the calendar).</li>
        <li>Pick <b>All Courses</b>, then copy the link it shows.</li>
      </ol>
      <input id="dl-bs-url" type="url" inputmode="url" placeholder="https://…brightspace.com/d2l/le/calendar/feed/…" aria-label="Brightspace calendar link">
      <span class="err" id="dl-bs-err"></span>
      <div class="row-actions"><button class="pill-btn" id="dl-bs-save">Connect</button><button class="pill-btn secondary" id="dl-bs-later">Not now</button></div>
    </div></div>`;
}
function wireConnect() {
  const btn = $("#dl-bs-save"); if (!btn) return;
  $("#dl-bs-later").onclick = () => { tuckCard(true); render(); ctx0.toast("Tap the cap icon up top whenever you want to connect Brightspace."); };
  btn.onclick = async () => {
    const url = $("#dl-bs-url").value.trim(), err = $("#dl-bs-err");
    err.textContent = "";
    let u; try { u = new URL(url); } catch (e) { err.textContent = "That doesn't look like a link. Copy the whole thing from Brightspace."; return; }
    if (!/(^|\.)(brightspace\.com|desire2learn\.com)$/i.test(u.hostname) || !/\/calendar\/feed\//i.test(u.pathname)) { err.textContent = "That's not a Brightspace calendar link. In Brightspace: Calendar → Subscribe → copy the link."; return; }
    btn.disabled = true; btn.textContent = "Connecting…";
    await store.put(CFG, "brightspace", { url, lastSync: 0 });
    try { const r = await syncBrightspace(); ctx0.toast(`Brightspace connected. ${r.added} deadline${r.added === 1 ? "" : "s"} added.`); }
    catch (e) { await store.remove(CFG, "brightspace"); err.textContent = e.message; btn.disabled = false; btn.textContent = "Connect"; return; }
    render();
  };
}

async function runSync(manual) {
  const btn = $("#dl-sync");
  btn.classList.add("spin");
  try {
    const r = await syncBrightspace();
    if (manual) ctx0.toast(r.added || r.updated || r.removed ? `Brightspace: ${r.added} new, ${r.updated} changed, ${r.removed} removed.` : "Brightspace is up to date.");
  } catch (e) {
    if (manual || e.message !== "not-connected") ctx0.toast(navigator.onLine ? e.message : "You're offline. Brightspace will sync when you're back online.");
  } finally { btn.classList.remove("spin"); render(); }
}

/* ---------- edit sheet ---------- */
function openEdit(d) {
  const back = document.createElement("div"); back.className = "dl-back";
  const isNew = !d;
  d = d || { title: "", course: "", list: listFilter !== "all" ? listFilter : "", due: null, source: "manual", done: false };
  const curList = isNew && !d.list ? "school" : lists.listOf(d, allLists);
  back.innerHTML = `<form class="dl-sheet" role="dialog" aria-modal="true" aria-label="${isNew ? "New deadline" : "Edit deadline"}">
    <h2>${isNew ? "New deadline" : "Edit deadline"}</h2>
    <label>What<input class="field" name="title" required value="${esc(d.title)}" placeholder="Project 3"></label>
    <div class="two">
      <label>List<select class="field" name="list">${allLists.map(l => `<option value="${esc(l.id)}" ${curList === l.id ? "selected" : ""}>${esc(l.name)}</option>`).join("")}</select></label>
      <label>Course<input class="field" name="course" value="${esc(d.course)}" placeholder="${curList === "school" ? "CS 18000" : "None"}" list="dl-course-opts"></label>
    </div>
    <label>From<select class="field" name="source">${Object.entries(SOURCES).map(([k, v]) => `<option value="${k}" ${d.source === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
    <label>Due<input class="field" type="datetime-local" name="due" value="${d.due ? toLocalInput(d.due) : ""}"></label>
    ${d.url ? `<a class="link-btn" href="${esc(d.url)}" target="_blank" rel="noopener">${svg("externalLink")} Open in Brightspace</a>` : ""}
    ${isNew ? "" : `<button type="button" class="link-btn" data-act="breakdown" hidden>${svg("listChecks")} Break it down into steps</button>`}
    <div class="acts">
      ${isNew ? "<span></span>" : `<button type="button" class="pill-btn secondary" data-act="del" style="color:var(--bad)">Delete</button>`}
      <span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">Save</button></span>
    </div>
    <datalist id="dl-course-opts">${[...new Set(items.map(i => i.course).filter(Boolean))].map(c => `<option value="${esc(c)}">`).join("")}</datalist>
  </form>`;
  root.appendChild(back);
  const f = back.querySelector("form");
  const close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  f.querySelector('[data-act="cancel"]').onclick = close;
  const del = f.querySelector('[data-act="del"]');
  if (del) del.onclick = async () => { close(); await store.remove(APP, d.id); ctx0.toast(`Deleted “${d.title}”`); render(); };
  // "Break it down" appears once the Milestones app exists
  const bd = f.querySelector('[data-act="breakdown"]');
  if (bd) import("../index.js").then(async m => {
    if (!m.default.some(a => a.id === "milestones" && !a.hidden)) return;
    const plan = await (await import("../milestones/milestones.js")).planFor(d.id);
    if (plan) bd.lastChild.textContent = " Open its plan";
    bd.hidden = false;
    bd.onclick = () => { close(); location.hash = plan ? `milestones/${encodeURIComponent(plan.id)}` : `milestones/new?deadline=${encodeURIComponent(d.id)}`; };
  }).catch(() => {});
  f.onsubmit = async e => {
    e.preventDefault();
    const fd = new FormData(f);
    const next = { ...d, title: fd.get("title").trim(), course: fd.get("course").trim(), list: fd.get("list"), source: fd.get("source"), due: fd.get("due") ? new Date(fd.get("due")).getTime() : null };
    if (!next.title) return;
    const { id, ...data } = next;
    if (!isNew && d.source === "brightspace") data.edited = true;
    await store.put(APP, isNew ? "d-" + uid() : d.id, isNew ? { ...data, created: Date.now() } : data);
    close(); render();
  };
  setTimeout(() => f.querySelector('[name="title"]').focus(), 50);
}

function saveFilter() { try { localStorage.setItem("dl-list", listFilter); } catch (e) { /* ignore */ } }

/* ---------- lists sheet: rename, recolor, add, remove ---------- */
function openLists() {
  const back = document.createElement("div"); back.className = "dl-back";
  const swatches = (name, cur) => `<span class="dl-sw">${lists.COLORS.map(c => `<label><input type="radio" name="${name}" value="${c}" ${c === cur ? "checked" : ""}><i style="background:${c}"></i></label>`).join("")}</span>`;
  const row = l => `<div class="dl-lrow" data-lid="${esc(l.id)}">
      <input class="field" data-k="name" value="${esc(l.name)}" aria-label="List name" required>
      ${swatches("c-" + l.id, l.color)}
      ${l.starter ? `<span class="dl-lx"></span>` : `<button type="button" class="icon-btn dl-lx" data-act="rm" aria-label="Remove ${esc(l.name)}">${svg("x")}</button>`}
    </div>`;
  back.innerHTML = `<form class="dl-sheet" role="dialog" aria-modal="true" aria-label="Lists">
    <h2>Lists</h2>
    <span class="dl-note">Quick add puts things in a list when you start with its name (“frat dues fri”) or tag it anywhere (“call mom sun #personal”).</span>
    <div class="dl-lrows">${allLists.map(row).join("")}</div>
    <div class="dl-lnew"><input class="field" id="dl-lnew" placeholder="New list, like Work or Gym" aria-label="New list name"><button type="button" class="pill-btn secondary" data-act="add">Add</button></div>
    <div class="acts"><span></span><span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">Save</button></span></div>
  </form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  f.querySelector('[data-act="cancel"]').onclick = close;
  const removed = new Set();
  f.addEventListener("click", e => {
    const rm = e.target.closest('[data-act="rm"]');
    if (rm) { const r = rm.closest("[data-lid]"); removed.add(r.dataset.lid); r.remove(); }
  });
  f.querySelector('[data-act="add"]').onclick = async () => {
    const inp = f.querySelector("#dl-lnew"), name = inp.value.trim();
    if (!name) return inp.focus();
    if (lists.matchList(name, allLists)) { ctx0.toast(`There's already a list called ${name}.`); return; }
    await lists.addList(name);
    close(); await render(); openLists();
  };
  f.querySelector("#dl-lnew").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); f.querySelector('[data-act="add"]').click(); } });
  f.onsubmit = async e => {
    e.preventDefault();
    for (const id of removed) await lists.removeList(id);
    for (const r of f.querySelectorAll("[data-lid]")) {
      const l = allLists.find(x => x.id === r.dataset.lid); if (!l) continue;
      const name = r.querySelector('[data-k="name"]').value.trim() || l.name;
      const color = (r.querySelector("input[type=radio]:checked") || {}).value || l.color;
      if (name !== l.name || color !== l.color) await lists.saveList(l.id, { name, color, order: l.order });
    }
    close(); render();
    if (removed.size) ctx0.toast(`Removed. Anything in ${removed.size === 1 ? "that list" : "those lists"} is now in Personal.`);
  };
}

/* ---------- markup ---------- */
const MARKUP = () => `
  <div class="dl-bar">
    <button class="dl-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button>
    <span class="dl-title">Deadlines</span>
    <span class="dl-spacer"></span>
    <button class="icon-btn" id="dl-bs" aria-label="Connect Brightspace" title="Connect Brightspace" hidden>${svg("graduationCap")}</button>
    <button class="icon-btn" id="dl-sync" aria-label="Sync Brightspace" hidden>${svg("refreshCw")}</button>
    <button class="icon-btn" id="dl-new" aria-label="New deadline">${svg("plus")}</button>
  </div>
  <div class="dl-scroll"><div class="dl-body">
    <form class="dl-add" id="dl-add" autocomplete="off">
      <div class="dl-add-row">${svg("plus")}<input id="dl-add-in" placeholder="“cs proj 3 fri 11:59” or “frat dues fri”" aria-label="Add a deadline or reminder"><button class="pill-btn" type="submit">Add</button></div>
      <div class="dl-preview" id="dl-add-prev"></div>
    </form>
    <div id="dl-connect"></div>
    <div class="dl-filters" id="dl-filters" role="group" aria-label="List"></div>
    <div class="dl-filters dl-courses" id="dl-courses" role="group" aria-label="Class" hidden></div>
    <div id="dl-sections"></div>
  </div></div>`;

/** Shared live preview for quick-capture inputs. */
export async function previewHtml(text) {
  if (!text.trim()) return "";
  const ls = await lists.loadLists();
  const p = parseCapture(text, new Date(), await knownCourses(), ls);
  const src = p.source ? SOURCES[p.source] : null;
  const l = lists.byId(ls, p.list || (p.course ? "school" : "personal"));
  return [
    l && (p.list || !p.course) ? `<span class="chip course" style="background:${esc(l.color)}">${esc(l.name)}</span>` : "",
    p.course ? `<span class="chip course" style="background:${courseColor(p.course)}">${esc(p.course)}</span>` : "",
    `<span class="chip">${esc(p.title || "…")}</span>`,
    `<span class="chip">${svg("clock")}${p.due ? esc(dueLabel(p.due)) : "No date"}</span>`,
    src ? `<span class="chip">${svg(src.icon)}${src.label}</span>` : "",
  ].join("");
}

/* ---------- app interface ---------- */
let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./deadlines.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("dl");
  el.innerHTML = MARKUP();
  const input = $("#dl-add-in");
  input.addEventListener("input", async () => { $("#dl-add-prev").innerHTML = await previewHtml(input.value); });
  $("#dl-add").onsubmit = async e => {
    e.preventDefault();
    const item = await addFromText(input.value);
    if (!item) return;
    input.value = ""; $("#dl-add-prev").innerHTML = "";
    ctx0.toast(`Added “${item.title}”${item.due ? ` · ${dueLabel(item.due)}` : ""}`);
    render();
  };
  $("#dl-new").onclick = () => openEdit(null);
  $("#dl-sync").onclick = () => runSync(true);
  $("#dl-bs").onclick = () => { tuckCard(false); render(); };
  $("#dl-filters").addEventListener("click", e => {
    if (e.target.closest('[data-act="lists"]')) return openLists();
    const b = e.target.closest("[data-l]"); if (b) { listFilter = b.dataset.l; filter = "all"; saveFilter(); render(); }
  });
  $("#dl-courses").addEventListener("click", e => { const b = e.target.closest("[data-f]"); if (b) { filter = b.dataset.f; render(); } });
  try { listFilter = localStorage.getItem("dl-list") || "all"; } catch (e) { /* ignore */ }
  $("#dl-sections").addEventListener("click", async e => {
    const row = e.target.closest(".dl-row"); if (!row) return;
    const d = items.find(x => x.id === row.dataset.id); if (!d) return;
    const act = e.target.closest("[data-act]")?.dataset.act;
    if (act === "toggle") {
      const { id, ...data } = d;
      await store.put(APP, id, { ...data, done: !d.done });
      if (!d.done) { lastUndo = d; ctx0.toast(`Done: ${d.title}`, { label: "Undo", run: async () => { const { id: i2, ...dd } = lastUndo; await store.put(APP, i2, { ...dd, done: false }); document.querySelector(".toast").hidden = true; render(); } }); }
      render();
    } else if (act === "edit") openEdit(d);
  });
  store.onChange(ch => { if ((ch.app === APP || ch.app === CFG || ch.app === "lists") && ctx0.isActive()) render(); });
  await render();
}

/** show("d-abc") opens that deadline (links like #deadlines/d-abc from Today and Reminders). */
async function show(arg) {
  await render();
  const want = typeof arg === "string" && arg ? decodeURIComponent(arg) : "";
  if (want) { const d = items.find(x => x.id === want); if (d) openEdit(d); }
  const cfg = await getConfig();
  if (cfg.url && Date.now() - (cfg.lastSync || 0) > SYNC_EVERY) runSync(false);
}

/** Red bubble on the icon: overdue + due in the next 24 hours. */
async function badge() {
  const now = Date.now();
  const n = (await loadDeadlines()).filter(d => !d.done && d.due && d.due < now + 24 * 3600e3).length;
  return n || "";
}

/** Home-screen widget: the next few deadlines. */
async function widget(el) {
  loadCss();
  const now = Date.now();
  const open = (await loadDeadlines()).filter(d => !d.done && d.due).sort((a, b) => a.due - b.due);
  const next = open.filter(d => d.due > now - 3 * 864e5).slice(0, 3);
  const weekCount = open.filter(d => d.due < now + 7 * 864e5).length;
  el.innerHTML = `<div class="w-k">${svg("calendarClock")}Deadlines${weekCount ? ` · ${weekCount} this week` : ""}</div>
    ${next.length ? `<div class="w-dl-list">${next.map(d => { const l = timeLeft(d.due); return `<div class="w-dl ${l.cls || "later"}"><b>${esc(d.title)}</b><span>${d.course ? esc(d.course) + " · " : ""}${esc(dueLabel(d.due))}</span></div>`; }).join("")}</div>`
      : `<div class="w-dl-empty">Nothing due. Tap to add one.</div>`}`;
  // try a quiet Brightspace refresh now and then
  getConfig().then(cfg => { if (cfg.url && navigator.onLine && Date.now() - (cfg.lastSync || 0) > SYNC_EVERY) syncBrightspace().catch(() => {}); });
}

export default { id: APP, name: "Deadlines", icon: "calendarClock", color: ["#ff9f1c", "#e8590c"], dock: true, wideWidget: true, mount, show, badge, widget, agenda, complete };
