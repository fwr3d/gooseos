// Milestones: break a big thing (project, paper, exam, presentation, application)
// into small dated steps between now and the due date.
//
// Saved through the shared store as items of app "milestones":
//   { title, course, template, due (ms), deadlineKey?, blockedDays: [0-6], steps: [{ id, title, date (ms), estMin, done, kind?, topic?, rating? }], created }
//   Exam steps carry kind ("study" | "review"). Older plans may have "gather" | "first" | "quiz" | "practice" |
//   "mistakes" | "cheat" | "night" | "again"; a finished "quiz" step there asks Got it / Shaky (rating "good" | "shaky").
// Each unfinished step is shared with Reminders and Today through agenda().
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import { dueLabel, toLocalInput } from "../deadlines/parse.js";
import { knownCourses, courseColor } from "../deadlines/deadlines.js";
import { TEMPLATES, DAY_NAMES, DEFAULT_BLOCKED, buildPlan, replan, shakyReviewDate } from "./plan.js";
import * as files from "../../files.js";
import * as sync from "../../sync.js";
import { openViewer, viewFile } from "../../viewer.js";
import { loadTemplates, openCreator, stepsFromPlan } from "./templates.js";
import { listDocs, saveDoc, removeDoc, moveDocs, studyPrompt, copyText, renderMd, openDocEditor, KINDS } from "./workspace.js";

const tplLabel = m => m.templateName || TEMPLATES[m.template]?.label || "Custom";

// Files attach to a milestone (owner "milestones:<id>") or to one step ("milestones:<id>:<step id>").
// A file named like a rubric goes on the step where you turn the thing in.
const ownerOf = (mid, sid) => sid ? `${APP}:${mid}:${sid}` : `${APP}:${mid}`;
function submitStep(m) {
  const open = [...m.steps].sort((a, b) => a.date - b.date);
  return open.find(s => /\bsubmit|turn in|citations and submit\b/i.test(s.title)) || (m.template === "exam" ? null : open[open.length - 1]) || null;
}
export async function openAttachment(id) {
  const f = await files.get(id); if (!f) return;
  if (files.isPdf(f)) { location.hash = `pdf/${encodeURIComponent(id)}`; return; }
  viewFile(id, { toast: ctx0 ? ctx0.toast : null });
}

const APP = "milestones";
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
/** "Mon Dec 1" */
const dayLabel = t => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }).replace(",", "");
/** "45 min", "1h 30m" */
const lenLabel = m => m < 60 ? `${m} min` : fmtDur(m);
const fmtDur = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;

/* ---------- data ---------- */
export async function loadMilestones() {
  const list = (await store.list(APP)).map(r => ({ id: r.id, ...r.data })).filter(m => m && Array.isArray(m.steps));
  for (const m of list) await followDeadline(m);
  return list;
}
const save = m => { const { id, deadlineDone, ...data } = m; return store.put(APP, id, data); };

/** A plan made from a deadline follows it: a new due date re-plans the open steps,
 *  and once the deadline is checked off the steps stop reminding you (m.deadlineDone). */
async function followDeadline(m) {
  if (!m.deadlineKey) return m;
  const d = await store.get("deadlines", m.deadlineKey.replace(/^deadlines:/, ""));
  if (!d) return m;   // not synced to this device yet, or deleted: leave the plan as it is
  m.deadlineDone = !!d.done;
  if (!d.done && d.due && d.due !== m.due && d.due > Date.now()) {
    m.due = d.due;
    m.steps = replan(m.steps, Date.now(), m.due, m.blockedDays || DEFAULT_BLOCKED);
    await save(m);
  }
  return m;
}
const isOpen = m => !m.deadlineDone && m.steps.some(s => !s.done);
export async function planFor(deadlineId) {
  return (await loadMilestones()).find(m => m.deadlineKey === `deadlines:${deadlineId}`) || null;
}
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
  const att = new Map();
  for (const f of await files.list({ scope: "milestone" }).catch(() => [])) { const k = f.owner; if (!att.has(k)) att.set(k, []); att.get(k).push({ id: f.id, name: f.name }); }
  for (const m of await loadMilestones()) {
    if (m.deadlineDone) continue;
    for (const s of m.steps) {
      if (s.done && s.date < cutoff) continue;
      const attach = att.get(ownerOf(m.id, s.id));
      out.push({ key: `${APP}:${m.id}:${s.id}`, title: `${s.title} · ${m.title}`, due: s.date, kind: "step", course: m.course || "", done: !!s.done, open: `#${APP}/${m.id}`, estMin: s.estMin || 0, ...(attach ? { attach } : {}) });
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
    <div class="ms-top"><span class="t">${esc(m.title)}</span>${m.deadlineDone && p.d < p.n ? `<span class="ap-pill good">Turned in</span>` : late ? `<span class="ap-pill bad">${late} late</span>` : p.d === p.n ? `<span class="ap-pill good">Done</span>` : ""}</div>
    <div class="ms-sub">${m.course ? `<span class="chip course" style="background:${courseColor(m.course)}">${esc(m.course)}</span>` : ""}<span>${esc(tplLabel(m))}</span><span>·</span><span>Due ${esc(dueLabel(m.due))}</span></div>
    ${nx ? `<div class="ms-next">${svg("chevronRight")}<span>Next:</span><b>${esc(nx.title)}</b><span class="ap-hint" style="padding:0">${esc(dueLabel(nx.date))}</span></div>` : ""}
    <div class="ms-meter"><div class="ap-bar-meter"><i style="width:${p.pct}%;background:${p.d === p.n ? "var(--good)" : "var(--accent)"}"></i></div><span>${p.d}/${p.n}</span></div>
  </button>`;
}

async function renderList() {
  current = null; sel = null; openDoc = null; ws = null; expanded = false; addOpen = false;
  $("#ms-main").classList.remove("wide");
  $("#ms-title").textContent = "Milestones";
  $("#ms-back").hidden = true; root.querySelector("[data-home]").hidden = false;
  const all = (await loadMilestones()).sort((a, b) => a.due - b.due);
  const active = all.filter(isOpen), finished = all.filter(m => !isOpen(m));
  let html = "";
  if (!all.length) html = `<div class="ap-card"><div class="ap-empty"><b>Break big things into small steps</b>Pick a project, paper, exam or presentation, give it a due date, and GooseOS spaces the steps out for you, skipping Fridays and Saturdays.<div style="margin-top:14px"><button class="pill-btn" data-act="new">New milestone</button></div></div></div>`;
  if (active.length) html += `<section class="ap-sec"><h3>In progress<span class="n">${active.length}</span></h3><div class="ap-card">${active.map(card).join("")}</div></section>`;
  if (finished.length) html += `<section class="ap-sec"><h3>Finished<span class="n">${finished.length}</span></h3><div class="ap-card">${finished.map(card).join("")}</div></section>`;
  $("#ms-main").innerHTML = html;
}

async function renderDetail(id) {
  const raw = await store.get(APP, id);
  if (!raw) { ctx0.toast("That milestone isn't here anymore."); return renderList(); }
  const m = await followDeadline({ id, ...raw });
  if (current !== id) { sel = null; openDoc = null; expanded = false; addOpen = false; }
  current = id;
  $("#ms-title").textContent = "";
  $("#ms-back").hidden = false; root.querySelector("[data-home]").hidden = true;
  const p = progress(m), now = Date.now();
  const linked = m.deadlineKey ? await store.get("deadlines", m.deadlineKey.replace(/^deadlines:/, "")) : null;
  const att = await files.list({ owner: ownerOf(id) }).catch(() => []);
  const docs = await listDocs(ownerOf(id)).catch(() => []);
  if (sel && !m.steps.some(s => s.id === sel)) sel = null;
  ws = { id, m, att, docs };
  const onStep = sid => att.filter(f => f.owner === ownerOf(id, sid));
  const docsOn = sid => docs.filter(d => d.owner === ownerOf(id, sid));
  $("#ms-main").classList.add("wide");
  const sorted = [...m.steps].sort((a, b) => a.date - b.date);
  // long plans: show the last two finished steps and the next few, the rest behind "N more steps"
  let shown = sorted;
  if (!expanded && sorted.length > 6) {
    const firstOpen = Math.max(0, sorted.findIndex(x => !x.done));
    const from = Math.max(0, Math.min(firstOpen - 2, sorted.length - 5));
    const pick = new Set(sorted.slice(from, from + 5).map(x => x.id));
    if (sel) pick.add(sel);
    shown = sorted.filter(x => pick.has(x.id));
  }
  const hiddenN = sorted.length - shown.length;
  const tool = (act, icon, label) => `<button class="ms-tool" data-act="${act}" aria-label="${label}" title="${label}">${svg(icon)}</button>`;
  const stepRow = s => {
    const late = !s.done && s.date < now, isSel = s.id === sel;
    const ask = (s.kind === "study" || s.kind === "quiz") && s.done && !s.rating;
    const rated = s.rating ? `<button class="ms-tag ${s.rating === "good" ? "green" : "warm"}" data-act="rate-clear" title="Change how it went">${s.rating === "good" ? "got it" : "shaky"}</button>` : "";
    const hasAtt = onStep(s.id).length + docsOn(s.id).length > 0;
    const when = s.done ? "" : `<span class="ms-when${late ? " late" : ""}">${esc(dayLabel(s.date))}<span class="ms-len"> · ${esc(lenLabel(s.estMin || 45))}</span>${late ? " · late" : ""}</span>`;
    return `<div class="ms-step ${s.done ? "done" : ""} ${ask ? "ask" : ""} ${isSel ? "sel" : ""}" data-sid="${s.id}">
      <button class="ms-chk" data-act="toggle" aria-label="${s.done ? "Mark not done" : "Mark done"}">${svg(s.done ? "circleCheck" : "circle")}</button>
      <div class="grow"><span class="ms-ttl">${esc(s.title)}</span>${when}
        ${ask ? `<span class="ms-rate"><span>How did ${esc(s.topic || "it")} go?</span><button class="pill-btn secondary" data-act="rate-good">Got it</button><button class="pill-btn secondary" data-act="rate-shaky">Shaky</button></span>` : ""}</div>
      ${rated}${hasAtt ? `<span class="ms-hasatt" title="Has notes or files">${svg("paperclip")}</span>` : ""}
      <span class="ms-tools">${tool("rename", "pencilLine", "Rename")}${tool("date", "calendar", "Change date")}${tool("est", "clock", "How long it takes")}${tool("rmstep", "trash2", "Remove step")}</span>
    </div>`;
  };
  const keepTop = $("#ms-main").scrollTop;
  $("#ms-main").innerHTML = `
    <div class="ms-page">
    <div class="ms-head">
      <div class="ms-htop">
        <div class="ms-htitle">
          <div class="ms-meta">${esc([m.course, tplLabel(m), `due ${dayLabel(m.due)}`].filter(Boolean).join(" · "))}${linked ? ` · <a class="ms-dl" href="#deadlines/${esc(m.deadlineKey.replace(/^deadlines:/, ""))}">deadline</a>` : ""}</div>
          <h1>${esc(m.title)}</h1>
        </div>
        <div class="ms-actions">
          <button class="ms-ob" data-act="save-tpl" title="Reuse these steps for the next one">${svg("copy")}Save as template</button>
          <span class="ms-more"><button class="ms-ob icon" data-act="more" aria-label="More actions" aria-haspopup="menu" aria-expanded="false">${svg("ellipsis")}</button>
            <span class="ms-menu" role="menu" hidden>
              <button role="menuitem" data-act="add-open">${svg("plus")}Add a step</button>
              <button role="menuitem" data-act="replan" title="Spread the unfinished steps from today to the due date">${svg("refreshCw")}Re-plan from today</button>
              <button role="menuitem" data-act="edit">${svg("pencilLine")}Edit plan</button>
              <button role="menuitem" class="danger" data-act="del">${svg("trash2")}Delete</button>
            </span></span>
        </div>
        <span id="ms-del-wrap"></span>
      </div>
      <div class="ms-meter"><div class="ms-bar"><i style="width:${p.pct}%"></i></div><span>${p.d} of ${p.n} steps</span></div>
    </div>
    ${m.deadlineDone && p.d < p.n ? `<div class="ms-banner"><span class="grow"><b>You checked off the deadline</b><span>The steps left won't remind you anymore.</span></span><button class="ms-ob sm" data-act="finish">Mark all done</button></div>` : ""}
    <div class="ms-cols"><div class="ms-left">
      <div class="ms-lab">Steps</div>
      <div class="ms-list ${addOpen ? "adding" : ""}" id="ms-steps">
        ${shown.map(stepRow).join("")}
        ${hiddenN ? `<button class="ms-morerow" data-act="more-steps">${svg("ellipsis")}${hiddenN} more step${hiddenN === 1 ? "" : "s"}</button>` : expanded && sorted.length > 6 ? `<button class="ms-morerow" data-act="more-steps">${svg("chevronDown", "up")}Show fewer</button>` : ""}
        <form class="ms-addstep" id="ms-addstep" autocomplete="off">${svg("plus")}<input placeholder="Add a step…" aria-label="Add a step"><button class="ms-ob sm" type="submit">Add</button></form>
      </div>
    </div><aside class="ms-ws" id="ms-ws" aria-label="Workspace"></aside></div>
    </div>
    <div class="ms-drophint" id="ms-drophint" aria-hidden="true"></div>`;
  $("#ms-main").scrollTop = keepTop;
  // keep the keyboard on the "Add a step" box (and don't scroll for it) so adding several steps in a row stays smooth
  if (addOpen) { addOpen = false; $("#ms-addstep input")?.focus({ preventScroll: true }); }
  drawWorkspace();
}

/* ---------- workspace: notes and files for the whole project or the selected step ---------- */
let sel = null;       // selected step id, or null for the whole project
let openDoc = null;   // unused now that docs open in a reader; kept so older calls stay harmless
let expanded = false; // long step list shown in full
let addOpen = false;  // the "Add a step" row is showing
let ws = null;        // what the last renderDetail loaded: { id, m, att, docs }
const DOC_ICON = { note: "fileText", guide: "notebook", questions: "circleHelp" };
const DOC_KIND = { note: { tint: "gray", tag: "note" }, guide: { tint: "blue", tag: "guide" }, questions: { tint: "violet", tag: "questions" } };
/** "today", "yesterday", "Mon", or "Nov 3". */
function ago(t) {
  const d0 = new Date(); d0.setHours(0, 0, 0, 0);
  const days = Math.round((+d0 - new Date(t).setHours(0, 0, 0, 0)) / 864e5);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return new Date(t).toLocaleDateString(undefined, days < 7 ? { weekday: "short" } : { month: "short", day: "numeric" });
}

/** Plain text from markdown, for the short preview. */
const plain = md => String(md || "").replace(/```[\s\S]*?```/g, " ").replace(/^\s*(#{1,6}|[-*+]|\d+[.)])\s+/gm, "").replace(/\*\*|`/g, "").replace(/\s+/g, " ").trim();
const countQs = md => (String(md || "").match(/^\s*\d+[.)]\s+/gm) || []).length;
function drawWorkspace() {
  const box = $("#ms-ws"); if (!box || !ws) return;
  const { id, m, att, docs } = ws;
  const step = sel ? m.steps.find(s => s.id === sel) : null;
  const whole = m.template === "exam" ? "exam" : "project";
  // a doc or file whose step was removed counts as the whole plan's
  const stepOf = owner => { const s = String(owner).slice(ownerOf(id).length + 1); return s && m.steps.some(x => x.id === s) ? s : null; };
  const here = x => stepOf(x.owner) === (step ? step.id : null);
  const myDocs = docs.filter(here), myFiles = att.filter(here);
  const also = step ? [...docs.filter(d => !stepOf(d.owner)).map(d => d.title), ...att.filter(f => !stepOf(f.owner)).map(f => f.name)] : [];
  const steps = [...m.steps].sort((a, b) => a.date - b.date);
  const docRow = d => {
    const guide = d.kind === "guide", qs = d.kind === "questions" ? countQs(d.body) : 0;
    const meta = [guide ? "Study guide" : "Note", qs ? `${qs} question${qs === 1 ? "" : "s"}` : `edited ${ago(d.updated || d.created)}`].join(" · ");
    const excerpt = plain(d.body);
    return `<div class="ws-doc" data-did="${esc(d.id)}">
      <button class="ws-row" data-act="ws-open"><span class="ws-ic ${guide ? "acc" : ""}">${svg(DOC_ICON[d.kind] || "fileText")}</span>
        <span class="grow"><span class="t">${esc(d.title)}</span><span class="s">${esc(meta)}</span></span>
        ${guide ? `<span class="ms-tag blue">guide</span>` : ""}</button>
      ${guide && excerpt ? `<div class="ws-prev"><p>${esc(excerpt.length > 170 ? excerpt.slice(0, 170).replace(/\s+\S*$/, "") + "…" : excerpt)}</p><button class="ws-link" data-act="ws-open">Open full guide</button></div>` : ""}
    </div>`;
  };
  const fileRow = f => `<div class="ws-row ms-frow" data-fid="${esc(f.id)}">
      <span class="ws-ic">${svg(files.isPdf(f) ? "fileText" : files.isImage(f) ? "image" : "file")}</span>
      <button class="grow ms-fopen" data-act="file" data-fid="${esc(f.id)}"><span class="t">${esc(f.name)}</span><span class="s">${esc([KINDS[f.kind], files.sizeText(f.size), files.statusText(f)].filter(Boolean).join(" · "))}</span></button>
      ${f.kind === "guide" ? `<span class="ms-tag blue">guide</span>` : ""}
      <span class="ms-tools ws-ftools">
        <select class="field ms-fstep" data-act="fstep" aria-label="Attach ${esc(f.name)} to">
          <option value="">Whole ${whole}</option>
          ${steps.map(s => `<option value="${esc(s.id)}" ${f.owner === ownerOf(id, s.id) ? "selected" : ""}>Step: ${esc(s.title)}</option>`).join("")}
        </select>
        <button class="ms-tool" data-act="fdel" aria-label="Remove ${esc(f.name)}" title="Remove">${svg("trash2")}</button>
      </span>
      <button class="ms-tool ws-fmore" data-act="fmore" aria-label="Options for ${esc(f.name)}">${svg("ellipsis")}</button>
    </div>`;
  const days = Math.max(0, Math.ceil((m.due - Date.now()) / 864e5));
  const promptSub = [m.course, step ? step.topic || step.title : m.title, step && step.rating === "shaky" ? "rated shaky" : "",
    `${m.template === "exam" ? "exam" : "due"} ${days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`}`].filter(Boolean).join(" · ");
  box.innerHTML = `
    <div class="ws-head">
      <span class="ms-lab">Workspace · ${esc(step ? step.title : `Whole ${whole}`)}</span>
      <span class="ws-btns">
        <button class="ms-ob sm" data-act="ws-note">${svg("plus")}Note</button>
        <label class="ms-ob sm ws-file" tabindex="0">${svg("paperclip")}File<input type="file" id="ms-fpick" multiple hidden></label></span>
    </div>
    ${m.template === "exam" ? `<div class="ws-prompt">
      <span class="ws-pic">${svg("sparkles")}</span>
      <span class="grow"><b>Study prompt</b><span>${esc(promptSub)}</span></span>
      <button class="ms-ob sm ws-copy" data-act="ws-copy">${svg("copy")}Copy prompt</button>
    </div>` : ""}
    <div class="ws-list">
      ${myDocs.map(docRow).join("")}${myFiles.map(fileRow).join("")}
      ${myDocs.length || myFiles.length ? "" : `<label class="ws-empty ws-dropzone">${svg("upload")}<b>Drop files here</b><span>Or <u>choose files</u>, or paste with Ctrl+V. Whole folders work too.${step ? "" : " A rubric goes on the submit step by itself."}</span><input type="file" class="ws-fpick2" multiple hidden></label>`}
    </div>
    ${also.length ? `<button class="ws-also" data-act="ws-all">Also on the whole ${whole}: ${esc(also.join(", "))}</button>` : ""}`;
}
/** Read a note or guide in full; Edit and Copy from here. */
function openReader(doc, { onEdit }) {
  openViewer({
    title: doc.title, sub: `${KINDS[doc.kind] || "Note"} · edited ${ago(doc.updated || doc.created)}`,
    actions: [
      { label: "Copy text", icon: "copy", run: async () => ctx0.toast(await copyText(doc.body || "") ? "Copied" : "Couldn't copy. Select the text instead.") },
      { label: "Edit", icon: "pencilLine", run: ({ close }) => { close(); onEdit(); } },
      { label: "Open in Code", icon: "code", run: ({ close }) => { close(); location.hash = `code/doc:${encodeURIComponent(doc.id)}`; } },
    ],
    render(body) { body.innerHTML = `<article class="fv-doc ws-md">${renderMd(doc.body) || `<p class="ws-muted">Nothing written yet.</p>`}</article>`; },
  });
}
/** For the doc editor: builds the prompt for a guide or practice questions on this step. */
const promptFor = sid => ws.m.template === "exam" ? kind => studyPrompt(ws.m, sid ? ws.m.steps.find(s => s.id === sid) : null, kind) : null;
function markSel() {
  root.querySelectorAll(".ms-step").forEach(r => r.classList.toggle("sel", r.dataset.sid === sel));
}
function selectStep(sid, { scroll = true } = {}) {
  sel = sid; markSel(); drawWorkspace();
  // on a phone the workspace sits under the steps, so bring it into view
  if (scroll && sid && matchMedia("(max-width: 899px)").matches) $("#ms-ws")?.scrollIntoView({ behavior: "smooth", block: "start" });
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
  const startTpl = m.template || "custom";
  let template = startTpl, blocked = [...(m.blockedDays || DEFAULT_BLOCKED)];
  let mine = await loadTemplates();
  const openCount = edit ? edit.steps.filter(s => !s.done).length : 0;
  const mineOf = k => mine.find(t => `u:${t.id}` === k);
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet ms-sheet" role="dialog" aria-modal="true" aria-label="${edit ? "Edit milestone" : "New milestone"}" autocomplete="off">
    <h2>${edit ? "Edit milestone" : "New milestone"}</h2>
    ${m.deadlineKey && !edit ? `<p class="note" style="margin:0">Linked to your deadline. Steps will finish before it's due.</p>` : ""}
    <label>What<input class="field" name="title" required value="${esc(m.title)}" placeholder="Project 3"></label>
    <div class="two">
      <label>Course<input class="field" name="course" value="${esc(m.course)}" placeholder="CS 18000" list="ms-courses"></label>
      <label>Due<input class="field" type="datetime-local" name="due" required value="${m.due ? toLocalInput(m.due) : ""}"></label>
    </div>
    <div class="ms-tpl-l"><span>Template</span><div class="ms-tpls" id="ms-tpls"></div></div>
    <label id="ms-extra-l" hidden><span id="ms-extra-h"></span><textarea class="field" name="extra" id="ms-extra"></textarea></label>
    <label>Skip these days<div class="ap-days">${DAY_NAMES.map((d, i) => `<button type="button" data-day="${i}" aria-pressed="${blocked.includes(i)}">${d}</button>`).join("")}</div></label>
    ${edit ? `<p class="note" style="margin:0" id="ms-edit-note"></p>` : ""}
    <label id="ms-preview-l" ${edit ? "hidden" : ""}><span>${edit ? "New steps" : "Plan"}</span><div class="ms-preview" id="ms-preview"></div></label>
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
    const t = mineOf(template);
    return t ? { steps: t.steps } : template === "exam" ? { topics: extra.split(/[,\n]/) } : template === "custom" ? { lines: extra.split("\n") } : {};
  };
  // template picker: the built-in ones, then yours, then a button to make one
  const drawTpls = () => {
    const box = f.querySelector("#ms-tpls"); if (!box) return;
    if (template.startsWith("u:") && !mineOf(template) && template !== startTpl) template = "project";
    const btn = (k, label) => `<button type="button" data-tpl="${esc(k)}" aria-pressed="${k === template}">${esc(label)}</button>`;
    box.innerHTML = Object.entries(TEMPLATES).filter(([k]) => k !== "custom").map(([k, t]) => btn(k, t.label)).join("")
      + mine.map(t => btn(`u:${t.id}`, t.name)).join("")
      + btn("custom", "Quick list")
      + `<button type="button" class="ms-tpl-new" data-act="tpl-new">${svg("plus")}New template</button>`
      + (mineOf(template) ? `<button type="button" class="ms-tpl-new" data-act="tpl-edit">${svg("pencilLine")}Edit “${esc(mineOf(template).name)}”</button>` : "");
  };
  const afterTpl = () => { drawTpls(); showExtra(); preview(); };
  const creatorDone = async (pick) => { mine = await loadTemplates(); if (pick) template = pick; afterTpl(); };
  f.querySelector("#ms-tpls")?.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.act === "tpl-new") return openCreator(root, { toast: ctx0.toast, onSave: t => creatorDone(`u:${t.id}`) });
    if (b.dataset.act === "tpl-edit") return openCreator(root, { edit: mineOf(template), toast: ctx0.toast, onSave: () => creatorDone(), onDelete: () => creatorDone("project") });
    if (b.dataset.tpl) { template = b.dataset.tpl; afterTpl(); }
  });
  drawTpls();
  const dueMs = () => f.due.value ? new Date(f.due.value).getTime() : null;
  const swapping = () => !!edit && template !== startTpl;
  const preview = () => {
    const box = f.querySelector("#ms-preview"); if (!box) return;
    if (edit) {
      const sw = swapping();
      f.querySelector("#ms-preview-l").hidden = !sw;
      f.querySelector("#ms-edit-note").textContent = sw
        ? `Switching the template replaces the ${openCount} step${openCount === 1 ? "" : "s"} you haven't done. Finished steps stay.`
        : "Changing the due date or skipped days re-plans the unfinished steps.";
      if (!sw) return;
    }
    const due = dueMs();
    if (!due) { box.innerHTML = `<div>Pick a due date to see the plan.</div>`; return; }
    if (due < Date.now()) { box.innerHTML = `<div>That due date has already passed.</div>`; return; }
    const steps = buildPlan(template, Date.now(), due, blocked, opts());
    box.innerHTML = steps.length ? steps.map(s => `<div><span>${esc(dueLabel(s.date))}</span>${esc(s.title)}</div>`).join("")
      : `<div>Write your steps above, one per line.</div>`;
  };
  const showExtra = () => {
    const l = f.querySelector("#ms-extra-l"); if (!l) return;
    l.hidden = !(template === "exam" || template === "custom");
    f.querySelector("#ms-extra-h").textContent = template === "exam" ? "Topics on the exam (optional, comma separated)" : "Your steps (one per line)";
    f.querySelector("#ms-extra").placeholder = template === "exam" ? "recursion, linked lists, trees, big-O" : "Email the professor\nFirst draft\nFinal version";
  };
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
      if (due !== edit.due && due < Date.now()) { err.textContent = "That due date has already passed. Pick a later one."; return; }
      if (swapping()) {
        if (due < Date.now()) { err.textContent = "That due date has already passed. Pick a later one."; return; }
        const fresh = buildPlan(template, Date.now(), due, blocked, opts());
        if (!fresh.length) { err.textContent = "Add at least one step."; return; }
        const own = mineOf(template), { templateName, ...rest } = edit;
        await save({ ...rest, title, course, due, blockedDays: blocked, template, ...(own ? { templateName: own.name } : {}),
          steps: [...edit.steps.filter(s => s.done), ...fresh] });
        close(); renderDetail(edit.id); ctx0.toast(`Switched to ${own ? own.name : TEMPLATES[template]?.label || "your list"}: ${fresh.length} new step${fresh.length === 1 ? "" : "s"}.`); return;
      }
      const changed = due !== edit.due || blocked.join() !== (edit.blockedDays || []).join();
      const steps = changed ? replan(edit.steps, Date.now(), due, blocked) : edit.steps;
      await save({ ...edit, title, course, due, blockedDays: blocked, steps });
      close(); renderDetail(edit.id); return;
    }
    if (due < Date.now()) { err.textContent = "That due date has already passed. Pick a later one."; return; }
    const steps = buildPlan(template, Date.now(), due, blocked, opts());
    if (!steps.length) { err.textContent = "Add at least one step."; return; }
    const id = "m-" + uid();
    const own = mineOf(template);
    await save({ id, title, course, due, template, ...(own ? { templateName: own.name } : {}), blockedDays: blocked, steps, deadlineKey: m.deadlineKey || "", created: Date.now() });
    close();
    go(id);
    ctx0.toast(`Planned ${steps.length} steps for “${title}”`);
  };
  setTimeout(() => (m.title ? f.due : f.title).focus(), 50);
}

/* ---------- adding files: the File button, drag and drop (files or folders), and paste ---------- */
let adding = false;
/** "guide" or "questions" when the file name says so. */
function kindFromName(name) {
  const n = String(name).replace(/\.[^.]+$/, "");
  if (/study[\s_.-]*guide/i.test(n)) return "guide";
  if (/practice[\s_.-]*(questions?|problems?|qs|test|exam|quiz)/i.test(n)) return "questions";
  return "";
}
const isTextDoc = f => /\.(md|markdown|txt)$/i.test(f.name) || /^text\/(markdown|plain)$/.test(f.type || "");
const titleFrom = name => String(name).replace(/\.[^.]+$/, "").replace(/[_]+/g, " ").replace(/\s+/g, " ").trim();
/** Attach files to the open milestone: to step `sid`, or to the whole plan (a rubric then goes to the submit step). */
async function addFiles(list, sid) {
  const id = current; if (!id || !list.length || !ws) return;
  if (adding) { ctx0.toast("Still adding the last batch. Try again in a moment."); return; }
  adding = true;
  const m = ws.m, step = sid ? m.steps.find(s => s.id === sid) : null;
  let ok = 0; const failed = [];
  try {
    for (const [i, file] of list.entries()) {
      if (list.length > 1) ctx0.toast(`Adding ${i + 1} of ${list.length}…`);
      const to = step || (/rubric/i.test(file.name) ? submitStep(m) : null);
      const owner = ownerOf(id, to && to.id), kind = kindFromName(file.name);
      try {
        if (kind && isTextDoc(file)) await saveDoc({ owner, kind, title: titleFrom(file.name), body: await file.text() });
        else { const rec = await files.add(file, { scope: "milestone", owner }); if (kind) await files.update(rec.id, { kind }); }
        ok++;
      }
      catch (err) { failed.push(`${file.name}: ${files.errorText(err)}`); }
    }
  } finally { adding = false; }
  if (current === id) await renderDetail(id);
  const where = step ? ` to “${step.title}”` : "";
  if (failed.length) ctx0.toast(ok ? `Added ${ok}${where}. ${failed.length} didn't: ${failed[0]}` : failed[0]);
  else ctx0.toast(ok === 1 ? `Added ${list[0].name}${where}.` : `Added ${ok} files${where}.`);
}
/** Everything in a drop, opening folders (and folders inside them). */
async function droppedFiles(dt) {
  const items = [...(dt.items || [])].filter(it => it.kind === "file");
  const entries = items.map(it => it.webkitGetAsEntry && it.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...(dt.files || [])];
  const out = [];
  const walk = async entry => {
    if (entry.isFile) { out.push(await new Promise((res, rej) => entry.file(res, rej))); return; }
    if (!entry.isDirectory) return;
    const reader = entry.createReader();
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      for (const e of batch) if (!e.name.startsWith(".")) await walk(e);
    }
  };
  for (const e of entries) await walk(e).catch(() => {});
  return out;
}
function wireDrop() {
  const main = $("#ms-main");
  let depth = 0;
  const hasFiles = e => [...(e.dataTransfer?.types || [])].includes("Files");
  const target = e => {
    const row = e.target.closest(".ms-step");
    if (row) return { el: row, sid: row.dataset.sid };
    if (e.target.closest("#ms-ws")) return { el: $("#ms-ws"), sid: sel };
    return { el: $(".ms-page"), sid: sel };
  };
  const clear = () => main.querySelectorAll(".drop-on").forEach(x => x.classList.remove("drop-on"));
  main.addEventListener("dragenter", e => { if (!current || !hasFiles(e)) return; depth++; main.classList.add("dropping"); });
  main.addEventListener("dragover", e => {
    if (!current || !hasFiles(e)) return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    const t = target(e); clear(); t.el?.classList.add("drop-on");
    const name = t.sid ? ws?.m.steps.find(s => s.id === t.sid)?.title : null;
    const hint = $("#ms-drophint"); if (hint) hint.textContent = name ? `Drop to add to “${name}”` : `Drop to add to the whole ${ws?.m.template === "exam" ? "exam" : "project"}`;
  });
  main.addEventListener("dragleave", e => { if (!hasFiles(e)) return; if (--depth <= 0) { depth = 0; main.classList.remove("dropping"); clear(); } });
  main.addEventListener("drop", async e => {
    if (!current || !hasFiles(e)) return;
    e.preventDefault(); depth = 0; main.classList.remove("dropping");
    const t = target(e); clear();
    addFiles(await droppedFiles(e.dataTransfer), t.sid || null);
  });
  // paste: screenshots and copied files go into the open workspace
  document.addEventListener("paste", e => {
    const t = e.target instanceof Element ? e.target : null;
    if (!current || !ctx0.isActive() || (t && t.closest("input,textarea,[contenteditable]"))) return;
    const list = [...(e.clipboardData?.files || [])];
    if (!list.length) return;
    e.preventDefault();
    const d = new Date(), pad = n => String(n).padStart(2, "0");
    const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
    addFiles(list.map(f => f.name && f.name !== "image.png" ? f : new File([f], `Pasted ${stamp}.${(f.type.split("/")[1] || "png").replace("jpeg", "jpg")}`, { type: f.type })), sel);
  });
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

  const closeMenu = () => { const m = root.querySelector(".ms-menu"); if (m && !m.hidden) { m.hidden = true; root.querySelector('[data-act="more"]')?.setAttribute("aria-expanded", "false"); } };
  document.addEventListener("click", e => { if (!(e.target instanceof Element && e.target.closest(".ms-more"))) closeMenu(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape") closeMenu(); });
  $("#ms-main").addEventListener("click", async e => {
    const act = e.target.closest("[data-act]")?.dataset.act;
    const cardEl = e.target.closest(".ms-card");
    if (!act && cardEl) { go(cardEl.dataset.id); return; }
    if (act === "new") return openSheet();
    if (!current) return;
    const id = current;
    const menu = $(".ms-menu");
    if (act === "more") {
      menu.hidden = !menu.hidden;
      e.target.closest("[data-act]").setAttribute("aria-expanded", String(!menu.hidden));
      return;
    }
    if (menu && !menu.hidden) { menu.hidden = true; $('[data-act="more"]')?.setAttribute("aria-expanded", "false"); }
    if (act === "file") { openAttachment(e.target.closest("[data-fid]").dataset.fid); return; }
    if (act === "fdel") {
      const fid = e.target.closest("[data-fid]").dataset.fid, f = await files.get(fid);
      if (f && confirm(`Remove ${f.name}? It's deleted from all your devices.`)) { await files.remove(fid); renderDetail(id); }
      return;
    }
    if (act === "fstep") return;
    const sid = e.target.closest("[data-sid]")?.dataset.sid;
    const did = e.target.closest("[data-did]")?.dataset.did;
    const doc = did && ws ? ws.docs.find(d => d.id === did) : null;
    if (!act) {
      // tap a step row (not one of its buttons) to open its workspace; tap again for the whole project
      if (sid && !e.target.closest("input,select,label")) selectStep(sel === sid ? null : sid);
      return;
    }
    if (act === "ws-all") { openDoc = null; selectStep(null); return; }
    if (act === "pick-doc") { openDoc = did; selectStep(sid); return; }
    if (act === "ws-open" && doc) {
      openReader(doc, { onEdit: () => openDocEditor(root, doc, { toast: ctx0.toast, prompt: promptFor(String(doc.owner).split(":")[2] || null), onSave: () => renderDetail(id), onDelete: () => renderDetail(id) }) });
      return;
    }
    if (act === "more-steps") { expanded = !expanded; renderDetail(id); return; }
    if (act === "add-open") { addOpen = true; renderDetail(id); return; }
    if (act === "fmore") { e.target.closest(".ms-frow").classList.toggle("tools-on"); return; }
    if (act === "ws-note") {
      openDocEditor(root, { owner: ownerOf(id, sel), kind: "note" }, { toast: ctx0.toast, prompt: promptFor(sel), onSave: nid => { openDoc = nid; renderDetail(id); } });
      return;
    }
    if (act === "ws-edit" && doc) {
      openDocEditor(root, doc, { toast: ctx0.toast, prompt: promptFor(String(doc.owner).split(":")[2] || null), onSave: () => renderDetail(id), onDelete: () => { openDoc = null; renderDetail(id); } });
      return;
    }
    if (act === "ws-copydoc" && doc) { ctx0.toast(await copyText(doc.body || "") ? "Copied" : "Couldn't copy. Select the text instead."); return; }
    if (act === "ws-copy" && ws) {
      const step = sel ? ws.m.steps.find(s => s.id === sel) : null;
      const ok = await copyText(studyPrompt(ws.m, step, "guide"));
      ctx0.toast(ok ? "Prompt copied. Paste it into your AI, then add the answer as a note." : "Couldn't copy the prompt.");
      return;
    }
    if (act === "toggle") {
      const m = await update(id, m => ({ ...m, steps: m.steps.map(s => s.id === sid ? { ...s, done: !s.done } : s) }));
      if (m && !m.steps.some(s => !s.done)) ctx0.toast(`All steps done for “${m.title}”. Nice work.`);
      renderDetail(id);
    } else if (act === "rate-clear") {
      await update(id, m => ({ ...m, steps: m.steps.map(x => x.id === sid ? { ...x, rating: null } : x) }));
      renderDetail(id);
    } else if (act === "rate-good" || act === "rate-shaky") {
      const shaky = act === "rate-shaky";
      const m = await update(id, m => {
        const s = m.steps.find(x => x.id === sid); if (!s) return m;
        const steps = m.steps.map(x => x.id === sid ? { ...x, rating: shaky ? "shaky" : "good" } : x);
        if (shaky) steps.push({ id: "s" + uid(), title: `Review again: ${s.topic || s.title.replace(/^(Quiz yourself|Study):\s*/, "")}`, date: shakyReviewDate(m.steps, Date.now(), m.due), estMin: 45, done: false, kind: "again", topic: s.topic });
        return { ...m, steps };
      });
      if (shaky && m) { const a = m.steps[m.steps.length - 1]; ctx0.toast(`Added “${a.title}” for ${dueLabel(a.date)}.`); }
      renderDetail(id);
    } else if (act === "rmstep") {
      await update(id, m => ({ ...m, steps: m.steps.filter(s => s.id !== sid) }));
      // the step's notes and files move to the whole project
      await moveDocs(ownerOf(id, sid), ownerOf(id)).catch(() => {});
      for (const f of await files.list({ owner: ownerOf(id, sid) }).catch(() => [])) await files.update(f.id, { owner: ownerOf(id) });
      if (sel === sid) sel = null;
      renderDetail(id);
    } else if (act === "date") {
      const row = e.target.closest(".ms-step"), btn = row.querySelector(".ms-when") || e.target.closest("[data-act]"), raw = await store.get(APP, id), s = raw.steps.find(x => x.id === sid);
      const inp = document.createElement("input"); inp.type = "datetime-local"; inp.value = toLocalInput(s.date);
      inp.min = toLocalInput(Math.min(Date.now(), s.date)); inp.max = toLocalInput(raw.due);
      btn.replaceWith(inp); inp.focus();
      let saved = false;
      const done = async () => {
        if (saved) return; saved = true;
        const t = inp.value ? new Date(inp.value).getTime() : s.date;
        if (t !== s.date) await update(id, m => ({ ...m, steps: m.steps.map(x => x.id === sid ? { ...x, date: Math.min(t, m.due) } : x) }));
        renderDetail(id);
      };
      inp.addEventListener("change", done); inp.addEventListener("blur", done);
    } else if (act === "rename") {
      const btn = e.target.closest(".ms-step").querySelector(".ms-ttl"), raw = await store.get(APP, id), s = raw.steps.find(x => x.id === sid);
      const inp = document.createElement("input"); inp.className = "field ms-rename-in"; inp.value = s.title; inp.setAttribute("aria-label", "Step name");
      btn.replaceWith(inp); inp.focus(); inp.select();
      let saved = false;
      const done = async keep => {
        if (saved) return; saved = true;
        const title = inp.value.trim();
        if (keep && title && title !== s.title) await update(id, m => ({ ...m, steps: m.steps.map(x => x.id === sid ? { ...x, title } : x) }));
        renderDetail(id);
      };
      inp.addEventListener("keydown", k => { if (k.key === "Enter") { k.preventDefault(); done(true); } else if (k.key === "Escape") done(false); });
      inp.addEventListener("blur", () => done(true));
    } else if (act === "est") {
      const btn = e.target.closest("[data-act]"), raw = await store.get(APP, id), s = raw.steps.find(x => x.id === sid);
      const cur = s.estMin || 45, opts = [...new Set([15, 30, 45, 60, 90, 120, 180, 240, cur])].sort((a, b) => a - b);
      const sel = document.createElement("select"); sel.className = "field ms-est-in"; sel.setAttribute("aria-label", "How long it takes");
      sel.innerHTML = opts.map(v => `<option value="${v}" ${v === cur ? "selected" : ""}>${fmtDur(v)}</option>`).join("");
      btn.replaceWith(sel); sel.focus();
      let saved = false;
      const done = async () => {
        if (saved) return; saved = true;
        const v = +sel.value;
        if (v !== cur) await update(id, m => ({ ...m, steps: m.steps.map(x => x.id === sid ? { ...x, estMin: v } : x) }));
        renderDetail(id);
      };
      sel.addEventListener("change", done); sel.addEventListener("blur", done);
    } else if (act === "finish") {
      await update(id, m => ({ ...m, steps: m.steps.map(s => ({ ...s, done: true })) }));
      ctx0.toast("Marked every step done."); renderDetail(id);
    } else if (act === "replan") {
      await update(id, m => ({ ...m, steps: replan(m.steps, Date.now(), m.due, m.blockedDays || DEFAULT_BLOCKED) }));
      ctx0.toast("Re-planned from today."); renderDetail(id);
    } else if (act === "save-tpl") {
      const raw = await store.get(APP, id);
      openCreator(root, { prefill: { name: tplLabel(raw) === "Custom" ? raw.title : `My ${tplLabel(raw).toLowerCase()}`, steps: stepsFromPlan({ id, ...raw }) }, toast: ctx0.toast });
    } else if (act === "edit") {
      const raw = await store.get(APP, id); openSheet({ edit: { id, ...raw } });
    } else if (act === "del") {
      const wrap = $("#ms-del-wrap"), raw = await store.get(APP, id);
      wrap.innerHTML = `<span class="confirm">Delete “${esc(raw.title)}” and its steps? <button class="pill-btn danger" data-act="del-yes">Delete</button><button class="pill-btn secondary" data-act="del-no">Cancel</button></span>`;
    } else if (act === "del-yes") {
      const raw = await store.get(APP, id); await store.remove(APP, id);
      for (const f of await files.list({ owner: ownerOf(id) }).catch(() => [])) await files.remove(f.id);
      for (const d of await listDocs(ownerOf(id)).catch(() => [])) await removeDoc(d.id);
      ctx0.toast(`Deleted “${raw ? raw.title : "milestone"}”`); go("");
    } else if (act === "del-no") renderDetail(id);
  });
  $("#ms-main").addEventListener("change", async e => {
    if (!current) return;
    const id = current;
    if (e.target.classList.contains("ws-fpick2")) { const list = [...e.target.files]; e.target.value = ""; addFiles(list, sel); return; }
    if (e.target.id === "ms-fpick") {
      const list = [...e.target.files]; e.target.value = "";
      addFiles(list, sel);
    } else if (e.target.dataset.act === "fstep") {
      await files.update(e.target.closest("[data-fid]").dataset.fid, { owner: ownerOf(id, e.target.value) }); renderDetail(id);
    }
  });
  wireDrop();
  $("#ms-main").addEventListener("keydown", e => {
    if (e.key === "Enter" && e.target.classList.contains("ws-file")) { e.preventDefault(); e.target.querySelector("input").click(); }
  });
  $("#ms-main").addEventListener("submit", async e => {
    if (e.target.id !== "ms-addstep" || !current) return;
    e.preventDefault();
    const inp = e.target.querySelector("input"), title = inp.value.trim(); if (!title) return;
    const id = current;
    let when = null;
    await update(id, m => {
      const d = new Date(m.due); d.setDate(d.getDate() - 1); d.setHours(20, 0, 0, 0);
      const date = Math.max(Math.min(+d, m.due - 3600e3), Date.now() + 30 * 60e3);
      when = Math.min(date, m.due);
      return { ...m, steps: [...m.steps, { id: "s" + uid(), title, date: when, estMin: 45, done: false }] };
    });
    addOpen = true; renderDetail(id);
    if (when) ctx0.toast(`Added for ${dueLabel(when)}. Use its calendar icon to move it.`);
  });
  const refreshFileLines = async () => {
    if (!current || !ws) return;
    for (const row of root.querySelectorAll(".ms-frow[data-fid]")) {
      const f = await files.get(row.dataset.fid); const line = row.querySelector(".ms-fopen .s");
      if (f && line) line.textContent = [KINDS[f.kind], files.sizeText(f.size), files.statusText(f)].filter(Boolean).join(" · ");
    }
  };
  store.onChange(ch => { if (ch.app === "files" && current) refreshFileLines(); });
  sync.onStatus(() => refreshFileLines());
  store.onChange(ch => { if ((ch.app === APP || (ch.app === "docs" && current)) && ctx0.isActive() && ch.source === "remote") (current ? renderDetail(current) : renderList()); });
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
      const have = await planFor(did);
      if (have) { history.replaceState(null, "", `#${APP}/${have.id}`); ctx0.toast("You already have a plan for this deadline."); return renderDetail(have.id); }
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

export default { id: APP, name: "Milestones", icon: "milestone", tint: "blue", mount, show, agenda, complete };
