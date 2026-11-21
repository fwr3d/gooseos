// One class at a glance: room, the next few deadlines, and the plan you're working on with its notes.
// Opened from the home "In class" widget (#schedule/class/<course id>) and from Today.
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import { loadCourses, status, colorOf, fmtTime, inTime } from "./schedule.js";
import { listDocs, renderMd, KINDS } from "../milestones/workspace.js";
import { openViewer } from "../../viewer.js";
import { dueLabel } from "../deadlines/parse.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s || "").replace(/\s+/g, "").toLowerCase();
export const sameCourse = (a, b) => !!a && !!b && norm(a) === norm(b);

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./class.css", import.meta.url).href;
  document.head.appendChild(link);
}

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
  return { course, live, later, deadlines, plan, docs, now };
}

function sheetHtml(g) {
  const { course: c, live, later, deadlines, plan, docs, now } = g;
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
      </div>` : `<p class="cl-empty">No plan in progress for ${esc(c.code)}.</p>`}</section>`;
}

/** Open the class sheet for courseId over root. */
export async function openClassSheet(root, courseId, { toast } = {}) {
  loadCss();
  const g = await gather(courseId);
  if (!g) { if (toast) toast("That class isn't in your schedule anymore."); return; }
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<div class="ap-sheet cl-sheet" role="dialog" aria-modal="true" aria-label="${esc(g.course.code)}"></div>`;
  root.appendChild(back);
  const sheet = back.firstElementChild;
  const close = () => { back.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = e => { if (e.key === "Escape" && !document.querySelector(".fv")) close(); };
  document.addEventListener("keydown", onKey);
  back.addEventListener("click", e => {
    e.stopPropagation();   // the app underneath has its own click handler
    if (e.target === back) return close();
    const b = e.target.closest("[data-act],[data-go],[data-doc]"); if (!b) return;
    if (b.dataset.act === "close") return close();
    if (b.dataset.go) { close(); location.hash = b.dataset.go.replace(/^#/, ""); return; }
    if (b.dataset.doc) { const d = g.docs.find(x => x.id === b.dataset.doc); if (d) openDoc(d); }
  });
  sheet.innerHTML = sheetHtml(g);
}

/** Read a doc the same way Milestones shows it. */
function openDoc(d) {
  openViewer({ title: d.title, sub: KINDS[d.kind] || "Note",
    render(body) { body.innerHTML = `<article class="fv-doc ws-md">${renderMd(d.body) || `<p class="ws-muted">Nothing written yet.</p>`}</article>`; } });
}
