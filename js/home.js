// The home screen: two small widgets you pick, every app as an icon, one wide
// widget, and the dock. Built to fit on one phone screen without scrolling.
// Your widget picks are saved as app "shell", item "home": { small: [a, b], wide }.
import apps from "./apps/index.js";
import * as store from "./store.js";
import { svg, appSvg, tile } from "./icons.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const DOCK = ["today", "deadlines", "+", "whiteboard"];
const DEFAULT = { small: ["due", "class"], wide: "week" };

const tileStyle = a => tile(a.tint);
const app = id => apps.find(a => a.id === id && !a.hidden);
const fmtTime = t => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayName = t => new Date(t).toLocaleDateString(undefined, { weekday: "short" });
function left(ms) { const m = Math.max(1, Math.round(ms / 60000)); if (m < 60) return `${m}m`; const h = Math.floor(m / 60); return h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`; }
function dueText(t) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const days = Math.round((new Date(t).setHours(0, 0, 0, 0) - d0) / 864e5);
  return days === 0 ? fmtTime(t) : days === 1 ? `Tomorrow ${fmtTime(t)}` : `${dayName(t)} ${fmtTime(t)}`;
}

async function agendaList() { try { return await (await import("./agenda.js")).list(); } catch (e) { return []; } }

/* ---------- small widgets (pick any two) ---------- */
export const SMALL = {
  due: { label: "Due next", open: "today", async render(el) {
    const now = Date.now(), items = (await agendaList()).filter(i => i.due && i.kind !== "ping");
    const late = items.filter(i => i.due < now).length, next = items.find(i => i.due >= now);
    el.classList.add("h-due");
    el.innerHTML = `<span class="h-k">Due next</span>
      ${next ? `<span class="h-big">${left(next.due - now)}</span><span class="h-t">${esc(next.title)}</span><span class="h-s">${esc([next.course, dueText(next.due)].filter(Boolean).join(" · "))}</span>` : `<span class="h-big">All clear</span><span class="h-t">Nothing due</span><span class="h-s">Add one with the + below</span>`}
      ${late ? `<span class="h-late">${late} overdue</span>` : ""}`;
  } },
  class: { label: "Next class", open: "schedule", async render(el) {
    let st = null; try { st = await (await import("./apps/schedule/schedule.js")).status(); } catch (e) { /* no Schedule */ }
    const pick = st && (st.now || st.next || st.nextDay);
    el.classList.add("h-class");
    // open the shown class's sheet (room, what's due, the plan) instead of the whole schedule
    if (pick) el.dataset.open = `schedule/class/${encodeURIComponent(pick.course.id)}`;
    if (!pick) { el.innerHTML = `<span class="h-k">Classes</span><span class="h-t">${st && st.courses.length ? "No more classes this week" : "Add your classes in Schedule"}</span>`; return; }
    const big = st.now === pick ? "Now" : fmtTime(pick.start).replace(/\s?[AP]M$/i, "");
    el.innerHTML = `<span class="h-k">${st.now === pick ? "In class" : "Next class"}</span><span class="h-big">${esc(big)}</span>
      <span class="h-t"><i class="h-cdot" style="background:${esc(pick.course.color || "var(--accent)")}"></i>${esc(pick.course.code)}</span>
      <span class="h-when">${esc([st.now === pick ? `until ${fmtTime(pick.end)}` : st.next === pick ? "Today" : pick.inDays === 1 ? "Tomorrow" : dayName(pick.start), pick.meeting.room].filter(Boolean).join(" · ") || pick.course.name || "")}</span>`;
  } },
  milestone: { label: "Milestone", open: "milestones", async render(el) {
    let ms = []; try { ms = await (await import("./apps/milestones/milestones.js")).loadMilestones(); } catch (e) { /* none */ }
    const active = ms.filter(m => !m.deadlineDone && m.steps.some(s => !s.done)).sort((a, b) => a.due - b.due)[0];
    if (!active) { el.innerHTML = `<span class="h-k">Milestones</span><span class="h-t">Break a big project into steps</span>`; return; }
    const done = active.steps.filter(s => s.done).length, next = active.steps.filter(s => !s.done).sort((a, b) => a.date - b.date)[0];
    el.innerHTML = `<span class="h-k">${esc(active.title)}</span><span class="h-t">${esc(next.title)}</span><span class="h-s">${esc(dueText(next.date))}</span>
      <span class="h-meter"><i style="width:${Math.round(done / active.steps.length * 100)}%"></i></span><span class="h-s">${done}/${active.steps.length} steps</span>`;
  } },
  wallet: { label: "Wallet", open: "wallet", async render(el) {
    const a = app("wallet"); if (a && a.widget) await a.widget(el, { store, svg });
  } },
  whiteboard: { label: "Whiteboard", open: "whiteboard", async render(el) {
    const wb = app("whiteboard"); if (wb && wb.widget) await wb.widget(el, { store, svg });
  } },
  goose: { label: "Goose + sync", open: "settings", async render(el, ctx) {
    const s = ctx.syncState || {}, h = new Date().getHours();
    const hi = h < 5 ? "Up late," : h < 12 ? "Good morning," : h < 18 ? "Good afternoon," : "Good evening,";
    el.classList.add("h-goose");
    el.innerHTML = `<img src="icons/source/goose.png" alt=""><span class="h-s">${hi}</span><span class="h-name">Goose</span><span class="h-s"><i class="dot ${ctx.syncDot || ""}"></i>${esc(ctx.syncText || "")}</span>`;
  } },
};

/* ---------- wide widgets (pick one) ---------- */
export const WIDE = {
  week: { label: "This week", open: "today", async render(el) {
    // overdue means past due right now (same as the Due next widget); the day bubbles count what's still ahead
    const now = Date.now(), all = (await agendaList()).filter(i => i.due && i.kind !== "ping");
    const items = all.filter(i => i.due >= now), late = all.length - items.length;
    const d0 = new Date(); d0.setHours(0, 0, 0, 0);
    const days = [...Array(7)].map((_, i) => { const d = new Date(d0); d.setDate(d.getDate() + i); return d; });
    const count = d => items.filter(i => i.due >= +d && i.due < +d + 864e5).length;
    const total = days.reduce((n, d) => n + count(d), 0);
    el.innerHTML = `<span class="h-k">This week · ${total} due${late ? ` · <b class="h-late-k">${late} overdue</b>` : ""}</span>
      <div class="h-week">${days.map((d, i) => { const n = count(d); return `<div class="h-day ${i === 0 ? "today" : n >= 3 ? "busy" : ""}"><span>${d.toLocaleDateString(undefined, { weekday: "short" })}</span><i></i><b class="${n ? "" : "none"}">${n}</b></div>`; }).join("")}</div>`;
  } },
  today: { label: "Today (full)", open: "today", async render(el) { const a = app("today"); if (a && a.widget) await a.widget(el, { store, svg }); } },
  deadlines: { label: "Deadlines list", open: "deadlines", async render(el) { const a = app("deadlines"); if (a && a.widget) await a.widget(el, { store, svg }); } },
  none: { label: "None", open: "", async render() {} },
};

export async function loadPrefs() {
  const p = (await store.get("shell", "home")) || {};
  const small = Array.isArray(p.small) && p.small.length === 2 && p.small.every(k => SMALL[k]) ? p.small : DEFAULT.small;
  return { small, wide: WIDE[p.wide] ? p.wide : DEFAULT.wide };
}
export const savePrefs = p => store.put("shell", "home", p);

/* ---------- icons ---------- */
async function iconHtml(a, { label = true } = {}) {
  let badge = "";
  try { badge = a.badge ? (await a.badge()) || "" : ""; } catch (e) { badge = ""; }
  const face = `<span class="sq" style="${tileStyle(a)}">${appSvg(a.icon)}${badge ? `<span class="badge">${esc(badge)}</span>` : ""}</span>`;
  return `<button class="app-ic" data-open="${a.id}" aria-label="${esc(a.name)}${badge ? `, ${esc(badge)} need attention` : ""}">${face}${label ? `<span class="lb">${esc(a.name)}</span>` : ""}</button>`;
}

/** Draw the whole home screen. ctx: { settingsApp, syncState, syncText, syncDot } */
let homeRun = 0;
export async function renderHome(ctx) {
  // two redraws can overlap (sync and a local change at once); only the newest one keeps drawing
  const run = ++homeRun, stale = () => run !== homeRun;
  const prefs = await loadPrefs();
  if (stale()) return;
  const all = [...apps.filter(a => !a.hidden), ctx.settingsApp];

  // build everything off-screen, then swap it in at once so nothing blanks or jumps while widgets load
  const appsHtml = (await Promise.all(all.map(a => iconHtml(a)))).join("");
  const dockHtml = (await Promise.all(DOCK.map(id => id === "+"
    ? `<button class="app-ic dock-add" data-quick aria-label="Quick add a deadline"><span class="sq">${svg("plus")}</span></button>`
    : (app(id) ? iconHtml(app(id), { label: false }) : "")))).join("");
  if (stale()) return;

  const smalls = [];
  for (const key of prefs.small) {
    const w = SMALL[key]; if (!w) continue;
    const el = document.createElement("button");
    el.className = "widget h-small"; if (w.open) el.dataset.open = w.open; el.setAttribute("aria-label", w.label);
    try { await w.render(el, ctx); } catch (e) { console.error(e); }
    if (stale()) return;
    smalls.push(el);
  }

  const w = WIDE[prefs.wide];
  const wideEl = document.createElement("button");
  if (prefs.wide !== "none") { try { await w.render(wideEl, ctx); } catch (e) { console.error(e); } }
  if (stale()) return;

  $("#apps").innerHTML = appsHtml;
  $("#dock").innerHTML = dockHtml;
  $("#small-widgets").replaceChildren(...smalls);
  const wide = $("#wide-widget");
  wide.hidden = prefs.wide === "none";
  wide.className = "widget h-wide wide";
  wide.dataset.open = w.open; wide.setAttribute("aria-label", w.label);
  wide.replaceChildren(...wideEl.childNodes);
}

/** Settings rows for picking widgets. Calls onChange after saving. */
export async function pickerHtml() {
  const p = await loadPrefs();
  const opts = (list, cur) => Object.entries(list).map(([k, v]) => `<option value="${k}" ${k === cur ? "selected" : ""}>${esc(v.label)}</option>`).join("");
  return `<div class="group-h">Home screen</div><div class="group">
    <label class="row"><div class="grow t">Top left widget</div><select class="field h-pick" data-slot="0">${opts(SMALL, p.small[0])}</select></label>
    <label class="row"><div class="grow t">Top right widget</div><select class="field h-pick" data-slot="1">${opts(SMALL, p.small[1])}</select></label>
    <label class="row"><div class="grow t">Wide widget</div><select class="field h-pick" data-slot="wide">${opts(WIDE, p.wide)}</select></label>
  </div>`;
}
export async function wirePicker(root, onChange) {
  // keep the picks in memory and save one at a time, so quick back-to-back changes can't overwrite each other
  const p = await loadPrefs();
  let chain = Promise.resolve();
  root.querySelectorAll(".h-pick").forEach(sel => sel.onchange = () => {
    if (sel.dataset.slot === "wide") p.wide = sel.value; else p.small[+sel.dataset.slot] = sel.value;
    const snap = { small: [...p.small], wide: p.wide };
    chain = chain.then(() => savePrefs(snap)).then(() => onChange && onChange()).catch(e => console.error(e));
  });
}
