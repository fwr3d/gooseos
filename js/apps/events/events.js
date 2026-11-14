// Event Planner (social chair): parties, date nights, mixers, formals and
// philanthropy events, each with a checklist that counts back from the event
// date, a budget, and a debrief afterwards.
// Hidden for now: it's off the home screen and out of Today/Reminders. Open it
// from Settings → Hidden apps. Remove `hidden: true` at the bottom to show it.
//
// Saved items:
//   app "events": { name, type, start (ms), venue, theme, partner: { chapter, contact }, budgetCents,
//                   lines: [{ id, label, estCents, actCents }], tasks: [{ id, title, offsetDays, owner, done }],
//                   debrief: { turnout, cost, went, fix }, notes }
//   app "event-templates": { name, type, tasks: [{ title, offsetDays }], lines: [{ label, estCents }], notes }
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import * as agenda from "../../agenda.js";

const APP = "events", TPL = "event-templates";
const D = 864e5;
const TYPES = {
  party: { label: "Party", color: "#d13f93" },
  datenight: { label: "Date night", color: "#8b5cf6" },
  mixer: { label: "Mixer", color: "#0e9fb0" },
  formal: { label: "Formal", color: "#2348c9" },
  philanthropy: { label: "Philanthropy", color: "#22a45d" },
  other: { label: "Other", color: "#64748b" },
};
// Starter checklists. offsetDays is relative to the event day (negative = before).
const BUILT_IN = {
  party: [["Pick theme + date, check the chapter calendar", -21], ["Register the event / risk forms (if required)", -14], ["Book DJ or set up music", -10], ["Plan the guest list", -7], ["Assign sober monitors + door", -3], ["Buy supplies, decorations", -2], ["Confirm DJ and helpers", -1], ["Setup crew", 0], ["Cleanup crew", 1], ["Debrief: turnout, cost, what to fix", 2]],
  datenight: [["Pick venue + theme", -28], ["Get budget approved", -21], ["Book venue / reservations", -21], ["Book transportation", -14], ["Announce + collect RSVPs", -14], ["Register the event / risk forms (if required)", -10], ["Final headcount to venue", -5], ["Confirm transportation", -2], ["Day-of timeline sent to chapter", -1], ["Debrief: turnout, cost, what to fix", 2]],
  mixer: [["Reach out to their social chair", -21], ["Lock date + theme with them", -14], ["Book venue / DJ", -10], ["Register the event / risk forms (if required)", -7], ["Theme announced in group chat", -5], ["Assign sober monitors + door list", -3], ["Buy supplies, confirm vendors", -1], ["Thank-you message to their chapter", 1], ["Debrief: turnout, cost, what to fix", 2]],
  formal: [["Shortlist venues + get quotes", -60], ["Book venue", -45], ["Book photographer / DJ", -35], ["Book transportation", -30], ["Collect payments / RSVPs", -21], ["Register the event / risk forms (if required)", -14], ["Final headcount + dietary needs", -7], ["Confirm every vendor", -3], ["Day-of timeline sent to chapter", -1], ["Debrief: turnout, cost, what to fix", 3]],
  philanthropy: [["Pick cause + format", -30], ["Get approvals / reserve space", -21], ["Make flyers + social posts", -14], ["Ask other chapters to join", -10], ["Volunteer sign-up sheet", -7], ["Buy supplies", -3], ["Log service hours for everyone", 1], ["Send money raised + thank-yous", 3], ["Debrief: turnout, raised, what to fix", 3]],
  other: [["Plan details", -14], ["Confirm everything", -2], ["Debrief", 1]],
};

const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const money = c => (c || c === 0) ? `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}` : "";
const toCents = v => { const n = parseFloat(String(v).replace(/[$,\s]/g, "")); return isFinite(n) ? Math.round(n * 100) : 0; };
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
const taskDate = (ev, t) => { const d = new Date(dayStart(ev.start)); d.setDate(d.getDate() + t.offsetDays); return +d; };
const taskDue = (ev, t) => t.offsetDays === 0 ? ev.start : taskDate(ev, t) + 20 * 3600e3;   // 8 PM that day, or the event start
const fmtDay = t => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
const fmtWhen = t => `${fmtDay(t)}, ${new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`;
const localInput = t => { if (!t) return ""; const x = new Date(t); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
const offText = n => n === 0 ? "day of" : n < 0 ? `${-n}d before` : `${n}d after`;

/* ---------- data ---------- */
export async function loadEvents() {
  return (await store.list(APP)).map(r => ({ id: r.id, ...r.data })).filter(e => e && e.name).sort((a, b) => a.start - b.start);
}
async function loadTemplates() { return (await store.list(TPL)).map(r => ({ id: r.id, ...r.data })).filter(t => t && t.name); }
const getEvent = async id => { const d = await store.get(APP, id); return d ? { id, ...d } : null; };
async function saveEvent(ev) { const { id, ...data } = ev; await store.put(APP, id, data); }

/** Event days + every open checklist item, for Today and Reminders (once the app isn't hidden). */
async function agendaItems() {
  const out = [], now = Date.now();
  for (const ev of await loadEvents()) {
    if (ev.start < now - 7 * D) continue;
    out.push({ key: `events:${ev.id}:event`, title: ev.name, due: ev.start, kind: "event", done: ev.start < now, open: `#events/${ev.id}` });
    for (const t of ev.tasks || []) out.push({ key: `events:${ev.id}:${t.id}`, title: `${t.title} · ${ev.name}`, due: taskDue(ev, t), kind: "task", done: !!t.done, open: `#events/${ev.id}` });
  }
  return out;
}
async function completeKey(key) {
  const [, eid, tid] = String(key).split(":");
  const ev = await getEvent(eid); if (!ev) return;
  const t = (ev.tasks || []).find(x => x.id === tid); if (!t) return;
  t.done = true; await saveEvent(ev);
}

/* ---------- view ---------- */
let ctx0, root, openId = "";
const $ = s => root.querySelector(s);
function setRoute(id) { openId = id; history.replaceState(null, "", `${location.pathname}${location.search}#events${id ? "/" + id : ""}`); }

async function nearbyDeadlines(ev) {
  // exams/deadlines within a day of the event, so you see clashes early
  const items = (await agenda.list()).filter(i => i.due && (i.kind === "deadline" || i.kind === "exam"));
  return items.filter(i => Math.abs(i.due - ev.start) < 1.2 * D);
}

async function renderList() {
  const now = Date.now();
  const evs = await loadEvents();
  const upcoming = evs.filter(e => e.start >= dayStart(now));
  const past = evs.filter(e => e.start < dayStart(now)).reverse();
  const card = async e => {
    const tasks = e.tasks || [], done = tasks.filter(t => t.done).length;
    const lateTasks = tasks.filter(t => !t.done && taskDue(e, t) < now).length;
    const spent = (e.lines || []).reduce((s, l) => s + (l.actCents || l.estCents || 0), 0);
    const clash = e.start >= now ? await nearbyDeadlines(e) : [];
    const ty = TYPES[e.type] || TYPES.other;
    return `<button class="ap-card ev-card" data-ev="${e.id}">
      <span class="ev-date" style="--c:${ty.color}"><b>${new Date(e.start).toLocaleDateString(undefined, { month: "short" })}</b><span>${new Date(e.start).getDate()}</span></span>
      <span class="grow">
        <span class="t">${esc(e.name)}</span>
        <span class="s">${esc(ty.label)} · ${fmtWhen(e.start)}${e.venue ? " · " + esc(e.venue) : ""}</span>
        <span class="ev-meta">
          ${tasks.length ? `<span class="ap-pill ${lateTasks ? "bad" : done === tasks.length ? "good" : ""}">${done}/${tasks.length} done${lateTasks ? ` · ${lateTasks} late` : ""}</span>` : ""}
          ${e.budgetCents ? `<span class="ap-pill ${spent > e.budgetCents ? "bad" : ""}">${money(spent)} of ${money(e.budgetCents)}</span>` : ""}
          ${clash.length ? `<span class="ap-pill warn">${svg("triangleAlert")} ${esc(clash[0].course || clash[0].title)} due ${new Date(clash[0].due).toLocaleDateString(undefined, { weekday: "short" })}</span>` : ""}
        </span>
      </span>${svg("chevronRight")}</button>`;
  };
  $("#ev-body").innerHTML = `
    <div class="ev-hidden-note">${svg("bellOff")} Hidden app: not on your home screen, Today or Reminders yet.</div>
    <section class="ap-sec"><h3>Upcoming<span class="n">${upcoming.length}</span></h3>
      ${upcoming.length ? `<div class="ev-list">${(await Promise.all(upcoming.map(card))).join("")}</div>` : `<div class="ap-card"><div class="ap-empty"><b>No events planned</b>Tap + to plan a party, date night, mixer, formal or philanthropy event. Each one starts with a checklist.</div></div>`}
    </section>
    ${past.length ? `<section class="ap-sec"><h3>Past<span class="n">${past.length}</span></h3><div class="ev-list">${(await Promise.all(past.slice(0, 12).map(card))).join("")}</div></section>` : ""}`;
}

async function renderDetail(id) {
  const ev = await getEvent(id);
  if (!ev) { setRoute(""); return renderList(); }
  const now = Date.now(), ty = TYPES[ev.type] || TYPES.other;
  const tasks = [...(ev.tasks || [])].sort((a, b) => a.offsetDays - b.offsetDays);
  const lines = ev.lines || [];
  const est = lines.reduce((s, l) => s + (l.estCents || 0), 0), act = lines.reduce((s, l) => s + (l.actCents || 0), 0);
  const used = lines.reduce((s, l) => s + (l.actCents || l.estCents || 0), 0);
  const pct = ev.budgetCents ? Math.round(used / ev.budgetCents * 100) : 0;
  const clash = await nearbyDeadlines(ev);
  const after = now > ev.start;
  const d = ev.debrief || {};
  $("#ev-body").innerHTML = `
    <button class="link-btn ev-back" id="ev-back">${svg("chevronLeft")} All events</button>
    <header class="ev-head">
      <span class="chip" style="background:${ty.color};color:#fff">${esc(ty.label)}</span>
      <h1>${esc(ev.name)}</h1>
      <div class="ev-facts">
        <span>${svg("calendar")}${fmtWhen(ev.start)}</span>
        ${ev.venue ? `<span>${svg("mapPin")}${esc(ev.venue)}</span>` : ""}
        ${ev.theme ? `<span>${svg("ticket")}${esc(ev.theme)}</span>` : ""}
        ${ev.partner && ev.partner.chapter ? `<span>${svg("users")}${esc(ev.partner.chapter)}${ev.partner.contact ? " · " + esc(ev.partner.contact) : ""}</span>` : ""}
      </div>
      <div class="ev-actions"><button class="pill-btn secondary" id="ev-edit">${svg("pencil")} Details</button><button class="pill-btn secondary" id="ev-dup">${svg("copy")} Duplicate</button><button class="pill-btn secondary" id="ev-tpl">Save as template</button></div>
    </header>
    ${clash.length ? `<div class="ap-card pad ev-clash">${svg("triangleAlert")}<span><b>Heads up:</b> ${clash.map(c => `${esc(c.course ? c.course + " " : "")}${esc(c.title)} (${new Date(c.due).toLocaleDateString(undefined, { weekday: "short" })})`).join(", ")} ${clash.length === 1 ? "is" : "are"} due within a day of this event.</span></div>` : ""}
    <div class="ev-cols">
      <section class="ap-sec"><h3>Checklist<span class="n">${tasks.filter(t => t.done).length}/${tasks.length}</span></h3>
        <div class="ap-card">${tasks.map(t => {
          const due = taskDue(ev, t), late = !t.done && due < now;
          return `<div class="ap-row ${t.done ? "done" : ""}" data-task="${t.id}">
            <button class="ap-check" data-act="toggle" aria-label="${t.done ? "Mark not done" : "Mark done"}">${svg("check")}</button>
            <span class="grow"><span class="t">${esc(t.title)}</span><span class="s">${fmtDay(taskDate(ev, t))} · ${offText(t.offsetDays)}${t.owner ? ` · <b>${esc(t.owner)}</b>` : ""}</span></span>
            ${late ? `<span class="ap-pill bad">late</span>` : ""}
            <button class="icon-btn" data-act="owner" aria-label="Assign to someone" title="Assign to someone">${svg("users")}</button>
            <button class="icon-btn" data-act="rm" aria-label="Remove task">${svg("x")}</button>
          </div>`; }).join("") || `<div class="ap-empty">No tasks yet.</div>`}
          <form class="ev-add" id="ev-add-task" autocomplete="off">
            <input class="field" id="ev-task-title" placeholder="Add a task…" aria-label="New task">
            <select class="field" id="ev-task-off" aria-label="When">${[-60, -45, -30, -21, -14, -10, -7, -5, -3, -2, -1, 0, 1, 2, 3].map(n => `<option value="${n}" ${n === -7 ? "selected" : ""}>${offText(n)}</option>`).join("")}</select>
            <button class="pill-btn" type="submit">Add</button>
          </form>
        </div>
      </section>
      <section class="ap-sec"><h3>Budget</h3>
        <div class="ap-card pad">
          <div class="ev-budget-top"><span class="ev-big">${money(used) || "$0"}</span><span class="ev-of">${ev.budgetCents ? `of ${money(ev.budgetCents)}` : "no budget set"}</span></div>
          ${ev.budgetCents ? `<div class="ap-bar-meter"><i style="width:${Math.min(100, pct)}%;background:${pct > 100 ? "var(--bad)" : pct > 85 ? "var(--warn)" : "var(--good)"}"></i></div>` : ""}
          <div class="ev-lines">
            <div class="ev-line ev-line-h"><span>Item</span><span>Estimate</span><span>Actual</span><span></span></div>
            ${lines.map(l => `<div class="ev-line" data-line="${l.id}"><input class="field" data-k="label" value="${esc(l.label)}" aria-label="Item"><input class="field" data-k="est" inputmode="decimal" value="${l.estCents ? (l.estCents / 100) : ""}" placeholder="0" aria-label="Estimate"><input class="field" data-k="act" inputmode="decimal" value="${l.actCents ? (l.actCents / 100) : ""}" placeholder="—" aria-label="Actual"><button class="icon-btn" data-act="rm-line" aria-label="Remove line">${svg("x")}</button></div>`).join("")}
          </div>
          <button class="link-btn" id="ev-add-line" style="align-self:flex-start;padding:2px 0">+ Add a line</button>
          <span class="ap-hint">Estimates ${money(est) || "$0"} · spent so far ${money(act) || "$0"}</span>
        </div>
      </section>
    </div>
    <section class="ap-sec"><h3>${after ? "Debrief" : "Debrief (after the event)"}</h3>
      <form class="ap-card pad ev-debrief" id="ev-debrief">
        <div class="ev-two"><label>Turnout<input class="field" name="turnout" inputmode="numeric" value="${esc(d.turnout)}" placeholder="How many came"></label><label>Final cost<input class="field" name="cost" inputmode="decimal" value="${esc(d.cost)}" placeholder="${money(act) || "$"}"></label></div>
        <label>What went well<textarea class="field" name="went" rows="2">${esc(d.went)}</textarea></label>
        <label>Fix next time<textarea class="field" name="fix" rows="2">${esc(d.fix)}</textarea></label>
        <button class="pill-btn" type="submit" style="align-self:flex-start">Save debrief</button>
      </form>
    </section>`;

  $("#ev-back").onclick = () => { setRoute(""); renderList(); };
  $("#ev-edit").onclick = () => openEventSheet(ev);
  $("#ev-dup").onclick = () => duplicate(ev);
  $("#ev-tpl").onclick = () => saveTemplate(ev);
  $("#ev-add-task").onsubmit = async e => {
    e.preventDefault();
    const title = $("#ev-task-title").value.trim(); if (!title) return;
    ev.tasks = [...(ev.tasks || []), { id: uid(), title, offsetDays: +$("#ev-task-off").value, owner: "", done: false }];
    await saveEvent(ev); renderDetail(id);
  };
  $("#ev-add-line").onclick = async () => { ev.lines = [...lines, { id: uid(), label: "", estCents: 0, actCents: 0 }]; await saveEvent(ev); renderDetail(id); };
  root.querySelectorAll(".ev-line[data-line] input").forEach(inp => inp.onchange = async () => {
    const l = ev.lines.find(x => x.id === inp.closest("[data-line]").dataset.line);
    if (inp.dataset.k === "label") l.label = inp.value.trim(); else l[inp.dataset.k === "est" ? "estCents" : "actCents"] = toCents(inp.value);
    await saveEvent(ev); renderDetail(id);
  });
  $("#ev-debrief").onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    ev.debrief = { turnout: f.turnout.value.trim(), cost: f.cost.value.trim(), went: f.went.value.trim(), fix: f.fix.value.trim() };
    await saveEvent(ev); ctx0.toast("Debrief saved. It carries over if you duplicate or template this event.");
  };
}

async function onDetailClick(e) {
  const b = e.target.closest("[data-act]"); if (!b || !openId) return;
  const ev = await getEvent(openId); if (!ev) return;
  const tr = b.closest("[data-task]"), lr = b.closest("[data-line]");
  if (tr) {
    const t = ev.tasks.find(x => x.id === tr.dataset.task);
    if (b.dataset.act === "toggle") t.done = !t.done;
    else if (b.dataset.act === "rm") ev.tasks = ev.tasks.filter(x => x !== t);
    else if (b.dataset.act === "owner") return askOwner(ev, t);
  } else if (lr && b.dataset.act === "rm-line") ev.lines = ev.lines.filter(x => x.id !== lr.dataset.line);
  else return;
  await saveEvent(ev); renderDetail(ev.id);
}

function sheet(html) {
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet" role="dialog" aria-modal="true">${html}</form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  f.querySelectorAll('[data-act="cancel"]').forEach(b => b.onclick = close);
  return { f, close };
}
const sheetActs = (left = "<span></span>", label = "Save") => `<div class="acts">${left}<span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">${label}</button></span></div>`;

function askOwner(ev, t) {
  const { f, close } = sheet(`<h2>Who's doing this?</h2><p class="note">${esc(t.title)}. Only you get the reminder, so you know who to check on.</p>
    <label>Name<input class="field" name="owner" value="${esc(t.owner)}" placeholder="A brother's name" list="ev-owners"></label>
    <datalist id="ev-owners">${[...new Set((ev.tasks || []).map(x => x.owner).filter(Boolean))].map(o => `<option value="${esc(o)}">`).join("")}</datalist>
    ${sheetActs()}`);
  f.owner.focus();
  f.onsubmit = async e => { e.preventDefault(); t.owner = f.owner.value.trim(); await saveEvent(ev); close(); renderDetail(ev.id); };
}

async function openEventSheet(ev) {
  const isNew = !ev;
  const tpls = isNew ? await loadTemplates() : [];
  const nextSat = (() => { const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7) + 14); d.setHours(21, 0, 0, 0); return +d; })();
  ev = ev || { name: "", type: "party", start: nextSat, venue: "", theme: "", partner: { chapter: "", contact: "" }, budgetCents: 0 };
  const { f, close } = sheet(`<h2>${isNew ? "Plan an event" : "Event details"}</h2>
    <label>Name<input class="field" name="name" required value="${esc(ev.name)}" placeholder="Winter Mixer"></label>
    <div class="two">
      <label>Type<select class="field" name="type">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}" ${ev.type === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
      <label>When<input class="field" type="datetime-local" name="start" required value="${localInput(ev.start)}"></label>
    </div>
    ${isNew ? `<label>Start from<select class="field" name="tpl"><option value="">Built-in checklist for this type</option>${tpls.map(t => `<option value="${t.id}">Your template: ${esc(t.name)}</option>`).join("")}<option value="none">An empty checklist</option></select></label>` : ""}
    <div class="two">
      <label>Venue<input class="field" name="venue" value="${esc(ev.venue)}" placeholder="Chapter house"></label>
      <label>Theme<input class="field" name="theme" value="${esc(ev.theme)}" placeholder="Après ski"></label>
    </div>
    <div class="two ev-partner">
      <label>Partner chapter<input class="field" name="chapter" value="${esc(ev.partner && ev.partner.chapter)}" placeholder="For mixers"></label>
      <label>Their contact<input class="field" name="contact" value="${esc(ev.partner && ev.partner.contact)}" placeholder="Social chair name / number"></label>
    </div>
    <label>Budget<input class="field" name="budget" inputmode="decimal" value="${ev.budgetCents ? ev.budgetCents / 100 : ""}" placeholder="$600"></label>
    ${!isNew ? `<p class="note">Changing the date moves every checklist item with it.</p>` : ""}
    ${sheetActs(isNew ? "<span></span>" : `<button type="button" class="pill-btn secondary" data-act="del" style="color:var(--bad)">Delete event</button>`, isNew ? "Create" : "Save")}`);
  const del = f.querySelector('[data-act="del"]');
  if (del) del.onclick = () => {
    del.textContent = "Tap again to delete"; del.onclick = async () => { close(); await store.remove(APP, ev.id); ctx0.toast(`Deleted ${ev.name}`); setRoute(""); renderList(); };
  };
  setTimeout(() => f.name.focus(), 50);
  f.onsubmit = async e => {
    e.preventDefault();
    const next = { ...ev, name: f.name.value.trim(), type: f.type.value, start: new Date(f.start.value).getTime(), venue: f.venue.value.trim(), theme: f.theme.value.trim(),
      partner: { chapter: f.chapter.value.trim(), contact: f.contact.value.trim() }, budgetCents: toCents(f.budget.value) };
    if (isNew) {
      next.id = "e-" + uid();
      const tpl = f.tpl.value;
      if (tpl === "none") { next.tasks = []; next.lines = []; }
      else if (tpl) { const t = tpls.find(x => x.id === tpl); next.tasks = t.tasks.map(x => ({ id: uid(), title: x.title, offsetDays: x.offsetDays, owner: "", done: false })); next.lines = (t.lines || []).map(l => ({ id: uid(), label: l.label, estCents: l.estCents, actCents: 0 })); next.notes = t.notes || ""; }
      else { next.tasks = (BUILT_IN[next.type] || BUILT_IN.other).map(([title, offsetDays]) => ({ id: uid(), title, offsetDays, owner: "", done: false })); next.lines = []; }
    }
    await saveEvent(next); close();
    setRoute(next.id); renderDetail(next.id);
  };
}

async function duplicate(ev) {
  const { f, close } = sheet(`<h2>Duplicate ${esc(ev.name)}</h2><p class="note">Same checklist, owners, budget lines and notes. Checkmarks and actual costs reset.</p>
    <label>Name<input class="field" name="name" value="${esc(ev.name)}"></label>
    <label>New date<input class="field" type="datetime-local" name="start" required value="${localInput(ev.start + 28 * D)}"></label>${sheetActs("<span></span>", "Duplicate")}`);
  f.onsubmit = async e => {
    e.preventDefault();
    const copy = { ...ev, id: "e-" + uid(), name: f.name.value.trim() || ev.name, start: new Date(f.start.value).getTime(),
      tasks: (ev.tasks || []).map(t => ({ ...t, id: uid(), done: false })), lines: (ev.lines || []).map(l => ({ ...l, id: uid(), actCents: 0 })),
      notes: [ev.notes, ev.debrief && ev.debrief.fix ? `Last time, fix: ${ev.debrief.fix}` : ""].filter(Boolean).join("\n"), debrief: {} };
    await saveEvent(copy); close(); setRoute(copy.id); renderDetail(copy.id); ctx0.toast("Duplicated.");
  };
}

async function saveTemplate(ev) {
  const { f, close } = sheet(`<h2>Save as template</h2><p class="note">New events can start from this checklist and these budget lines.</p>
    <label>Template name<input class="field" name="name" value="${esc(ev.name)}"></label>${sheetActs()}`);
  f.onsubmit = async e => {
    e.preventDefault();
    await store.put(TPL, "t-" + uid(), { name: f.name.value.trim() || ev.name, type: ev.type, tasks: (ev.tasks || []).map(t => ({ title: t.title, offsetDays: t.offsetDays })),
      lines: (ev.lines || []).map(l => ({ label: l.label, estCents: l.actCents || l.estCents })), notes: ev.debrief && ev.debrief.fix ? `Fix next time: ${ev.debrief.fix}` : "" });
    close(); ctx0.toast("Template saved.");
  };
}

/* ---------- app interface ---------- */
let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./events.css", import.meta.url).href;
  document.head.appendChild(link);
}
async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = `<div class="ap-bar"><button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button><span class="ap-title">Event Planner</span><span class="ap-spacer"></span>
    <button class="icon-btn" id="ev-new" aria-label="Plan an event">${svg("plus")}</button></div>
    <div class="ap-scroll"><div class="ap-body wide" id="ev-body"></div></div>`;
  $("#ev-new").onclick = () => openEventSheet(null);
  el.addEventListener("click", e => {
    const c = e.target.closest("[data-ev]");
    if (c) { setRoute(c.dataset.ev); renderDetail(c.dataset.ev); return; }
    onDetailClick(e);
  });
  store.onChange(ch => { if (ch.source === "remote" && (ch.app === APP) && ctx.isActive()) (openId ? renderDetail(openId) : renderList()); });
}
async function show(arg) {
  if (arg === "new") { setRoute(""); await renderList(); openEventSheet(null); return; }
  openId = arg || "";
  if (openId) renderDetail(openId); else renderList();
}

export default { id: APP, name: "Event Planner", icon: "ticket", color: ["#ff7ac6", "#d13f93"], hidden: true, mount, show, agenda: agendaItems, complete: completeKey };
