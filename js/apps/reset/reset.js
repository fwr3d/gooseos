// Weekly Reset: a five-minute Sunday checklist that sets up the week.
//   1. What's due: everything this week, by day, plus anything still overdue
//   2. Anything behind: Milestones projects with steps past their date
//   3. Pick up to 3 must-dos, pinned to the top of Today all week
//   4. A one-line note to Monday-you, shown on Today Monday and sent Monday 8 AM
//
// Saved items: app "reset", id "w-YYYY-MM-DD" (the Monday of the week planned):
//   { week (ms), pins: [{ id, key?, title, done }], note, doneAt (ms) }
//   A pin with a key points at an agenda item (a deadline, a step). Without
//   one it's a to-do you typed yourself.
// On Sunday you plan the week starting tomorrow. Any other day, this week.
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import * as agenda from "../../agenda.js";
import { loadMilestones } from "../milestones/milestones.js";
import { dueLabel } from "../deadlines/parse.js";

const APP = "reset", D = 864e5, MAX = 3, PING_HOUR = 20, NOTE_HOUR = 8;
const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
const addDays = (t, n) => { const d = new Date(dayStart(t)); d.setDate(d.getDate() + n); return +d; };
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const md = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const dayHead = t => new Date(t).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
const monday = t => addDays(t, -((new Date(t).getDay() + 6) % 7));
const isSunday = t => new Date(t).getDay() === 0;
const hours = m => m >= 90 ? `about ${Math.round(m / 60)}h` : `${Math.round(m / 5) * 5 || 5}m`;

/** The Monday of the week you'd plan right now. */
export const targetWeek = (now = Date.now()) => isSunday(now) ? addDays(now, 1) : monday(now);
const wid = w => `w-${ymd(w)}`;
async function getPlan(w) { const p = await store.get(APP, wid(w)); return p && p.doneAt ? p : null; }

/** The plan Today should show: the week you're in, or on Sunday the one you just planned. */
async function activePlan(now) {
  const w = targetWeek(now), p = await getPlan(w);
  if (p || !isSunday(now)) return { w, p };
  const w0 = monday(now);
  return { w: w0, p: await getPlan(w0) };
}

const kindLabel = i => i.kind === "step" ? "Step" : i.kind === "task" ? "To-do" : "";
const subOf = i => [i.course, kindLabel(i), dueLabel(i.due)].filter(Boolean).join(" · ");

/** For Today: pinned must-dos, Monday's note, and whether to nudge you to reset. */
export async function forToday(now = Date.now()) {
  const out = { week: 0, pins: [], note: "", nudge: false };
  out.nudge = isSunday(now) && new Date(now).getHours() >= 17 && !(await getPlan(addDays(now, 1)));
  const { w, p } = await activePlan(now);
  if (!p) return out;
  out.week = w;
  const items = await agenda.list({ done: true });
  out.pins = p.pins.map(pin => {
    if (!pin.key) return { ...pin, sub: "Your own", open: "#reset" };
    const it = items.find(i => i.key === pin.key);
    // Gone from the agenda means it was finished (or deleted) somewhere else.
    return it ? { ...pin, title: it.title, done: !!it.done, sub: subOf(it), open: it.open } : { ...pin, done: true, sub: "", open: "#reset" };
  });
  if (p.note && now >= w && now < addDays(w, 1)) out.note = p.note;
  return out;
}

/** Check off a pin. Pins that point at a deadline or step mark that done too. */
export async function togglePin(w, id) {
  const p = await store.get(APP, wid(w)); if (!p) return;
  const pin = p.pins.find(x => x.id === id); if (!pin) return;
  if (pin.key) { if (pin.done) return; await agenda.complete(pin.key); pin.done = true; }
  else pin.done = !pin.done;
  await store.put(APP, wid(w), p);
}

/* ---------- for Reminders ---------- */
async function agendaItems() {
  const now = Date.now(), out = [], next = addDays(monday(now), 7);
  // Sunday 8 PM, unless next week is already planned. (Can't count what's due here:
  // agenda() runs while the agenda is being built.)
  if (!(await getPlan(next))) out.push({ key: `${APP}:sun-${ymd(next)}`, title: "Weekly Reset", kind: "ping", due: addDays(next, -1) + PING_HOUR * 3600e3,
    done: false, open: "#reset", body: "Five minutes: see what's due this week and pick your top 3." });
  for (const w of [monday(now), next]) {
    const p = await getPlan(w), at = w + NOTE_HOUR * 3600e3;
    if (p && p.note && p.doneAt < at && now < addDays(w, 1))
      out.push({ key: `${APP}:note-${ymd(w)}`, title: "Note from Sunday you", kind: "ping", due: at, done: false, open: "#reset", body: p.note });
  }
  return out;
}
async function badge() {
  const now = Date.now();
  return isSunday(now) && new Date(now).getHours() >= 17 && !(await getPlan(addDays(now, 1))) ? 1 : "";
}

/* ---------- view ---------- */
const STEPS = ["What's due", "Anything behind?", "Pick your top 3", "Note to Monday-you"];
let ctx0, root, mode = "intro", step = 0, draft = null;
const $ = s => root.querySelector(s);

async function gather(now = Date.now()) {
  const w = targetWeek(now), end = addDays(w, 7);
  const items = (await agenda.list()).filter(i => i.due && i.kind !== "ping");
  const late = items.filter(i => i.due < now);
  const week = items.filter(i => i.due >= now && i.due < end);
  let ms = []; try { ms = await loadMilestones(); } catch (e) { /* no Milestones */ }
  const projects = ms.map(m => {
    const open = m.steps.filter(s => !s.done);
    return { m, behind: open.filter(s => s.date < now), thisWeek: open.filter(s => s.date >= now && s.date < end), next: open.sort((a, b) => a.date - b.date)[0] };
  }).filter(x => x.next && (x.behind.length || x.thisWeek.length || x.m.due < end)).sort((a, b) => b.behind.length - a.behind.length || a.m.due - b.m.due);
  return { now, w, end, late, week, projects, hasMs: ms.length > 0, plan: await getPlan(w) };
}

function row(i, { check = false } = {}) {
  return `<div class="ap-row" data-key="${esc(i.key)}">
    ${check ? `<button class="ap-check" data-act="done" aria-label="Mark done">${svg("check")}</button>` : ""}
    <a class="grow rs-link" href="${esc(i.open)}"><span class="t">${esc(i.title)}</span><span class="s">${esc(subOf(i))}</span></a>
  </div>`;
}

function stepDue(g) {
  const days = [];
  for (let t = dayStart(g.now); t < g.end; t = addDays(t, 1)) {
    const list = g.week.filter(i => i.due >= t && i.due < addDays(t, 1));
    if (list.length) days.push({ t, list });
  }
  const min = g.week.reduce((n, i) => n + (i.estMin || 0), 0);
  const busiest = days.slice().sort((a, b) => b.list.length - a.list.length)[0];
  const facts = [`${g.week.length} thing${g.week.length === 1 ? "" : "s"} due`, min ? `${hours(min)} of planned work` : "", busiest && busiest.list.length >= 3 ? `busiest: ${new Date(busiest.t).toLocaleDateString(undefined, { weekday: "long" })}` : ""].filter(Boolean);
  return `<p class="rs-lead">${esc(facts.join(" · "))}</p>
    ${g.late.length ? `<section class="ap-sec bad"><h3>Still overdue<span class="n">${g.late.length}</span></h3><div class="ap-card">${g.late.map(i => row(i, { check: true })).join("")}</div>
      <p class="rs-hint">Already done? Check it off so it stops nagging.</p></section>` : ""}
    ${days.length ? days.map(d => `<section class="ap-sec"><h3>${esc(d.t === dayStart(g.now) ? "Today" : dayHead(d.t))}<span class="n">${d.list.length}</span></h3><div class="ap-card">${d.list.map(i => row(i)).join("")}</div></section>`).join("")
      : `<div class="ap-card"><div class="ap-empty"><b>Nothing due this week</b>A light one. Good week to get ahead on something big.</div></div>`}`;
}

function stepBehind(g) {
  if (!g.projects.length) return `<div class="ap-card"><div class="ap-empty"><b>${g.hasMs ? "Nothing behind" : "No projects yet"}</b>${g.hasMs ? "Every project step is on track." : "Got a big paper or project coming? Milestones splits it into steps and spaces them out."}
    ${g.hasMs ? "" : `<div style="margin-top:12px"><a class="pill-btn secondary" href="#milestones">Open Milestones</a></div>`}</div></div>`;
  return `<p class="rs-lead">${g.projects.some(x => x.behind.length) ? "Catch these up early in the week, before they stack." : "All on track. Here's what's planned this week."}</p>
    <div class="ap-card">${g.projects.map(x => `<a class="ap-row rs-link" href="#milestones/${esc(x.m.id)}">
      <span class="grow"><span class="t">${esc(x.m.title)}</span><span class="s">Next: ${esc(x.next.title)} · ${esc(dueLabel(x.next.date))}</span></span>
      ${x.behind.length ? `<span class="ap-pill bad">${x.behind.length} behind</span>` : x.thisWeek.length ? `<span class="ap-pill">${x.thisWeek.length} this week</span>` : `<span class="ap-pill">due ${esc(md(x.m.due))}</span>`}
    </a>`).join("")}</div>`;
}

function stepPick(g) {
  const keys = new Set(draft.pins.map(p => p.key).filter(Boolean));
  const own = draft.pins.filter(p => !p.key);
  const cands = [...g.late, ...g.week];
  const pick = (on, attrs, title, sub) => `<button class="ap-row rs-pick ${on ? "on" : ""}" ${attrs} aria-pressed="${on}"><span class="rs-box">${svg("check")}</span><span class="grow"><span class="t">${esc(title)}</span>${sub ? `<span class="s">${esc(sub)}</span>` : ""}</span></button>`;
  return `<p class="rs-lead">The things that would make this week a win. They stay at the top of Today until Sunday. <b class="rs-count">${draft.pins.length}/${MAX}</b></p>
    ${own.length || cands.length ? `<div class="ap-card">
      ${own.map(p => pick(true, `data-act="unpin" data-id="${esc(p.id)}"`, p.title, "Your own")).join("")}
      ${cands.map(i => pick(keys.has(i.key), `data-act="pick" data-key="${esc(i.key)}"`, i.title, (i.due < g.now ? "Overdue · " : "") + subOf(i))).join("")}
    </div>` : ""}
    <form class="rs-own" id="rs-own"><input class="field" id="rs-own-t" placeholder="Or add your own, like “email advisor”" maxlength="80" autocomplete="off"><button class="pill-btn secondary">Add</button></form>`;
}

function stepNote() {
  return `<p class="rs-lead">One line for Monday morning. It shows on Today and comes as a notification at ${NOTE_HOUR} AM.</p>
    <textarea class="field rs-note" id="rs-note" rows="3" maxlength="200" placeholder="Like: start the CS project before Wednesday, not after.">${esc(draft.note)}</textarea>`;
}

function viewIntro(g) {
  const last = g.week.length;
  return `<div class="rs-intro ap-card pad">
    <span class="rs-ic">${svg("listChecks")}</span>
    <h2>Reset the week of ${esc(md(g.w))}</h2>
    <p class="rs-lead">Five minutes: see what's due, catch anything behind, pick your top 3, and leave a note for Monday-you.</p>
    <p class="rs-hint">${last ? `${last} thing${last === 1 ? "" : "s"} due between now and Sunday${g.late.length ? `, plus ${g.late.length} overdue` : ""}.` : "Nothing due yet this week."}</p>
    <button class="pill-btn" data-act="start">Start</button>
  </div>`;
}

async function viewDone(g) {
  const t = await forToday(g.now);
  const pins = t.week === g.w ? t.pins : [];
  const done = pins.filter(p => p.done).length;
  return `<header class="rs-head"><div><div class="rs-eyebrow">Weekly Reset</div><h1>Week of ${esc(md(g.w))} is set</h1></div>
      <button class="pill-btn secondary" data-act="redo">Redo</button></header>
    <section class="ap-sec"><h3>Must do this week<span class="n">${done}/${pins.length}</span></h3>
      <div class="ap-card">${pins.length ? pins.map(p => `<div class="ap-row ${p.done ? "done" : ""}"><button class="ap-check" data-act="pin" data-id="${esc(p.id)}" aria-label="${p.done ? "Done" : "Mark done"}">${svg("check")}</button>
        <a class="grow rs-link" href="${esc(p.open)}"><span class="t">${esc(p.title)}</span>${p.sub ? `<span class="s">${esc(p.sub)}</span>` : ""}</a></div>`).join("")
        : `<div class="ap-empty"><b>No must-dos picked</b>Redo the reset to pick up to 3.</div>`}</div>
    </section>
    ${g.plan.note ? `<section class="ap-sec"><h3>Note for Monday</h3><div class="ap-card pad rs-quote">${esc(g.plan.note)}</div></section>` : ""}
    <p class="rs-hint">${g.week.length} thing${g.week.length === 1 ? "" : "s"} due between now and Sunday. Next reset: Sunday at ${PING_HOUR - 12} PM.</p>`;
}

async function render() {
  const g = await gather();
  if (mode === "done" && !g.plan) mode = "intro";
  let html;
  if (mode === "intro") html = viewIntro(g);
  else if (mode === "done") html = await viewDone(g);
  else {
    const body = [stepDue, stepBehind, stepPick, stepNote][step](g);
    html = `<div class="rs-steps" aria-hidden="true">${STEPS.map((_, i) => `<i class="${i < step ? "past" : i === step ? "cur" : ""}"></i>`).join("")}</div>
      <div class="rs-eyebrow">Step ${step + 1} of ${STEPS.length} · week of ${esc(md(g.w))}</div>
      <h2 class="rs-h">${STEPS[step]}</h2>
      ${body}
      <div class="rs-foot"><button class="pill-btn secondary" data-act="back">${step ? "Back" : "Cancel"}</button>
        <button class="pill-btn" data-act="${step === STEPS.length - 1 ? "finish" : "next"}">${step === STEPS.length - 1 ? "Finish" : "Next"}</button></div>`;
  }
  $("#rs-body").innerHTML = html;
  const own = $("#rs-own");
  if (own) own.onsubmit = e => {
    e.preventDefault();
    const t = $("#rs-own-t").value.trim(); if (!t) return;
    if (draft.pins.length >= MAX) { ctx0.toast(`Pick ${MAX} at most. Unpick one first.`); return; }
    draft.pins.push({ id: "p" + uid(), title: t }); render().then(() => $("#rs-own-t") && $("#rs-own-t").focus());
  };
  const note = $("#rs-note");
  if (note) { note.oninput = () => { draft.note = note.value; }; note.focus(); }
}

async function startWizard(from) {
  draft = { pins: from ? from.pins.map(p => ({ ...p })) : [], note: from ? from.note || "" : "" };
  mode = "wizard"; step = 0;
  await render(); root.querySelector(".ap-scroll").scrollTop = 0;
}

async function finish() {
  const now = Date.now(), w = targetWeek(now), old = await store.get(APP, wid(w));
  const was = new Map(((old && old.pins) || []).map(p => [p.key || p.id, p.done]));
  await store.put(APP, wid(w), { week: w, note: draft.note.trim(), doneAt: now,
    pins: draft.pins.map(p => ({ id: p.id, ...(p.key ? { key: p.key } : {}), title: p.title, done: !!was.get(p.key || p.id) })) });
  agenda.refresh();
  const n = draft.pins.length;
  mode = "done"; draft = null;
  ctx0.toast(n ? `Week set. Your ${n === 1 ? "must-do is" : `${n} must-dos are`} pinned to Today.` : "Week set.");
  await render(); root.querySelector(".ap-scroll").scrollTop = 0;
}

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./reset.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = `<div class="ap-bar"><button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button><span class="ap-title">Weekly Reset</span></div>
    <div class="ap-scroll"><div class="ap-body" id="rs-body"></div></div>`;
  el.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const act = b.dataset.act, scrollTop = () => { root.querySelector(".ap-scroll").scrollTop = 0; };
    if (act === "start") startWizard(null);
    else if (act === "redo") startWizard(await getPlan(targetWeek()));
    else if (act === "next") { step++; await render(); scrollTop(); }
    else if (act === "back") { if (step) { step--; await render(); scrollTop(); } else { mode = (await getPlan(targetWeek())) ? "done" : "intro"; draft = null; render(); } }
    else if (act === "finish") finish();
    else if (act === "done") { await agenda.complete(b.closest("[data-key]").dataset.key); ctx0.toast("Marked done."); render(); }
    else if (act === "pin") { await togglePin(targetWeek(), b.dataset.id); render(); }
    else if (act === "unpin") { draft.pins = draft.pins.filter(p => p.id !== b.dataset.id); render(); }
    else if (act === "pick") {
      const key = b.dataset.key, i = draft.pins.findIndex(p => p.key === key);
      if (i >= 0) draft.pins.splice(i, 1);
      else if (draft.pins.length >= MAX) { ctx0.toast(`Pick ${MAX} at most. Unpick one first.`); return; }
      else draft.pins.push({ id: "p" + uid(), key, title: b.querySelector(".t").textContent });
      render();
    }
  });
  store.onChange(ch => { if (ch.source === "remote" && ctx.isActive() && mode !== "wizard") render(); });
}

async function show(arg) {
  if (mode === "wizard" && draft) return render();
  if (arg === "start") return startWizard(null);
  mode = (await getPlan(targetWeek())) ? "done" : "intro";
  await render();
}

export default { id: APP, name: "Weekly Reset", icon: "listChecks", color: ["#38bdf8", "#0369a1"], mount, show, badge, agenda: agendaItems, complete() {} };
