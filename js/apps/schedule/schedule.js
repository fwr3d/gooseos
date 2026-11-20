// Class Schedule: your weekly classes, labs and PSOs, with a now/next widget.
// It also owns the course list every other app uses.
//
// Saved items:
//   app "courses", one per course:
//     { code: "CS 18000", name, color, meetings: [{ id, days: "MWF", start: "09:30", end: "10:20", room, kind }] }
//     days use M T W R F S U  (R = Thursday, U = Sunday)
//   app "schedule", item "semester": { start, end (ms), breaks: [{ id, label, from, to }] }
import * as store from "../../store.js";
import { svg, tile } from "../../icons.js";
import { courseColor } from "../deadlines/deadlines.js";

const APP = "schedule";
const COURSES = "courses";
const BY_JS_DAY = "UMTWRFS";          // index = Date.getDay()
const WEEK = "MTWRFSU";
const DAY_SHORT = { M: "Mon", T: "Tue", W: "Wed", R: "Thu", F: "Fri", S: "Sat", U: "Sun" };
const DAY_BTN = { M: "M", T: "Tu", W: "W", R: "Th", F: "F", S: "Sa", U: "Su" };
const KINDS = { lecture: "Lecture", lab: "Lab", rec: "Recitation", pso: "PSO", sem: "Seminar", other: "Class" };
const KIND_WORDS = { lecture: "lecture", lec: "lecture", lab: "lab", rec: "rec", recitation: "rec", pso: "pso", sem: "sem", seminar: "sem" };
const SWATCHES = ["#2f5bea", "#e5484d", "#22a45d", "#e08a00", "#8b5cf6", "#0e9fb0", "#db2777", "#64748b"];

const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const pad = n => String(n).padStart(2, "0");
const toMin = s => { const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
export const fmtTime = s => { const m = toMin(s); return new Date(2000, 0, 1, Math.floor(m / 60), m % 60).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); };
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
const at = (d0, hhmm) => { const d = new Date(d0); const m = toMin(hhmm); d.setHours(Math.floor(m / 60), m % 60, 0, 0); return +d; };
const dateInput = t => { if (!t) return ""; const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const fromDateInput = v => { if (!v) return null; const [y, m, d] = v.split("-").map(Number); return +new Date(y, m - 1, d); };
const shortDate = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
export function inTime(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
export const daysLabel = days => WEEK.split("").filter(d => (days || "").includes(d)).map(d => DAY_BTN[d]).join(" ");

/* ---------- data ---------- */
export async function loadCourses() {
  const rows = await store.list(COURSES);
  return rows.map(r => ({ id: r.id, ...r.data })).filter(c => c && c.code).sort((a, b) => a.code.localeCompare(b.code));
}
export async function loadSemester() { return (await store.get(APP, "semester")) || { breaks: [] }; }
export const colorOf = c => (c && c.color) || courseColor(c ? c.code : "");

/** Is the day of t a class day? Off days: before/after the semester, or on a break. */
export function dayStatus(sem, t) {
  const d = dayStart(t);
  if (sem.start && d < dayStart(sem.start)) return { off: true, label: "Before the semester" };
  if (sem.end && d > dayStart(sem.end)) return { off: true, label: "The semester is over" };
  for (const b of sem.breaks || []) if (b.from && d >= dayStart(b.from) && d <= dayStart(b.to || b.from)) return { off: true, label: b.label || "Break" };
  return { off: false };
}

/** Every class meeting on the day of t, soonest first, with real start/end times. */
export function meetingsOn(courses, sem, t) {
  if (dayStatus(sem, t).off) return [];
  const d0 = dayStart(t), letter = BY_JS_DAY[new Date(t).getDay()];
  const out = [];
  for (const c of courses) for (const m of c.meetings || []) {
    if (!(m.days || "").includes(letter) || !m.start || !m.end) continue;
    out.push({ course: c, meeting: m, start: at(d0, m.start), end: at(d0, m.end) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The class going on at time t, or null. Reminders uses this to stay quiet during class. */
export async function isInClass(t = Date.now()) {
  const [cs, sem] = await Promise.all([loadCourses(), loadSemester()]);
  return meetingsOn(cs, sem, t).find(x => x.start <= t && t < x.end) || null;
}

/** Everything the widget and Today need: now, next, the rest of today, and the next class day. */
export async function status(t = Date.now()) {
  const [courses, sem] = await Promise.all([loadCourses(), loadSemester()]);
  const today = meetingsOn(courses, sem, t);
  const now = today.find(x => x.start <= t && t < x.end) || null;
  const next = today.find(x => x.start > t) || null;
  let nextDay = null;
  for (let i = 1; i <= 14 && !nextDay; i++) {
    const d = new Date(dayStart(t)); d.setDate(d.getDate() + i);
    const list = meetingsOn(courses, sem, +d);
    if (list.length) nextDay = { ...list[0], inDays: i };
  }
  return { courses, sem, today, now, next, nextDay, off: dayStatus(sem, t) };
}

/* ---------- typing a class in one line ---------- */
// "CS 18000 MWF 9:30-10:20 LWSN B151", "ma 26100 TR 1:30-2:45pm room 204", "cs 18000 pso W 3:30-4:20"
export function parseDays(tok) {
  const s = String(tok).toLowerCase().replace(/[\/,.]/g, "");
  if (!s || s.length > 14) return "";
  const re = /(mon|m)|(tues|tue|tu)|(wed|w)|(thurs|thur|thu|th|r)|(fri|f)|(sat|sa)|(sun|su)|(t)/y;
  const map = "MTWRFSUT";
  let found = "";
  re.lastIndex = 0;
  while (re.lastIndex < s.length) {
    const m = re.exec(s);
    if (!m) return "";
    found += map[m.slice(1).findIndex(Boolean)];
  }
  return WEEK.split("").filter(d => found.includes(d)).join("");
}
const TIME_RE = /(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm|a|p)?\b/i;
function guessHour(h) { return h >= 13 ? h : h === 12 ? 12 : h >= 1 && h <= 7 ? h + 12 : h; }
function to24(h, ap) { return ap === "p" ? (h % 12) + 12 : h % 12; }
function timeRange(m) {
  const h1 = +m[1], m1 = +(m[2] || 0), h2 = +m[4], m2 = +(m[5] || 0);
  const a1 = m[3] ? m[3][0].toLowerCase() : "", a2 = m[6] ? m[6][0].toLowerCase() : "";
  if (h1 > 23 || h2 > 23 || m1 > 59 || m2 > 59) return null;
  const e = a2 ? to24(h2, a2) : guessHour(h2);
  let s;
  if (a1) s = to24(h1, a1);
  else if (a2) { s = to24(h1, a2); if (s * 60 + m1 >= e * 60 + m2) s = to24(h1, a2 === "p" ? "a" : "p"); }
  else s = guessHour(h1);
  if (s * 60 + m1 >= e * 60 + m2) return null;
  return [`${pad(s)}:${pad(m1)}`, `${pad(e)}:${pad(m2)}`];
}
export function parseClassLine(text) {
  let s = String(text || "").trim();
  const out = { code: "", days: "", start: "", end: "", room: "", kind: "lecture" };
  const cm = s.match(/^([a-z]{2,5})\s*(\d{3,5}[a-z]?)\b/i);
  if (cm) { out.code = `${cm[1].toUpperCase()} ${cm[2].toUpperCase()}`; s = s.slice(cm[0].length); }
  let before = s, after = "";
  const tm = s.match(TIME_RE);
  if (tm) { const r = timeRange(tm); if (r) [out.start, out.end] = r; before = s.slice(0, tm.index); after = s.slice(tm.index + tm[0].length); }
  const room = [];
  for (const w of before.split(/\s+/).filter(Boolean)) {
    const lw = w.toLowerCase().replace(/[(),]/g, "");
    if (!out.days) { const d = parseDays(w); if (d) { out.days = d; continue; } }
    if (KIND_WORDS[lw]) { out.kind = KIND_WORDS[lw]; continue; }
    if (!/^(room|rm|in|at|@)$/.test(lw)) room.push(w);
  }
  for (const w of after.split(/\s+/).filter(Boolean)) {
    const lw = w.toLowerCase().replace(/[(),]/g, "");
    if (KIND_WORDS[lw]) { out.kind = KIND_WORDS[lw]; continue; }
    if (!/^(room|rm|in|at|@)$/.test(lw)) room.push(w);
  }
  out.room = room.join(" ").trim();
  return out;
}

/** Add a meeting from a typed line. Joins an existing course with the same code. */
async function addFromLine(text) {
  const p = parseClassLine(text);
  if (!p.code) throw new Error("Start with the course code, like “CS 18000”.");
  if (!p.days) throw new Error("Add the days, like MWF or TR.");
  if (!p.start) throw new Error("Add the time, like 9:30-10:20.");
  const courses = await loadCourses();
  const meeting = { id: uid(), days: p.days, start: p.start, end: p.end, room: p.room, kind: p.kind };
  const cur = courses.find(c => c.code.replace(/\s/g, "").toLowerCase() === p.code.replace(/\s/g, "").toLowerCase());
  if (cur) {
    const { id, ...data } = cur;
    await store.put(COURSES, id, { ...data, meetings: [...(data.meetings || []), meeting] });
    return { course: cur, meeting, joined: true };
  }
  const used = new Set(courses.map(c => c.color));
  const color = SWATCHES.find(c => !used.has(c)) || courseColor(p.code);
  const id = "c-" + uid();
  const course = { code: p.code, name: "", color, meetings: [meeting] };
  await store.put(COURSES, id, course);
  return { course: { id, ...course }, meeting, joined: false };
}

/* ---------- view ---------- */
let ctx0, root, tab = "today";
const $ = s => root.querySelector(s);
try { tab = localStorage.getItem("sc-tab") || "today"; } catch (e) { /* ignore */ }

function meetingRow(x, t) {
  const c = x.course, m = x.meeting;
  let pill = "";
  if (t >= x.end) pill = `<span class="ap-pill">done</span>`;
  else if (t >= x.start) pill = `<span class="ap-pill good">now · ${inTime(x.end - t)} left</span>`;
  else if (x.start - t < 3 * 3600e3) pill = `<span class="ap-pill warn">in ${inTime(x.start - t)}</span>`;
  return `<button class="ap-row ${t >= x.end ? "sc-past" : ""}" data-course="${c.id}">
    <span class="sc-time tnum">${fmtTime(m.start)}<small>${fmtTime(m.end)}</small></span>
    <span class="sc-stripe" style="background:${colorOf(c)}"></span>
    <span class="grow"><span class="t">${esc(c.code)} <span class="sc-kind">${esc(KINDS[m.kind] || "Class")}</span></span><span class="s">${esc(m.room || "No room yet")}${c.name ? " · " + esc(c.name) : ""}</span></span>
    ${pill}</button>`;
}

function weekHtml(courses, sem) {
  const used = WEEK.split("").filter(d => "MTWRF".includes(d) || courses.some(c => (c.meetings || []).some(m => (m.days || "").includes(d))));
  const all = courses.flatMap(c => (c.meetings || []).filter(m => m.start && m.end));
  if (!all.length) return "";
  const lo = Math.max(0, Math.floor(Math.min(...all.map(m => toMin(m.start))) / 60));
  const hi = Math.min(24, Math.ceil(Math.max(...all.map(m => toMin(m.end))) / 60));
  const H = 52, now = new Date(), nowLetter = BY_JS_DAY[now.getDay()], nowMin = now.getHours() * 60 + now.getMinutes();
  const hours = []; for (let h = lo; h < hi; h++) hours.push(h);
  const col = d => {
    const blocks = [];
    for (const c of courses) for (const m of c.meetings || []) {
      if (!(m.days || "").includes(d) || !m.start || !m.end) continue;
      const top = (toMin(m.start) - lo * 60) / 60 * H, h = (toMin(m.end) - toMin(m.start)) / 60 * H;
      blocks.push(`<button class="sc-block" data-course="${c.id}" style="top:${top}px;height:${Math.max(h, 22)}px;--c:${colorOf(c)}"><b>${esc(c.code)}</b><span>${esc(KINDS[m.kind] || "")}${m.room ? " · " + esc(m.room) : ""}</span></button>`);
    }
    const line = d === nowLetter && nowMin >= lo * 60 && nowMin <= hi * 60 && !dayStatus(sem, Date.now()).off ? `<i class="sc-now" style="top:${(nowMin - lo * 60) / 60 * H}px"></i>` : "";
    return `<div class="sc-col ${d === nowLetter ? "today" : ""}" style="height:${(hi - lo) * H}px">${blocks.join("")}${line}</div>`;
  };
  return `<div class="sc-week-wrap"><div class="sc-week" style="grid-template-columns:44px repeat(${used.length},minmax(84px,1fr))">
    <div></div>${used.map(d => `<div class="sc-dh ${d === nowLetter ? "today" : ""}">${DAY_SHORT[d]}</div>`).join("")}
    <div class="sc-hours" style="height:${(hi - lo) * H}px">${hours.map(h => `<span style="top:${(h - lo) * H}px">${new Date(2000, 0, 1, h).toLocaleTimeString(undefined, { hour: "numeric" })}</span>`).join("")}</div>
    ${used.map(col).join("")}
  </div></div>`;
}

async function render() {
  const t = Date.now();
  const st = await status(t);
  const { courses, sem } = st;
  root.querySelectorAll(".ap-tabs button").forEach(b => b.setAttribute("aria-pressed", b.dataset.tab === tab));

  let main = "";
  if (!courses.length) {
    main = `<div class="ap-card"><div class="ap-empty"><b>Add your classes</b>Type one line per class above, like<br><code>CS 18000 MWF 9:30-10:20 LWSN B151</code><br>Add labs and PSOs the same way, with “lab” or “pso”.</div></div>`;
  } else if (tab === "today") {
    const head = st.off.off ? `<div class="ap-card pad sc-off"><b>${esc(st.off.label)}</b><span>No classes today.</span></div>` : "";
    main = head + (st.today.length
      ? `<section class="ap-sec"><h3>Today<span class="n">${st.today.length}</span></h3><div class="ap-card">${st.today.map(x => meetingRow(x, t)).join("")}</div></section>`
      : st.off.off ? "" : `<div class="ap-card"><div class="ap-empty"><b>No classes today</b>${st.nextDay ? `Next: ${esc(st.nextDay.course.code)} ${st.nextDay.inDays === 1 ? "tomorrow" : new Date(st.nextDay.start).toLocaleDateString(undefined, { weekday: "long" })} at ${fmtTime(st.nextDay.meeting.start)}` : ""}</div></div>`);
  } else {
    main = weekHtml(courses, sem);
  }

  const courseRows = courses.map(c => `<button class="ap-row" data-course="${c.id}">
      <span class="ap-swatch" style="background:${colorOf(c)};width:12px;height:12px"></span>
      <span class="grow"><span class="t">${esc(c.code)}${c.name ? ` <span class="sc-kind">${esc(c.name)}</span>` : ""}</span>
      <span class="s">${(c.meetings || []).map(m => `${esc(KINDS[m.kind] || "Class")} ${daysLabel(m.days)} ${fmtTime(m.start)}`).join(" · ") || "No meetings yet"}</span></span>
      ${svg("pencil")}</button>`).join("");

  const breaks = (sem.breaks || []).length;
  const semText = sem.start && sem.end ? `${shortDate(sem.start)} – ${shortDate(sem.end)}${breaks ? ` · ${breaks} break${breaks === 1 ? "" : "s"}` : ""}` : "Not set. Add the first and last day so the widget goes quiet on days off.";

  $("#sc-main").innerHTML = main;
  $("#sc-courses").innerHTML = courses.length ? `<section class="ap-sec"><h3>Courses<span class="n">${courses.length}</span></h3><div class="ap-card">${courseRows}</div></section>` : "";
  $("#sc-sem").innerHTML = `<section class="ap-sec"><h3>Semester</h3><button class="ap-card ap-row" id="sc-sem-edit" style="border:1px solid var(--line)"><span class="tile-ic" style="${tile("blue")}">${svg("calendar")}</span><span class="grow"><span class="t">${sem.start && sem.end ? "Semester dates" : "Set semester dates"}</span><span class="s" style="white-space:normal">${esc(semText)}</span></span>${svg("pencil")}</button></section>`;
  $("#sc-sem-edit").onclick = () => openSemester(sem);
}

function preview(text) {
  if (!text.trim()) return "";
  const p = parseClassLine(text);
  return [
    p.code ? `<span class="chip">${esc(p.code)}</span>` : `<span class="chip" style="color:var(--muted)">course code?</span>`,
    p.days ? `<span class="chip">${daysLabel(p.days)}</span>` : `<span class="chip" style="color:var(--muted)">days?</span>`,
    p.start ? `<span class="chip">${svg("clock")}${fmtTime(p.start)} – ${fmtTime(p.end)}</span>` : `<span class="chip" style="color:var(--muted)">time?</span>`,
    `<span class="chip">${esc(KINDS[p.kind])}</span>`,
    p.room ? `<span class="chip">${esc(p.room)}</span>` : "",
  ].join("");
}

/* ---------- course sheet ---------- */
function meetingEditor(m) {
  return `<div class="sc-meet" data-mid="${m.id}">
    <div class="two">
      <label>Type<select class="field" data-k="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${m.kind === k ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <label>Room<input class="field" data-k="room" value="${esc(m.room)}" placeholder="LWSN B151"></label>
    </div>
    <div class="ap-days" role="group" aria-label="Days">${WEEK.split("").map(d => `<button type="button" data-day="${d}" aria-pressed="${(m.days || "").includes(d)}">${DAY_BTN[d]}</button>`).join("")}</div>
    <div class="three">
      <label>Starts<input class="field" type="time" data-k="start" value="${esc(m.start)}"></label>
      <label>Ends<input class="field" type="time" data-k="end" value="${esc(m.end)}"></label>
      <label>&nbsp;<button type="button" class="pill-btn secondary" data-act="rm-meet" style="color:var(--bad)">Remove</button></label>
    </div>
  </div>`;
}

function openCourse(c) {
  const isNew = !c;
  c = c || { code: "", name: "", color: SWATCHES[0], meetings: [{ id: uid(), days: "", start: "", end: "", room: "", kind: "lecture" }] };
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet" role="dialog" aria-modal="true" aria-label="${isNew ? "New course" : "Edit course"}">
    <h2>${isNew ? "New course" : esc(c.code)}</h2>
    <div class="two">
      <label>Code<input class="field" name="code" required value="${esc(c.code)}" placeholder="CS 18000"></label>
      <label>Name<input class="field" name="name" value="${esc(c.name)}" placeholder="Problem Solving"></label>
    </div>
    <label>Color<span class="sc-swatches">${SWATCHES.map(s => `<button type="button" data-color="${s}" aria-label="Color ${s}" aria-pressed="${colorOf(c) === s}" style="background:${s}"></button>`).join("")}<input type="color" name="color" value="${esc(colorOf(c))}" aria-label="Custom color"></span></label>
    <div class="sc-meets">${(c.meetings || []).map(meetingEditor).join("")}</div>
    <button type="button" class="link-btn" data-act="add-meet" style="align-self:flex-start">+ Add a lab, PSO or another meeting</button>
    <span class="ap-err" id="sc-err"></span>
    <div class="acts">
      ${isNew ? "<span></span>" : `<button type="button" class="pill-btn secondary" data-act="del" style="color:var(--bad)">Delete course</button>`}
      <span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">Save</button></span>
    </div>
  </form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  f.addEventListener("click", async e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.day) { b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); return; }
    if (b.dataset.color) { f.color.value = b.dataset.color; f.querySelectorAll("[data-color]").forEach(x => x.setAttribute("aria-pressed", x === b)); return; }
    const act = b.dataset.act;
    if (act === "cancel") close();
    else if (act === "add-meet") f.querySelector(".sc-meets").insertAdjacentHTML("beforeend", meetingEditor({ id: uid(), days: "", start: "", end: "", room: "", kind: "lab" }));
    else if (act === "rm-meet") b.closest(".sc-meet").remove();
    else if (act === "del") { close(); await store.remove(COURSES, c.id); ctx0.toast(`Deleted ${c.code}`); render(); }
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const meetings = [...f.querySelectorAll(".sc-meet")].map(el => ({
      id: el.dataset.mid,
      kind: el.querySelector('[data-k="kind"]').value,
      room: el.querySelector('[data-k="room"]').value.trim(),
      start: el.querySelector('[data-k="start"]').value,
      end: el.querySelector('[data-k="end"]').value,
      days: [...el.querySelectorAll("[data-day]")].filter(x => x.getAttribute("aria-pressed") === "true").map(x => x.dataset.day).join(""),
    }));
    const bad = meetings.find(m => !m.days || !m.start || !m.end || toMin(m.start) >= toMin(m.end));
    if (bad) { f.querySelector("#sc-err").textContent = "Each meeting needs at least one day, and a start time before its end time."; return; }
    const code = f.code.value.trim().replace(/^([a-z]{2,5})\s*(\d)/i, (_, a, b) => `${a.toUpperCase()} ${b}`);
    const data = { code, name: f.name.value.trim(), color: f.color.value, meetings };
    await store.put(COURSES, isNew ? "c-" + uid() : c.id, data);
    close(); render();
  };
  setTimeout(() => (isNew ? f.code : f.name).focus(), 50);
}

/* ---------- semester sheet ---------- */
function breakRow(b) {
  return `<div class="sc-break" data-bid="${b.id}"><input class="field" data-k="label" value="${esc(b.label)}" placeholder="Spring break" aria-label="Break name">
    <input class="field" type="date" data-k="from" value="${dateInput(b.from)}" aria-label="First day off"><input class="field" type="date" data-k="to" value="${dateInput(b.to)}" aria-label="Last day off">
    <button type="button" class="icon-btn" data-act="rm-break" aria-label="Remove break">${svg("x")}</button></div>`;
}
function openSemester(sem) {
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet" role="dialog" aria-modal="true" aria-label="Semester dates">
    <h2>Semester dates</h2>
    <p class="note">On days outside the semester or during a break, the widget and reminders know there's no class.</p>
    <div class="two">
      <label>First day of classes<input class="field" type="date" name="start" value="${dateInput(sem.start)}"></label>
      <label>Last day of classes<input class="field" type="date" name="end" value="${dateInput(sem.end)}"></label>
    </div>
    <label>Breaks and days off</label>
    <div class="sc-breaks">${(sem.breaks || []).map(breakRow).join("")}</div>
    <button type="button" class="link-btn" data-act="add-break" style="align-self:flex-start">+ Add a break</button>
    <div class="acts"><span></span><span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">Save</button></span></div>
  </form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  f.addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    if (b.dataset.act === "cancel") close();
    else if (b.dataset.act === "add-break") f.querySelector(".sc-breaks").insertAdjacentHTML("beforeend", breakRow({ id: uid(), label: "", from: null, to: null }));
    else if (b.dataset.act === "rm-break") b.closest(".sc-break").remove();
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const breaks = [...f.querySelectorAll(".sc-break")].map(el => {
      const from = fromDateInput(el.querySelector('[data-k="from"]').value);
      return { id: el.dataset.bid, label: el.querySelector('[data-k="label"]').value.trim() || "Break", from, to: fromDateInput(el.querySelector('[data-k="to"]').value) || from };
    }).filter(b => b.from);
    await store.put(APP, "semester", { start: fromDateInput(f.start.value), end: fromDateInput(f.end.value), breaks });
    close(); render();
  };
}

/* ---------- app interface ---------- */
let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./schedule.css", import.meta.url).href;
  document.head.appendChild(link);
}

let timer = null;
async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = `
    <div class="ap-bar">
      <button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button>
      <span class="ap-title">Schedule</span><span class="ap-spacer"></span>
      <div class="ap-tabs" role="group" aria-label="View"><button data-tab="today">Today</button><button data-tab="week">Week</button></div>
      <button class="icon-btn" id="sc-new" aria-label="New course">${svg("plus")}</button>
    </div>
    <div class="ap-scroll"><div class="ap-body wide">
      <form class="ap-input" id="sc-add" autocomplete="off" style="flex-direction:column;align-items:stretch">
        <div style="display:flex;gap:8px;align-items:center">${svg("plus")}<input id="sc-add-in" placeholder="Add a class… “CS 18000 MWF 9:30-10:20 LWSN B151”" aria-label="Add a class"><button class="pill-btn" type="submit">Add</button></div>
        <div class="sc-prev" id="sc-prev"></div>
      </form>
      <div id="sc-main"></div>
      <div class="sc-cols"><div id="sc-courses"></div><div id="sc-sem"></div></div>
    </div></div>`;
  const input = $("#sc-add-in");
  input.addEventListener("input", () => { $("#sc-prev").innerHTML = preview(input.value); });
  $("#sc-add").onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await addFromLine(input.value);
      input.value = ""; $("#sc-prev").innerHTML = "";
      ctx0.toast(r.joined ? `Added a ${KINDS[r.meeting.kind].toLowerCase()} to ${r.course.code}` : `Added ${r.course.code}`);
      render();
    } catch (err) { ctx0.toast(err.message); }
  };
  el.querySelector(".ap-tabs").addEventListener("click", e => {
    const b = e.target.closest("[data-tab]"); if (!b) return;
    tab = b.dataset.tab; try { localStorage.setItem("sc-tab", tab); } catch (e2) { /* ignore */ }
    render();
  });
  $("#sc-new").onclick = () => openCourse(null);
  el.addEventListener("click", async e => {
    const b = e.target.closest("[data-course]"); if (!b) return;
    const c = (await loadCourses()).find(x => x.id === b.dataset.course);
    if (c) openCourse(c);
  });
  store.onChange(ch => { if ((ch.app === COURSES || ch.app === APP) && ctx0.isActive()) render(); });
  await render();
}
function show() { render(); clearInterval(timer); timer = setInterval(() => { if (ctx0.isActive()) render(); }, 60000); }
function hide() { clearInterval(timer); }

/** Home widget: what's on now, what's next. */
async function widget(el) {
  loadCss();
  const t = Date.now(), st = await status(t);
  const k = `<div class="w-k">${svg("calendar")}Classes</div>`;
  if (!st.courses.length) { el.innerHTML = `${k}<div class="w-dl-empty">Add your classes to see what's next.</div>`; return; }
  const line = (label, x, sub) => `<div class="w-sc"><span class="w-sc-k">${label}</span><b style="--c:${colorOf(x.course)}">${esc(x.course.code)}</b><span>${sub}</span></div>`;
  let body = "";
  if (st.now) {
    const pct = Math.round((t - st.now.start) / (st.now.end - st.now.start) * 100);
    body += line("Now", st.now, `${esc(KINDS[st.now.meeting.kind] || "Class")} · ends in ${inTime(st.now.end - t)}`) + `<div class="ap-bar-meter" style="height:6px"><i style="width:${pct}%;background:${colorOf(st.now.course)}"></i></div>`;
  }
  if (st.next) body += line(st.now ? "Next" : "Next · in " + inTime(st.next.start - t), st.next, `${fmtTime(st.next.meeting.start)}${st.next.meeting.room ? " · " + esc(st.next.meeting.room) : ""}`);
  if (!st.now && !st.next) {
    const nd = st.nextDay;
    body += `<div class="w-big">${st.off.off ? esc(st.off.label) : st.today.length ? "Done for today" : "No class today"}</div>`;
    if (nd) body += line(nd.inDays === 1 ? "Tomorrow" : new Date(nd.start).toLocaleDateString(undefined, { weekday: "long" }), nd, `${fmtTime(nd.meeting.start)}${nd.meeting.room ? " · " + esc(nd.meeting.room) : ""}`);
  } else if (!st.next && st.now) body += `<div class="w-sc"><span class="w-sc-k">Then</span><span>Done for today</span></div>`;
  el.innerHTML = k + `<div class="w-sc-list">${body}</div>`;
}

export default { id: APP, name: "Schedule", icon: "calendar", tint: "blue", mount, show, hide, widget };
