// Syllabus Scanner: paste a syllabus (or drop in its PDF), review what it found,
// and import the deadlines into Deadline Hub (source "syllabus"). No-class days
// go to Schedule's semester breaks, and grading weights go on the course.
// Everything runs on the device.
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import { toLocalInput } from "../deadlines/parse.js";
import { loadDeadlines, knownCourses, courseColor } from "../deadlines/deadlines.js";
import { scanSyllabus, similar, ymd } from "./scan.js";

const APP = "syllabus";
const TYPE_LABELS = { exam: "Exam", quiz: "Quiz", project: "Project", homework: "Homework", lab: "Lab", paper: "Paper", presentation: "Presentation" };
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shortDay = t => new Date(t).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

// Schedule is optional: use its courses and semester dates when it's there.
async function schedule() {
  try { const m = await import("../schedule/schedule.js"); return { courses: await m.loadCourses(), semester: await m.loadSemester() }; }
  catch (e) { return { courses: [], semester: { breaks: [] } }; }
}

let ctx0, root;
const $ = s => root.querySelector(s);
let state = { course: "", text: "", fileName: "", semStart: null, result: null };

/* ---------- step 1: paste or drop ---------- */
async function renderStart() {
  const { courses, semester } = await schedule();
  const names = [...new Set([...courses.map(c => c.code), ...(await knownCourses())])];
  if (!state.semStart && semester.start) state.semStart = semester.start;
  $("#sy-main").innerHTML = `
    <div class="ap-card pad">
      <div style="display:flex;gap:12px;align-items:flex-start">
        <span class="tile-ic" style="background:#0e9fb0;width:36px;height:36px;border-radius:10px">${svg("scanText")}</span>
        <div><div style="font-weight:700">Turn a syllabus into deadlines</div>
        <div class="ap-hint" style="padding:0;margin-top:2px">Paste the schedule part of a syllabus or drop in its PDF. You'll check everything before it's added. Nothing leaves your device.</div></div>
      </div>
      <div class="sy-two">
        <label class="sy-field">Course<input class="field" id="sy-course" list="sy-courses" placeholder="CS 25100" value="${esc(state.course)}"></label>
        <label class="sy-field">First day of classes<input class="field" type="date" id="sy-start" value="${state.semStart ? ymd(state.semStart) : ""}"></label>
      </div>
      <div class="ap-hint" style="padding:0">The first day is only needed for syllabi that say “Week 5” instead of a date.${semester.start ? " Filled in from Schedule." : ""}</div>
      <datalist id="sy-courses">${names.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    </div>
    <label class="sy-drop" id="sy-drop" for="sy-file">
      ${svg("fileUp")}<b>Drop a PDF or text file here</b><span>or tap to choose one</span>
      <span id="sy-file-status" class="ap-hint" style="padding:0"></span>
      <input type="file" id="sy-file" accept=".pdf,.txt,.md,text/plain,application/pdf" hidden>
    </label>
    <div class="sy-or">or paste</div>
    <textarea class="sy-paste" id="sy-text" placeholder="Week 1  Jan 11  Introduction&#10;PA1 due Feb 3 at 11:59 PM&#10;Midterm 1: Wed Feb 24 (in class)&#10;Spring Break Mar 15–19, no classes">${esc(state.text)}</textarea>
    <span class="ap-err" id="sy-err"></span>
    <button class="pill-btn" id="sy-scan" style="align-self:flex-start;padding:11px 18px;font-size:15px">Scan</button>`;

  const drop = $("#sy-drop"), fileIn = $("#sy-file");
  ["dragenter", "dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", e => { const f = e.dataTransfer.files[0]; if (f) readFile(f); });
  fileIn.onchange = () => { if (fileIn.files[0]) readFile(fileIn.files[0]); };
  $("#sy-scan").onclick = scan;
}

async function readFile(file) {
  const status = $("#sy-file-status"), err = $("#sy-err");
  err.textContent = "";
  try {
    if (/\.pdf$/i.test(file.name) || file.type === "application/pdf") {
      status.textContent = `Reading ${file.name}…`;
      const { pdfToText } = await import("./pdftext.js");
      const text = await pdfToText(file, (p, n) => { status.textContent = `Reading ${file.name}… page ${p} of ${n}`; });
      if (!text.trim()) { err.textContent = "That PDF has no readable text. It might be a scan or photo. Copy the dates by hand, or paste them from the course website."; status.textContent = ""; return; }
      $("#sy-text").value = text;
    } else {
      $("#sy-text").value = await file.text();
    }
    state.fileName = file.name;
    status.textContent = `Loaded ${file.name}. Check the text below, then tap Scan.`;
  } catch (e) {
    console.error(e);
    status.textContent = "";
    err.textContent = navigator.onLine ? "Couldn't read that file. Try pasting the text instead." : "PDF reading needs to load once while you're online. Paste the text for now.";
  }
}

async function scan() {
  state.course = $("#sy-course").value.trim();
  state.text = $("#sy-text").value;
  const sd = $("#sy-start").value; state.semStart = sd ? +new Date(sd + "T00:00") : null;
  const err = $("#sy-err"); err.textContent = "";
  if (!state.text.trim()) { err.textContent = "Paste the syllabus text or drop in a file first."; return; }
  const { courses } = await schedule();
  const course = courses.find(c => c.code.toLowerCase() === state.course.toLowerCase());
  const meetings = course ? course.meetings || [] : [];
  const r = scanSyllabus(state.text, { now: Date.now(), semesterStart: state.semStart, meetings });
  if (!r.items.length && !r.breaks.length && !r.weights.length) {
    err.textContent = /week\s*\d/i.test(state.text) && !state.semStart
      ? "Nothing with a date found. This syllabus uses week numbers, so add the first day of classes above and scan again."
      : "Nothing with a date found. Paste the part of the syllabus with the schedule or due dates.";
    return;
  }
  // flag things already in Deadline Hub (same course, same day, similar title)
  const existing = await loadDeadlines();
  for (const it of r.items) {
    it.dup = existing.some(d => d.due && ymd(d.due) === ymd(it.due) && (!state.course || !d.course || d.course.toLowerCase() === state.course.toLowerCase()) && similar(d.title, it.title));
    it.on = !it.dup && !it.tentative;
  }
  for (const b of r.breaks) b.on = true;
  state.result = r;
  renderReview(course);
}

/* ---------- step 2: review ---------- */
function itemRow(it, i) {
  const flags = [
    it.tentative ? `<span class="sy-flag warn">Date not final</span>` : !it.timeKnown ? `<span class="sy-flag warn">Check the time</span>` : "",
    it.fromWeek ? `<span class="sy-flag warn">From week number</span>` : "",
    it.dup ? `<span class="sy-flag dup">Already in Deadlines</span>` : "",
  ].join("");
  return `<div class="sy-item ${it.on ? "" : "off"}" data-i="${i}">
    <input type="checkbox" data-f="on" ${it.on ? "checked" : ""} aria-label="Import ${esc(it.title)}">
    <div class="sy-fields">
      <div class="sy-row1"><input class="field" type="text" data-f="title" value="${esc(it.title)}" aria-label="Title"></div>
      <div class="sy-row2">
        <select class="field" data-f="type" aria-label="Type">${Object.entries(TYPE_LABELS).map(([k, v]) => `<option value="${k}" ${k === it.type ? "selected" : ""}>${v}</option>`).join("")}</select>
        <input class="field" type="datetime-local" data-f="due" value="${toLocalInput(it.due)}" aria-label="Due">
        ${flags}
      </div>
      <div class="sy-src" title="${esc(it.line)}">“${esc(it.line)}”</div>
    </div>
  </div>`;
}

function renderReview(course) {
  const r = state.result;
  const counts = {}; for (const it of r.items) counts[it.type] = (counts[it.type] || 0) + 1;
  const courseChip = state.course ? `<span class="chip course" style="background:${course ? (course.color || courseColor(course.code)) : courseColor(state.course)}">${esc(state.course)}</span>` : "";
  $("#sy-main").innerHTML = `
    <div class="ap-sec"><h3>Found${courseChip ? " for " : ""}${courseChip}</h3>
      <div class="sy-sum">${Object.entries(counts).map(([k, n]) => `<span class="chip">${n} ${TYPE_LABELS[k] || k}${n === 1 ? "" : "s"}</span>`).join("")}${r.breaks.length ? `<span class="chip">${r.breaks.length} no-class</span>` : ""}</div>
      <p class="ap-hint">Untick anything you don't want, and fix titles or times. Times marked “Check the time” are guesses: class time for exams and quizzes, otherwise 11:59 PM.</p>
    </div>
    ${r.items.length ? `<section class="ap-sec"><h3>Deadlines<span class="n" id="sy-count"></span></h3><div class="ap-card" id="sy-items">${r.items.map(itemRow).join("")}</div></section>` : ""}
    ${r.breaks.length ? `<section class="ap-sec"><h3>No class</h3><div class="ap-card">${r.breaks.map((b, i) => `<label class="ap-row"><input type="checkbox" data-break="${i}" ${b.on ? "checked" : ""} style="width:20px;height:20px;accent-color:var(--accent-strong)"><span class="grow"><span class="t">${esc(b.label)}</span><span class="s">${esc(shortDay(b.from))}${b.to && b.to !== b.from ? ` – ${esc(shortDay(b.to))}` : ""}</span></span></label>`).join("")}</div>
      <p class="ap-hint">These go into Schedule as breaks, so reminders and the class widget know there's no class.</p></section>` : ""}
    ${r.weights.length ? `<section class="ap-sec"><h3>Grading</h3><div class="ap-card">${r.weights.map(w => `<div class="ap-row"><span class="grow"><span class="t">${esc(w.label)}</span></span><span class="ap-pill">${w.pct}%</span></div>`).join("")}</div>
      <p class="ap-hint">${course ? `Saved on ${esc(course.code)} when you import, for a grade calculator later.` : `Add ${esc(state.course || "this course")} in Schedule to keep these weights.`}</p></section>` : ""}
    <div style="height:8px"></div>`;
  renderFoot(course);
  updateCount();
}

function renderFoot(course) {
  let foot = root.querySelector(".sy-foot");
  if (!foot) { foot = document.createElement("div"); foot.className = "sy-foot"; root.appendChild(foot); }
  foot.hidden = false;
  foot.innerHTML = `<button class="pill-btn secondary" id="sy-back">Start over</button><button class="pill-btn" id="sy-import">Import</button>`;
  foot.querySelector("#sy-back").onclick = () => { foot.hidden = true; renderStart(); };
  foot.querySelector("#sy-import").onclick = () => doImport(course);
}

function updateCount() {
  const r = state.result; if (!r) return;
  const n = r.items.filter(i => i.on).length, b = r.breaks.filter(x => x.on).length;
  const c = $("#sy-count"); if (c) c.textContent = `${n} of ${r.items.length}`;
  const btn = root.querySelector("#sy-import");
  if (btn) {
    const parts = [n ? `${n} deadline${n === 1 ? "" : "s"}` : "", b ? `${b} break${b === 1 ? "" : "s"}` : ""].filter(Boolean);
    btn.textContent = parts.length ? `Import ${parts.join(" + ")}` : "Nothing selected";
    btn.disabled = !parts.length && !r.weights.length;
    if (!parts.length && r.weights.length) btn.textContent = "Save grading weights";
  }
}

async function doImport(course) {
  const r = state.result, btn = root.querySelector("#sy-import");
  btn.disabled = true; btn.textContent = "Importing…";
  const now = Date.now();
  const picked = r.items.filter(i => i.on && i.title.trim() && i.due);
  for (const it of picked) {
    await store.put("deadlines", "d-" + uid(), { title: it.title.trim(), course: state.course, due: it.due, source: "syllabus", type: it.type, done: false, created: now });
  }
  // breaks → Schedule's semester (skip ones already there)
  const brk = r.breaks.filter(b => b.on);
  if (brk.length) {
    const sem = (await store.get("schedule", "semester")) || { start: null, end: null, breaks: [] };
    const have = new Set((sem.breaks || []).map(b => ymd(b.from)));
    const add = brk.filter(b => !have.has(ymd(b.from))).map(b => ({ id: uid(), label: b.label, from: b.from, to: b.to || b.from }));
    if (add.length) await store.put("schedule", "semester", { ...sem, breaks: [...(sem.breaks || []), ...add] });
  }
  // weights → the course in Schedule
  if (course && r.weights.length) {
    const raw = await store.get("courses", course.id);
    if (raw) await store.put("courses", course.id, { ...raw, weights: r.weights.map(w => ({ label: w.label, pct: w.pct })) });
  }
  root.querySelector(".sy-foot").hidden = true;
  $("#sy-main").innerHTML = `<div class="ap-card sy-done">${svg("circleCheckBig")}
    <b>Imported ${picked.length} deadline${picked.length === 1 ? "" : "s"}${brk.length ? ` and ${brk.length} break${brk.length === 1 ? "" : "s"}` : ""}</b>
    <span class="ap-hint">They're in Deadline Hub, tagged “Syllabus”, and reminders will pick them up.</span>
    <div style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"><a class="pill-btn" href="#deadlines" style="text-decoration:none">Open Deadlines</a><button class="pill-btn secondary" id="sy-another">Scan another</button></div></div>`;
  $("#sy-another").onclick = () => { state = { course: "", text: "", fileName: "", semStart: state.semStart, result: null }; renderStart(); };
  ctx0.toast(`Imported ${picked.length} from the syllabus`);
}

/* ---------- app ---------- */
let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./syllabus.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = `
    <div class="ap-bar">
      <button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button>
      <span class="ap-title">Syllabus Scanner</span>
    </div>
    <div class="ap-scroll"><div class="ap-body" id="sy-main"></div></div>`;
  // edits in the review list
  $("#sy-main").addEventListener("input", e => {
    const row = e.target.closest(".sy-item"), r = state.result; if (!row || !r) return;
    const it = r.items[+row.dataset.i], f = e.target.dataset.f;
    if (f === "title") it.title = e.target.value;
    if (f === "type") it.type = e.target.value;
    if (f === "due" && e.target.value) { it.due = new Date(e.target.value).getTime(); it.timeKnown = true; }
  });
  $("#sy-main").addEventListener("change", e => {
    const r = state.result; if (!r) return;
    if (e.target.dataset.f === "on") { const row = e.target.closest(".sy-item"); r.items[+row.dataset.i].on = e.target.checked; row.classList.toggle("off", !e.target.checked); updateCount(); }
    if (e.target.dataset.break != null) { r.breaks[+e.target.dataset.break].on = e.target.checked; updateCount(); }
  });
  // Enter in a title jumps to the next title
  $("#sy-main").addEventListener("keydown", e => {
    if (e.key !== "Enter" || e.target.dataset.f !== "title") return;
    e.preventDefault();
    const next = e.target.closest(".sy-item").nextElementSibling;
    if (next) next.querySelector('[data-f="title"]').focus();
  });
  await renderStart();
}

function show() { if (!state.result && root && !$("#sy-text")) renderStart(); }

export default { id: APP, name: "Syllabus", icon: "scanText", color: ["#22c3d6", "#0e8a9a"], mount, show };
