// One class at a glance: room, the next few deadlines, the plan you're working on
// and its notes, plus quick notes you jot down during class.
// Opened from the home "In class" widget (#schedule/class/<course id>) and from Today.
//
// Saved items (app "class-notes"), one per note:
//   "n-…": { course: "CS 18000", day: "2026-11-21" (local date), text, at (ms) }
// An exam plan for the same course lists these notes in its workspace (read only).
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import { loadCourses, status, colorOf, fmtTime, inTime } from "./schedule.js";
import { listDocs, renderMd, KINDS } from "../milestones/workspace.js";
import { openViewer } from "../../viewer.js";
import { dueLabel } from "../deadlines/parse.js";

const NOTES = "class-notes";
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
export const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const norm = s => String(s || "").replace(/\s+/g, "").toLowerCase();
export const sameCourse = (a, b) => !!a && !!b && norm(a) === norm(b);
const timeOf = t => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayTitle = k => { const [y, m, d] = k.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).replace(",", ""); };

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./class.css", import.meta.url).href;
  document.head.appendChild(link);
}

/* ---------- notes ---------- */
/** Notes for a course, newest first. Pass day to get one day only. */
export async function listNotes(course, day) {
  return (await store.list(NOTES)).map(r => ({ id: r.id, ...r.data }))
    .filter(n => n && n.text && sameCourse(n.course, course) && (!day || n.day === day))
    .sort((a, b) => b.at - a.at);
}
export async function addNote(course, text, t = Date.now()) {
  const body = String(text || "").trim(); if (!body) return null;
  const id = "n-" + uid();
  await store.put(NOTES, id, { course, day: dayKey(t), text: body, at: t });
  return id;
}
export const removeNote = id => store.remove(NOTES, id);

/* ---------- what the sheet shows ---------- */
async function gather(courseId, now = Date.now()) {
  const course = (await loadCourses()).find(c => c.id === courseId);
  if (!course) return null;
  const st = await status(now);
  const live = st.now && st.now.course.id === courseId ? st.now : null;
  const later = st.today.find(x => x.course.id === courseId && x.start > now) || null;
  const deadlines = (await store.list("deadlines")).map(r => ({ id: r.id, ...r.data }))
    .filter(d => d && !d.done && d.due && d.due >= now && sameCourse(d.course, course.code))
    .sort((a, b) => a.due - b.due).slice(0, 3);
  // the active plan: unfinished steps and its deadline (if linked) not checked off; soonest due first
  const plans = [];
  for (const r of await store.list("milestones")) {
    const m = { id: r.id, ...r.data };
    if (!m || !Array.isArray(m.steps) || !sameCourse(m.course, course.code) || !m.steps.some(s => !s.done)) continue;
    if (m.deadlineKey) { const d = await store.get("deadlines", m.deadlineKey.replace(/^deadlines:/, "")); if (d && d.done) continue; }
    plans.push(m);
  }
  const plan = plans.sort((a, b) => a.due - b.due)[0] || null;
  const docs = plan ? await listDocs(`milestones:${plan.id}`).catch(() => []) : [];
  const notes = await listNotes(course.code, dayKey(now));
  return { course, live, later, deadlines, plan, docs, notes, now };
}

function noteRows(notes) {
  return notes.map(n => `<div class="cl-note" data-nid="${esc(n.id)}"><span class="cl-note-t">${esc(n.text)}</span>
    <span class="cl-note-at">${esc(timeOf(n.at))}</span><button type="button" class="icon-btn cl-note-x" data-act="rm-note" aria-label="Delete note">${svg("x")}</button></div>`).join("");
}

function sheetHtml(g) {
  const { course: c, live, later, deadlines, plan, docs, notes, now } = g;
  const meet = live || later;
  const room = (meet && meet.meeting.room) || (c.meetings || []).map(m => m.room).find(Boolean) || "";
  const when = live ? `Now · until ${fmtTime(live.meeting.end)} · ${inTime(live.end - now)} left`
    : later ? `Today at ${fmtTime(later.meeting.start)} · in ${inTime(later.start - now)}` : "";
  const next = plan ? plan.steps.filter(s => !s.done).sort((a, b) => a.date - b.date)[0] : null;
  const done = plan ? plan.steps.filter(s => s.done).length : 0;
  return `
    <div class="cl-head"><span class="cl-dot" style="background:${colorOf(c)}"></span>
      <div class="grow"><h2>${esc(c.code)}${c.name ? ` <span class="cl-name">${esc(c.name)}</span>` : ""}</h2>${when ? `<span class="cl-when">${esc(when)}</span>` : ""}</div>
      <button type="button" class="icon-btn" data-act="close" aria-label="Close">${svg("x")}</button></div>
    <div class="cl-room">${svg("mapPin")}<span>${room ? esc(room) : "No room yet"}</span></div>

    <section class="cl-sec"><h3>Next due</h3>${deadlines.length ? `<div class="cl-list">${deadlines.map(d => `<button type="button" class="cl-row" data-go="#deadlines/${esc(d.id)}">
        ${svg("calendarClock")}<span class="grow"><span class="t">${esc(d.title)}</span><span class="s">${esc(dueLabel(d.due))}</span></span>${svg("chevronRight")}</button>`).join("")}</div>`
      : `<p class="cl-empty">Nothing due for ${esc(c.code)}.</p>`}</section>

    <section class="cl-sec"><h3>Milestone</h3>${plan ? `<div class="cl-list">
        <button type="button" class="cl-row" data-go="#milestones/${esc(plan.id)}">${svg("milestone")}
          <span class="grow"><span class="t">${esc(plan.title)}</span><span class="s">${esc([`${done}/${plan.steps.length} steps`, next ? `next: ${next.title}, ${dueLabel(next.date)}` : ""].filter(Boolean).join(" · "))}</span></span>${svg("chevronRight")}</button>
        ${docs.map(d => `<button type="button" class="cl-row cl-doc" data-doc="${esc(d.id)}">${svg(d.kind === "guide" ? "notebook" : d.kind === "questions" ? "circleHelp" : "fileText")}
          <span class="grow"><span class="t">${esc(d.title)}</span><span class="s">${esc(KINDS[d.kind] || "Note")}</span></span></button>`).join("")}
      </div>` : `<p class="cl-empty">No plan in progress for ${esc(c.code)}.</p>`}</section>

    <section class="cl-sec"><h3>Notes today${notes.length ? `<span class="n">${notes.length}</span>` : ""}</h3>
      <form class="cl-qn" data-course="${esc(c.code)}" autocomplete="off">
        <textarea class="field" rows="2" placeholder="Quick note for ${esc(c.code)}… (Enter saves)" aria-label="Quick note"></textarea>
        <button class="pill-btn" type="submit">Save</button></form>
      <div class="cl-notes">${noteRows(notes)}</div></section>`;
}

/** Open the class sheet for courseId over root. */
export async function openClassSheet(root, courseId, { toast } = {}) {
  loadCss();
  let g = await gather(courseId);
  if (!g) { if (toast) toast("That class isn't in your schedule anymore."); return; }
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<div class="ap-sheet cl-sheet" role="dialog" aria-modal="true" aria-label="${esc(g.course.code)}"></div>`;
  root.appendChild(back);
  const sheet = back.firstElementChild;
  const draw = () => { sheet.innerHTML = sheetHtml(g); wireNoteBox(sheet.querySelector(".cl-qn"), { toast, onSaved: refresh }); };
  const refresh = async () => { g = (await gather(courseId)) || g; const keep = sheet.querySelector("textarea")?.value || ""; draw(); sheet.querySelector("textarea").value = keep; };
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape" && !document.querySelector(".fv")) close(); };
  document.addEventListener("keydown", onKey);
  back.addEventListener("click", async e => {
    e.stopPropagation();   // the app underneath has its own click handler
    if (e.target === back) return close();
    const b = e.target.closest("[data-act],[data-go],[data-doc]"); if (!b) return;
    if (b.dataset.act === "close") return close();
    if (b.dataset.go) { close(); location.hash = b.dataset.go.replace(/^#/, ""); return; }
    if (b.dataset.doc) { const d = g.docs.find(x => x.id === b.dataset.doc); if (d) openDoc(d); return; }
    if (b.dataset.act === "rm-note") { await removeNote(b.closest("[data-nid]").dataset.nid); if (toast) toast("Note deleted"); refresh(); }
  });
  draw();
  // during class the note box is the point; otherwise don't pop the keyboard
  if (g.live) setTimeout(() => sheet.querySelector("textarea")?.focus(), 50);
}

/** Read a doc the same way Milestones shows it. */
function openDoc(d) {
  openViewer({ title: d.title, sub: KINDS[d.kind] || "Note",
    render(body) { body.innerHTML = `<article class="fv-doc ws-md">${renderMd(d.body) || `<p class="ws-muted">Nothing written yet.</p>`}</article>`; } });
}

/** A note form: <form data-course> with a textarea or input. Enter saves, Shift+Enter is a new line. */
export function wireNoteBox(form, { toast, onSaved } = {}) {
  if (!form) return;
  const box = form.querySelector("textarea,input");
  const save = async () => {
    const text = box.value.trim(); if (!text) { box.focus(); return; }
    await addNote(form.dataset.course, text);
    box.value = "";
    if (toast) toast(`Note saved to ${form.dataset.course}`);
    if (onSaved) onSaved();
  };
  form.addEventListener("submit", e => { e.preventDefault(); save(); });
  box.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); save(); } });
}

/* ---------- read-only list for an exam plan's workspace ---------- */
let drawRun = 0;
/** Add this course's class notes under an exam plan's workspace. Safe to call on every redraw. */
export async function classNotesInto(box, m) {
  if (!box || !m || m.template !== "exam" || !m.course) return;
  loadCss();
  const run = ++drawRun;
  const notes = await listNotes(m.course).catch(() => []);
  if (run !== drawRun || !box.isConnected || !notes.length) return;
  box.querySelector(".cl-ms")?.remove();
  const days = [];
  for (const n of notes) { const last = days[days.length - 1]; if (last && last.day === n.day) last.list.push(n); else days.push({ day: n.day, list: [n] }); }
  box.insertAdjacentHTML("beforeend", `<div class="cl-ms">
    <span class="ms-lab">Class notes · ${esc(m.course)} · ${notes.length}</span>
    <div class="ws-list cl-ms-list">${days.map(d => `<div class="cl-ms-day"><span class="cl-ms-dh">${esc(dayTitle(d.day))}</span>
      ${d.list.map(n => `<div class="cl-ms-n"><span>${esc(n.text)}</span><small>${esc(timeOf(n.at))}</small></div>`).join("")}</div>`).join("")}</div>
  </div>`);
}
