// Today: your day in one screen. It saves nothing of its own; it reads
//   - js/agenda.js for anything due (deadlines, project steps, to-dos)
//   - Schedule for classes
//   - Reminders for things that came due while GooseOS was closed
//   - any app's summary() for a one-line status (Wallet: money left this week)
// After 8 PM it switches to Tomorrow.
//
// summary() contract, for any app: -> { label, value, sub?, pct? (0-100), tone?: "good"|"warn"|"bad", open? } or null
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import apps from "../index.js";
import * as agenda from "../../agenda.js";
import { status as classStatus, colorOf, fmtTime, inTime, meetingsOn } from "../schedule/schedule.js";
import { dueLabel } from "../deadlines/parse.js";
import { forToday as resetToday, togglePin } from "../reset/reset.js";
import { loadLists, byId } from "../../lists.js";

// which list Today shows ("all" or a list id). Per device, so the laptop and phone can differ.
let listPick = "all";
try { listPick = localStorage.getItem("td-list") || "all"; } catch (e) { /* ignore */ }
function setPick(id) { listPick = id; try { localStorage.setItem("td-list", id); } catch (e) { /* ignore */ } }

const APP = "today";
const EVENING = 20;          // 8 PM: switch to "Tomorrow"
const HEAVY_MIN = 4 * 60;    // more planned work than this in a day gets a warning
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
const addDays = (t, n) => { const d = new Date(dayStart(t)); d.setDate(d.getDate() + n); return +d; };
const timeOnly = t => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

async function summaries() {
  const out = [];
  for (const a of apps) {
    if (!a.summary || a.hidden || a.id === APP) continue;
    try { const s = await a.summary(); if (s) out.push({ ...s, app: a, open: s.open || `#${a.id}` }); } catch (e) { console.error(e); }
  }
  return out;
}

/** Everything the screen and the widget show. */
async function gather(now = Date.now()) {
  const evening = new Date(now).getHours() >= EVENING;
  const t0 = dayStart(now), t1 = addDays(now, 1), t2 = addDays(now, 2), t4 = addDays(now, 4);
  const [all, cls, sums, missed, reset, lists] = await Promise.all([agenda.list(), classStatus(now), summaries(), store.get("reminders", "missed"),
    resetToday(now).catch(e => { console.error(e); return { pins: [], note: "", nudge: false }; }), loadLists()]);
  const pick = listPick !== "all" && lists.some(l => l.id === listPick) ? listPick : "all";
  rowLists = pick === "all" ? lists : null;
  const items = pick === "all" ? all : all.filter(i => i.list === pick);
  const todo = items.filter(i => i.due && i.kind !== "ping");
  const late = todo.filter(i => i.due < now);
  const today = todo.filter(i => i.due >= now && i.due < t1);
  const tomorrow = todo.filter(i => i.due >= t1 && i.due < t2);
  const soon = todo.filter(i => i.due >= (evening ? t2 : t1) && i.due < t4);
  const focusList = evening ? tomorrow : today;
  const workMin = focusList.concat(evening ? [] : late).reduce((s, i) => s + (i.estMin || 0), 0);
  const tomorrowClasses = meetingsOn(cls.courses, cls.sem, t1 + 12 * 3600e3);
  const missedList = ((missed && missed.list) || []).filter(m => now - m.at < 2 * 864e5);
  // classes belong to School: hide them when another list is picked
  const showClasses = pick === "all" || pick === "school";
  return { now, evening, late, today, tomorrow, soon, focusList, workMin, cls, tomorrowClasses, sums, missedList, t0, reset, lists, pick, showClasses };
}

function pill(i, now) {
  if (i.due < now) return `<span class="ap-pill bad">late</span>`;
  if (i.due - now < 3 * 3600e3) return `<span class="ap-pill warn">${inTime(i.due - now)}</span>`;
  if (i.due >= addDays(now, 1)) return `<span class="ap-pill">${new Date(i.due).toLocaleDateString(undefined, { weekday: "short" })}</span>`;
  return `<span class="ap-pill">${timeOnly(i.due)}</span>`;
}
function kindLabel(i) { return i.kind === "step" ? "Step" : i.kind === "task" ? "To-do" : i.appName === "Deadlines" ? "" : i.appName; }

let rowLists = null;   // set by gather(): lists to name on rows, only when showing All
function itemRow(i, now) {
  const ln = rowLists && i.list && i.list !== "school" && !i.course ? byId(rowLists, i.list).name : "";
  const meta = [i.course || ln, kindLabel(i), i.due < now ? `was due ${dueLabel(i.due)}` : dueLabel(i.due)].filter(Boolean).join(" · ");
  return `<div class="ap-row" data-key="${esc(i.key)}">
    <button class="ap-check" data-act="done" aria-label="Mark done">${svg("check")}</button>
    <button class="grow td-open" data-act="open"><span class="t">${esc(i.title)}</span><span class="s">${esc(meta)}</span></button>
    ${pill(i, now)}
  </div>`;
}

function classBlock(g) {
  const { cls, now, evening } = g;
  if (!cls.courses.length) return `<button class="ap-card ap-row" data-go="#schedule"><span class="tile-ic" style="background:#2348c9">${svg("calendar")}</span><span class="grow"><span class="t">Add your classes</span><span class="s">Then Today shows what's on now and next.</span></span>${svg("chevronRight")}</button>`;
  const rows = [];
  const row = (label, x, sub) => `<button class="ap-row" data-go="#schedule"><span class="sc-dot" style="background:${colorOf(x.course)}"></span><span class="grow"><span class="t">${esc(x.course.code)} <span class="td-kind">${esc(label)}</span></span><span class="s">${esc(sub)}</span></span></button>`;
  if (evening) {
    if (g.tomorrowClasses.length) {
      const f = g.tomorrowClasses[0];
      rows.push(row("first class tomorrow", f, `${fmtTime(f.meeting.start)}${f.meeting.room ? " · " + f.meeting.room : ""} · ${g.tomorrowClasses.length} class${g.tomorrowClasses.length === 1 ? "" : "es"} tomorrow`));
    } else rows.push(`<div class="ap-row"><span class="grow"><span class="t">No classes tomorrow</span></span></div>`);
  } else {
    if (cls.now) rows.push(row("now", cls.now, `ends in ${inTime(cls.now.end - now)}${cls.now.meeting.room ? " · " + cls.now.meeting.room : ""}`));
    if (cls.next) rows.push(row("next", cls.next, `${fmtTime(cls.next.meeting.start)} · in ${inTime(cls.next.start - now)}${cls.next.meeting.room ? " · " + cls.next.meeting.room : ""}`));
    const left = cls.today.filter(x => x.start > now).length - (cls.next ? 1 : 0);
    if (left > 0) rows.push(`<div class="ap-row"><span class="grow"><span class="s">+ ${left} more class${left === 1 ? "" : "es"} later today</span></span></div>`);
    if (!cls.now && !cls.next) rows.push(`<div class="ap-row"><span class="grow"><span class="t">${cls.off.off ? esc(cls.off.label) : cls.today.length ? "Done with classes for today" : "No classes today"}</span>${cls.nextDay ? `<span class="s">Next: ${esc(cls.nextDay.course.code)} ${cls.nextDay.inDays === 1 ? "tomorrow" : new Date(cls.nextDay.start).toLocaleDateString(undefined, { weekday: "long" })} at ${fmtTime(cls.nextDay.meeting.start)}</span>` : ""}</span></div>`);
  }
  return `<div class="ap-card">${rows.join("")}</div>`;
}

function sumCard(s) {
  const tone = s.tone ? ` ${s.tone}` : "";
  return `<button class="ap-card td-sum${tone}" data-go="${esc(s.open)}">
    <span class="td-sum-k"><span class="tile-ic" style="background:linear-gradient(160deg,${s.app.color[0]},${s.app.color[1]})">${svg(s.app.icon)}</span>${esc(s.label)}</span>
    <span class="td-sum-v">${esc(s.value)}</span>
    ${typeof s.pct === "number" ? `<span class="ap-bar-meter"><i style="width:${Math.max(0, Math.min(100, s.pct))}%"></i></span>` : ""}
    ${s.sub ? `<span class="td-sum-s">${esc(s.sub)}</span>` : ""}
  </button>`;
}

/* ---------- view ---------- */
let ctx0, root, timer = null;
const $ = s => root.querySelector(s);

async function render() {
  const g = await gather();
  const { now, evening } = g;
  const dateText = new Date(evening ? addDays(now, 1) : now).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  const focusTitle = evening ? "Due tomorrow" : "Due today";
  const parts = [];

  parts.push(`<header class="td-head"><div><div class="td-eyebrow">${evening ? "Tonight, getting ready for" : "Today"}</div><h1>${esc(dateText)}</h1></div>
    <button class="pill-btn" id="td-add">${svg("plus")} Quick add</button></header>`);
  parts.push(`<div class="td-lists" role="group" aria-label="Show list">${[{ id: "all", name: "All" }, ...g.lists].map(l =>
    `<button data-list="${esc(l.id)}" aria-pressed="${g.pick === l.id}">${l.color ? `<i style="background:${esc(l.color)}"></i>` : ""}${esc(l.name)}</button>`).join("")}</div>`);

  if (g.missedList.length) parts.push(`<button class="ap-card ap-row td-missed" data-go="#reminders"><span class="tile-ic" style="background:#d23c41">${svg("bell")}</span><span class="grow"><span class="t">${g.missedList.length} reminder${g.missedList.length === 1 ? "" : "s"} came due while GooseOS was closed</span><span class="s">${esc(g.missedList.slice(0, 3).map(m => m.title).join(" · "))}</span></span>${svg("chevronRight")}</button>`);

  const rs = g.reset;
  if (rs.nudge) parts.push(`<button class="ap-card ap-row" data-go="#reset"><span class="tile-ic" style="background:linear-gradient(160deg,#38bdf8,#0369a1)">${svg("listChecks")}</span><span class="grow"><span class="t">Plan next week</span><span class="s">Five minutes: what's due, what's behind, your top 3.</span></span>${svg("chevronRight")}</button>`);
  if (rs.note) parts.push(`<div class="ap-card pad td-note"><span class="td-eyebrow">From Sunday you</span><span>${esc(rs.note)}</span></div>`);
  if (rs.pins.length) parts.push(`<section class="ap-sec"><h3>Must do this week<span class="n">${rs.pins.filter(p => p.done).length}/${rs.pins.length}</span></h3><div class="ap-card">${rs.pins.map(p => `<div class="ap-row ${p.done ? "done" : ""}">
      <button class="ap-check" data-act="pin" data-week="${rs.week}" data-pin="${esc(p.id)}" aria-label="${p.done ? "Done" : "Mark done"}">${svg("check")}</button>
      <button class="grow td-open" data-go="${esc(p.open)}"><span class="t">${esc(p.title)}</span>${p.sub ? `<span class="s">${esc(p.sub)}</span>` : ""}</button></div>`).join("")}</div></section>`);

  if (g.late.length) parts.push(`<section class="ap-sec bad"><h3>Overdue<span class="n">${g.late.length}</span></h3><div class="ap-card">${g.late.map(i => itemRow(i, now)).join("")}</div></section>`);

  const heavy = g.workMin > HEAVY_MIN ? `<span class="ap-pill warn">about ${Math.round(g.workMin / 60)}h of planned work</span>` : "";
  parts.push(`<section class="ap-sec"><h3>${focusTitle}<span class="n">${g.focusList.length}</span>${heavy}</h3>${g.focusList.length
    ? `<div class="ap-card">${g.focusList.map(i => itemRow(i, now)).join("")}</div>`
    : `<div class="ap-card"><div class="ap-empty"><b>Nothing due ${evening ? "tomorrow" : "today"}</b>${g.soon.length ? `Next up: ${esc(g.soon[0].title)}, ${esc(dueLabel(g.soon[0].due))}.` : "Enjoy it."}</div></div>`}</section>`);

  parts.push(`<div class="td-cols">${g.showClasses ? `<section class="ap-sec"><h3>${evening ? "Tomorrow's classes" : "Classes"}</h3>${classBlock(g)}</section>` : ""}
    ${g.sums.length ? `<section class="ap-sec"><h3>At a glance</h3><div class="td-sums">${g.sums.map(sumCard).join("")}</div></section>` : ""}</div>`);

  if (g.soon.length) parts.push(`<section class="ap-sec"><h3>Coming up<span class="n">${g.soon.length}</span></h3><div class="ap-card">${g.soon.map(i => itemRow(i, now)).join("")}</div></section>`);

  $("#td-body").innerHTML = parts.join("");
  $("#td-add").onclick = async () => { const cap = await import("../../capture.js"); cap.open(); };
}

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./today.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = `<div class="ap-bar"><button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button><span class="ap-title">Today</span></div>
    <div class="ap-scroll"><div class="ap-body" id="td-body"></div></div>`;
  el.addEventListener("click", async e => {
    const lp = e.target.closest("[data-list]");
    if (lp) { setPick(lp.dataset.list); render(); return; }
    const go = e.target.closest("[data-go]");
    if (go) { location.hash = go.dataset.go.replace(/^#/, ""); return; }
    const b = e.target.closest("[data-act]"); if (!b) return;
    if (b.dataset.act === "pin") {
      if (b.closest(".ap-row").classList.contains("done")) return;
      await togglePin(+b.dataset.week, b.dataset.pin); ctx0.toast("Must-do done."); render(); return;
    }
    const key = b.closest("[data-key]").dataset.key;
    if (b.dataset.act === "done") {
      await agenda.complete(key);
      ctx0.toast("Marked done.");
      render();
    } else if (b.dataset.act === "open") {
      const it = (await agenda.list({ done: true })).find(i => i.key === key);
      if (it) location.hash = it.open.replace(/^#/, "");
    }
  });
  store.onChange(() => { if (ctx.isActive()) { clearTimeout(rt); rt = setTimeout(render, 250); } });
  await render();
}
let rt = null;
function show() { render(); clearInterval(timer); timer = setInterval(() => { if (ctx0.isActive()) render(); }, 60000); }
function hide() { clearInterval(timer); }

/** The big widget at the top of the home screen. */
async function widget(el) {
  loadCss();
  const g = await gather();
  const { now, evening } = g;
  const list = [...(evening ? [] : g.late), ...g.focusList].slice(0, 3);
  const more = (evening ? 0 : g.late.length) + g.focusList.length - list.length;
  const c = g.cls;
  let classLine = "";
  if (c.courses.length && g.showClasses) {
    if (evening) { const f = g.tomorrowClasses[0]; classLine = f ? `First class tomorrow: <b>${esc(f.course.code)}</b> at ${fmtTime(f.meeting.start)}` : "No classes tomorrow"; }
    else if (c.now) classLine = `Now: <b>${esc(c.now.course.code)}</b>, ends in ${inTime(c.now.end - now)}${c.next ? ` · next ${esc(c.next.course.code)} at ${fmtTime(c.next.meeting.start)}` : ""}`;
    else if (c.next) classLine = `Next class: <b>${esc(c.next.course.code)}</b> at ${fmtTime(c.next.meeting.start)}${c.next.meeting.room ? ` · ${esc(c.next.meeting.room)}` : ""}`;
    else classLine = c.today.length ? "Done with classes for today" : "No classes today";
  }
  el.innerHTML = `<div class="w-k">${svg(evening ? "moon" : "sun")}${evening ? "Tomorrow" : "Today"}${g.pick !== "all" ? ` · ${esc(byId(g.lists, g.pick).name)}` : ""}${g.late.length && !evening ? ` · <span style="color:var(--bad)">${g.late.length} overdue</span>` : ""}</div>
    <div class="w-td-list">${list.length ? list.map(i => `<div class="w-td ${i.due < now ? "late" : i.due - now < 3 * 3600e3 ? "soon" : ""}"><b>${esc(i.title)}</b><span>${esc([i.course, i.due < now ? "late" : timeOnly(i.due)].filter(Boolean).join(" · "))}</span></div>`).join("")
      : `<div class="w-td-empty">Nothing due ${evening ? "tomorrow" : "today"}${g.soon.length ? `. Next: ${esc(g.soon[0].title)}, ${esc(dueLabel(g.soon[0].due))}` : ""}.</div>`}
      ${more > 0 ? `<div class="w-td-more">+ ${more} more</div>` : ""}</div>
    <div class="w-td-foot">${classLine ? `<span>${svg("calendar")}${classLine}</span>` : ""}${g.sums.map(s => `<span>${svg(s.app.icon)}${esc(s.label)}: <b>${esc(s.value)}</b></span>`).join("")}</div>`;
}

export default { id: APP, name: "Today", icon: "sun", color: ["#ffc04d", "#ff9f1c"], wideWidget: true, topWidget: true, mount, show, hide, widget };
