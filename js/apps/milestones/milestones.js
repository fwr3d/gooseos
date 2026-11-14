// Milestones: break a big thing (project, paper, exam, presentation, application)
// into small dated steps between now and the due date.
//
// Saved through the shared store as items of app "milestones":
//   { title, course, template, due (ms), deadlineKey?, blockedDays: [0-6], steps: [{ id, title, date (ms), estMin, done }], created }
// Each unfinished step is shared with Reminders and Today through agenda().
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import { dueLabel, toLocalInput } from "../deadlines/parse.js";
import { knownCourses, courseColor } from "../deadlines/deadlines.js";
import { TEMPLATES, DAY_NAMES, DEFAULT_BLOCKED, buildPlan, replan } from "./plan.js";

const APP = "milestones";
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDur = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;

/* ---------- data ---------- */
export async function loadMilestones() {
  return (await store.list(APP)).map(r => ({ id: r.id, ...r.data })).filter(m => m && Array.isArray(m.steps));
}
const save = m => { const { id, ...data } = m; return store.put(APP, id, data); };
const progress = m => { const n = m.steps.length, d = m.steps.filter(s => s.done).length; return { n, d, pct: n ? Math.round(d / n * 100) : 0 }; };
const nextStep = m => m.steps.filter(s => !s.done).sort((a, b) => a.date - b.date)[0];

/** Guess a template from a deadline's title. */
function guessTemplate(title) {
  const t = String(title).toLowerCase();
  if (/\b(exam|midterm|final|quiz|test)\b/.test(t)) return "exam";
  if (/\b(paper|essay|report|reflection|draft)\b/.test(t)) return "paper";
  if (/\b(presentation|pres|slides|talk|pitch)\b/.test(t)) return "presentation";
  if (/\b(application|apply|internship|job)\b/.test(t)) return "application";
  return "project";
}

/* ---------- shared agenda (Reminders + Today) ---------- */
export async function agenda() {
  const cutoff = Date.now() - 2 * 864e5, out = [];
  for (const m of await loadMilestones()) {
    for (const s of m.steps) {
      if (s.done && s.date < cutoff) continue;
      out.push({ key: `${APP}:${m.id}:${s.id}`, title: `${s.title} · ${m.title}`, due: s.date, kind: "step", course: m.course || "", done: !!s.done, open: `#${APP}/${m.id}`, estMin: s.estMin || 0 });
    }
  }
  return out;
}
export async function complete(key) {
  const [, mid, sid] = String(key).split(":");
  const raw = await store.get(APP, mid); if (!raw) return;
  const steps = raw.steps.map(s => s.id === sid ? { ...s, done: true } : s);
  await store.put(APP, mid, { ...raw, steps });
}

/* ---------- view ---------- */
let ctx0, root;
const $ = s => root.querySelector(s);
let current = null;   // open milestone id, or null for the list

function card(m) {
  const p = progress(m), nx = nextStep(m), late = m.steps.filter(s => !s.done && s.date < Date.now()).length;
  return `<button class="ms-card" data-id="${m.id}">
    <div class="ms-top"><span class="t">${esc(m.title)}</span>${late ? `<span class="ap-pill bad">${late} late</span>` : p.d === p.n ? `<span class="ap-pill good">Done</span>` : ""}</div>
    <div class="ms-sub">${m.course ? `<span class="chip course" style="background:${courseColor(m.course)}">${esc(m.course)}</span>` : ""}<span>${esc(TEMPLATES[m.template]?.label || "Custom")}</span><span>·</span><span>Due ${esc(dueLabel(m.due))}</span></div>
    ${nx ? `<div class="ms-next">${svg("chevronRight")}<span>Next:</span><b>${esc(nx.title)}</b><span class="ap-hint" style="padding:0">${esc(dueLabel(nx.date))}</span></div>` : ""}
    <div class="ms-meter"><div class="ap-bar-meter"><i style="width:${p.pct}%;background:${p.d === p.n ? "var(--good)" : "var(--accent)"}"></i></div><span>${p.d}/${p.n}</span></div>
  </button>`;
}

async function renderList() {
  current = null;
  $("#ms-title").textContent = "Milestones";
  $("#ms-back").hidden = true; root.querySelector("[data-home]").hidden = false;
  const all = (await loadMilestones()).sort((a, b) => a.due - b.due);
  const active = all.filter(m => m.steps.some(s => !s.done)), finished = all.filter(m => !m.steps.some(s => !s.done));
  let html = "";
  if (!all.length) html = `<div class="ap-card"><div class="ap-empty"><b>Break big things into small steps</b>Pick a project, paper, exam or presentation, give it a due date, and GooseOS spaces the steps out for you, skipping Fridays and Saturdays.<div style="margin-top:14px"><button class="pill-btn" data-act="new">New milestone</button></div></div></div>`;
  if (active.length) html += `<section class="ap-sec"><h3>In progress<span class="n">${active.length}</span></h3><div class="ap-card">${active.map(card).join("")}</div></section>`;
  if (finished.length) html += `<section class="ap-sec"><h3>Finished<span class="n">${finished.length}</span></h3><div class="ap-card">${finished.map(card).join("")}</div></section>`;
  $("#ms-main").innerHTML = html;
}

async function renderDetail(id) {
  const raw = await store.get(APP, id);
  if (!raw) { ctx0.toast("That milestone isn't here anymore."); return renderList(); }
  const m = { id, ...raw };
  current = id;
  $("#ms-title").textContent = "";
  $("#ms-back").hidden = false; root.querySelector("[data-home]").hidden = true;
  const p = progress(m), now = Date.now();
  const linked = m.deadlineKey ? await store.get("deadlines", m.deadlineKey.replace(/^deadlines:/, "")) : null;
  $("#ms-main").innerHTML = `
    <div class="ms-head">
      <h1>${esc(m.title)}</h1>
      <div class="ms-sub">${m.course ? `<span class="chip course" style="background:${courseColor(m.course)}">${esc(m.course)}</span>` : ""}<span>${esc(TEMPLATES[m.template]?.label || "Custom")}</span><span>·</span><span>Due ${esc(dueLabel(m.due))}</span>${linked ? `<span>·</span><a class="link-btn" style="padding:0" href="#deadlines/${esc(m.deadlineKey.replace(/^deadlines:/, ""))}">Linked deadline</a>` : ""}</div>
      <div class="ms-meter"><div class="ap-bar-meter"><i style="width:${p.pct}%;background:${p.d === p.n ? "var(--good)" : "var(--accent)"}"></i></div><span>${p.d}/${p.n} steps</span></div>
      <div class="ms-actions">
        <button class="pill-btn secondary" data-act="replan" title="Spread the unfinished steps from today to the due date">${svg("refreshCw")}Re-plan</button>
        <button class="pill-btn secondary" data-act="edit">${svg("pencilLine")}Edit</button>
        <span id="ms-del-wrap"><button class="pill-btn secondary" data-act="del" style="color:var(--bad)">${svg("trash2")}Delete</button></span>
      </div>
    </div>
    <div class="ap-card" id="ms-steps">
      ${m.steps.map(s => {
        const late = !s.done && s.date < now;
        return `<div class="ap-row ms-step ${s.done ? "done" : ""}" data-sid="${s.id}">
          <button class="ap-check" data-act="toggle" aria-label="${s.done ? "Mark not done" : "Mark done"}">${svg("check")}</button>
          <div class="grow"><span class="t">${esc(s.title)}</span><button class="s link-btn" data-act="date" style="padding:0;text-align:left;font-weight:500;color:${late ? "var(--bad)" : "var(--muted)"};font-size:12.5px">${esc(dueLabel(s.date))}${late ? " · late" : ""}</button></div>
          <span class="est">${fmtDur(s.estMin || 45)}</span>
          <button class="icon-btn ms-del" data-act="rmstep" aria-label="Remove step">${svg("x")}</button>
        </div>`;
      }).join("")}
      <form class="ms-addstep" id="ms-addstep" autocomplete="off">${svg("plus")}<input placeholder="Add a step…" aria-label="Add a step"><button class="pill-btn" type="submit">Add</button></form>
    </div>
    <p class="ap-hint">Tap a step's date to move it. Re-plan spreads the unfinished steps from today to the due date and never past it.</p>`;
}

async function update(id, fn) {
  const raw = await store.get(APP, id); if (!raw) return;
  const next = fn({ id, ...raw });
  await save(next);
  return next;
}

/* ---------- new / edit sheet ---------- */
async function openSheet({ edit, prefill = {} } = {}) {
  const courses = await knownCourses();
  const m = edit || { title: prefill.title || "", course: prefill.course || "", due: prefill.due || null, template: prefill.template || "project", blockedDays: [...DEFAULT_BLOCKED], deadlineKey: prefill.deadlineKey || "" };
  let template = m.template, blocked = [...(m.blockedDays || DEFAULT_BLOCKED)];
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet ms-sheet" role="dialog" aria-modal="true" aria-label="${edit ? "Edit milestone" : "New milestone"}" autocomplete="off">
    <h2>${edit ? "Edit milestone" : "New milestone"}</h2>
    ${m.deadlineKey && !edit ? `<p class="note" style="margin:0">Linked to your deadline. Steps will finish before it's due.</p>` : ""}
    <label>What<input class="field" name="title" required value="${esc(m.title)}" placeholder="Project 3"></label>
    <div class="two">
      <label>Course<input class="field" name="course" value="${esc(m.course)}" placeholder="CS 18000" list="ms-courses"></label>
      <label>Due<input class="field" type="datetime-local" name="due" required value="${m.due ? toLocalInput(m.due) : ""}"></label>
    </div>
    ${edit ? "" : `<label>Template<div class="ms-tpls">${Object.entries(TEMPLATES).map(([k, t]) => `<button type="button" data-tpl="${k}" aria-pressed="${k === template}">${t.label}</button>`).join("")}</div></label>
    <label id="ms-extra-l" hidden><span id="ms-extra-h"></span><textarea class="field" name="extra" id="ms-extra"></textarea></label>`}
    <label>Skip these days<div class="ap-days">${DAY_NAMES.map((d, i) => `<button type="button" data-day="${i}" aria-pressed="${blocked.includes(i)}">${d}</button>`).join("")}</div></label>
    ${edit ? `<p class="note" style="margin:0">Changing the due date or skipped days re-plans the unfinished steps.</p>` : `<label>Plan<div class="ms-preview" id="ms-preview"></div></label>`}
    <span class="ap-err" id="ms-err"></span>
    <div class="acts"><span></span><span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">${edit ? "Save" : "Make plan"}</button></span></div>
    <datalist id="ms-courses">${courses.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
  </form>`;
  root.appendChild(back);
  const f = back.querySelector("form");
  const close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  f.querySelector('[data-act="cancel"]').onclick = close;

  const opts = () => {
    const extra = (f.querySelector("#ms-extra")?.value || "");
    return template === "exam" ? { topics: extra.split(/[,\n]/) } : template === "custom" ? { lines: extra.split("\n") } : {};
  };
  const dueMs = () => f.due.value ? new Date(f.due.value).getTime() : null;
  const preview = () => {
    const box = f.querySelector("#ms-preview"); if (!box) return;
    const due = dueMs();
    if (!due) { box.innerHTML = `<div>Pick a due date to see the plan.</div>`; return; }
    if (due < Date.now()) { box.innerHTML = `<div>That due date has already passed.</div>`; return; }
    const steps = buildPlan(template, Date.now(), due, blocked, opts());
    box.innerHTML = steps.length ? steps.map(s => `<div><span>${esc(dueLabel(s.date))}</span>${esc(s.title)}</div>`).join("")
      : `<div>${template === "exam" ? "List the topics above, separated by commas." : "Write your steps above, one per line."}</div>`;
  };
  const showExtra = () => {
    const l = f.querySelector("#ms-extra-l"); if (!l) return;
    l.hidden = !(template === "exam" || template === "custom");
    f.querySelector("#ms-extra-h").textContent = template === "exam" ? "Topics to review (comma separated)" : "Your steps (one per line)";
    f.querySelector("#ms-extra").placeholder = template === "exam" ? "recursion, linked lists, trees, big-O" : "Email the professor\nFirst draft\nFinal version";
  };
  f.querySelectorAll("[data-tpl]").forEach(b => b.onclick = () => {
    template = b.dataset.tpl; f.querySelectorAll("[data-tpl]").forEach(x => x.setAttribute("aria-pressed", x === b)); showExtra(); preview();
  });
  f.querySelectorAll("[data-day]").forEach(b => b.onclick = () => {
    const d = +b.dataset.day; blocked = blocked.includes(d) ? blocked.filter(x => x !== d) : [...blocked, d];
    b.setAttribute("aria-pressed", blocked.includes(d)); preview();
  });
  f.due.addEventListener("input", preview);
  f.querySelector("#ms-extra")?.addEventListener("input", preview);
  showExtra(); preview();

  f.onsubmit = async e => {
    e.preventDefault();
    const err = f.querySelector("#ms-err"); err.textContent = "";
    const title = f.title.value.trim(), course = f.course.value.trim(), due = dueMs();
    if (!title || !due) return;
    if (edit) {
      const changed = due !== edit.due || blocked.join() !== (edit.blockedDays || []).join();
      const steps = changed ? replan(edit.steps, Date.now(), due, blocked) : edit.steps;
      await save({ ...edit, title, course, due, blockedDays: blocked, steps });
      close(); renderDetail(edit.id); return;
    }
    if (due < Date.now()) { err.textContent = "That due date has already passed. Pick a later one."; return; }
    const steps = buildPlan(template, Date.now(), due, blocked, opts());
    if (!steps.length) { err.textContent = template === "exam" ? "Add at least one topic." : "Add at least one step."; return; }
    const id = "m-" + uid();
    await save({ id, title, course, due, template, blockedDays: blocked, steps, deadlineKey: m.deadlineKey || "", created: Date.now() });
    close();
    go(id);
    ctx0.toast(`Planned ${steps.length} steps for “${title}”`);
  };
  setTimeout(() => (m.title ? f.due : f.title).focus(), 50);
}

/** Switch between the list and one milestone without adding history entries (so Home still goes home). */
function go(id) {
  history.replaceState(null, "", id ? `#${APP}/${id}` : `#${APP}`);
  return id ? renderDetail(id) : renderList();
}

/* ---------- markup ---------- */
const MARKUP = () => `
  <div class="ap-bar">
    <button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button>
    <button class="ap-home" id="ms-back" hidden>${svg("chevronLeft")}Milestones</button>
    <span class="ap-title" id="ms-title">Milestones</span>
    <span class="ap-spacer"></span>
    <button class="icon-btn" id="ms-new" aria-label="New milestone">${svg("plus")}</button>
  </div>
  <div class="ap-scroll"><div class="ap-body" id="ms-main"></div></div>`;

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./milestones.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = MARKUP();
  $("#ms-new").onclick = () => openSheet();
  $("#ms-back").onclick = () => go("");

  $("#ms-main").addEventListener("click", async e => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    const cardEl = e.target.closest(".ms-card");
    if (!act && cardEl) { go(cardEl.dataset.id); return; }
    if (act === "new") return openSheet();
    if (!current) return;
    const id = current;
    const sid = e.target.closest("[data-sid]")?.dataset.sid;
    if (act === "toggle") {
      const m = await update(id, m => ({ ...m, steps: m.steps.map(s => s.id === sid ? { ...s, done: !s.done } : s) }));
      if (m && !m.steps.some(s => !s.done)) ctx0.toast(`All steps done for “${m.title}”. Nice work.`);
      renderDetail(id);
    } else if (act === "rmstep") {
      await update(id, m => ({ ...m, steps: m.steps.filter(s => s.id !== sid) })); renderDetail(id);
    } else if (act === "date") {
      const btn = e.target.closest("[data-act]"), raw = await store.get(APP, id), s = raw.steps.find(x => x.id === sid);
      const inp = document.createElement("input"); inp.type = "datetime-local"; inp.value = toLocalInput(s.date); inp.max = toLocalInput(raw.due);
      btn.replaceWith(inp); inp.focus();
      const done = async () => { const t = inp.value ? new Date(inp.value).getTime() : s.date; await update(id, m => ({ ...m, steps: m.steps.map(x => x.id === sid ? { ...x, date: Math.min(t, m.due) } : x) })); renderDetail(id); };
      inp.addEventListener("change", done); inp.addEventListener("blur", done);
    } else if (act === "replan") {
      await update(id, m => ({ ...m, steps: replan(m.steps, Date.now(), m.due, m.blockedDays || DEFAULT_BLOCKED) }));
      ctx0.toast("Re-planned from today."); renderDetail(id);
    } else if (act === "edit") {
      const raw = await store.get(APP, id); openSheet({ edit: { id, ...raw } });
    } else if (act === "del") {
      const wrap = $("#ms-del-wrap"), raw = await store.get(APP, id);
      wrap.innerHTML = `<span class="confirm">Delete “${esc(raw.title)}” and its steps? <button class="pill-btn danger" data-act="del-yes">Delete</button><button class="pill-btn secondary" data-act="del-no">Cancel</button></span>`;
    } else if (act === "del-yes") {
      const raw = await store.get(APP, id); await store.remove(APP, id); ctx0.toast(`Deleted “${raw ? raw.title : "milestone"}”`); go("");
    } else if (act === "del-no") renderDetail(id);
  });
  $("#ms-main").addEventListener("submit", async e => {
    if (e.target.id !== "ms-addstep" || !current) return;
    e.preventDefault();
    const inp = e.target.querySelector("input"), title = inp.value.trim(); if (!title) return;
    const id = current;
    await update(id, m => {
      const d = new Date(m.due); d.setDate(d.getDate() - 1); d.setHours(20, 0, 0, 0);
      const date = Math.max(Math.min(+d, m.due - 3600e3), Date.now() + 30 * 60e3);
      return { ...m, steps: [...m.steps, { id: "s" + uid(), title, date: Math.min(date, m.due), estMin: 45, done: false }] };
    });
    renderDetail(id);
  });
  store.onChange(ch => { if (ch.app === APP && ctx0.isActive() && ch.source === "remote") (current ? renderDetail(current) : renderList()); });
}

/** show("") list · show("<id>") one milestone · show("new?deadline=<id>") new plan from a deadline */
async function show(arg) {
  const a = typeof arg === "string" ? arg : "";
  if (a.startsWith("new")) {
    await renderList();
    const q = new URLSearchParams(a.split("?")[1] || "");
    const did = q.get("deadline");
    let prefill = {};
    if (did) {
      const d = await store.get("deadlines", did);
      if (d) prefill = { title: d.title, course: d.course || "", due: d.due && d.due > Date.now() ? d.due : null, template: guessTemplate(d.title), deadlineKey: `deadlines:${did}` };
    }
    history.replaceState(null, "", `#${APP}`);
    openSheet({ prefill });
    return;
  }
  if (a) return renderDetail(decodeURIComponent(a));
  return renderList();
}

export default { id: APP, name: "Milestones", icon: "milestone", color: ["#a78bfa", "#7c3aed"], mount, show, agenda, complete };
