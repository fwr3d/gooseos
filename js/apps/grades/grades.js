// Grades: type in each score as it comes back. Shows your current grade in
// every class and the average you need on what's left for an A, B or C.
//
// Classes come from Schedule (app "courses"). Grading weights live on the
// course as weights: [{ label, pct }]. The Syllabus Scanner puts them there;
// you can also type them in here. A class with no weights is graded on total points.
//
// Saved items:
//   app "grades", id "k-…": a class added here instead of in Schedule { code, name?, weights? }
//   app "grades", id "s-<courseId>": { cutoffs: { A, B, C, D } }   (percent; default 90/80/70/60)
//   app "grades", id "g-…": one graded item { course (course id), cat (weight label), title,
//                                             score (number, or null = still to come), outOf, at (ms the score was typed) }
//
// The math: each category's average is points earned / points possible. Your
// current grade is the weighted average of the categories that have a score.
// For "what do I need", every item still to come (and every category with
// nothing added yet) is assumed to get the same average x, and we solve for x.
import * as store from "../../store.js";
import { svg } from "../../icons.js";

const APP = "grades", D = 864e5;
const LETTERS = ["A", "B", "C", "D"];
const DEFAULT_CUTOFFS = { A: 90, B: 80, C: 70, D: 60 };
const POINTS = "Points";   // the one bucket when a class has no weights

const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const num = v => { const n = parseFloat(String(v ?? "").replace(/[%\s,]/g, "")); return isFinite(n) ? n : NaN; };
const pct = (x, d = 1) => `${(Math.round(x * 10 ** d) / 10 ** d).toFixed(d).replace(/\.0+$/, "")}%`;
const pts = n => String(Math.round(n * 100) / 100);
const md = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const an = L => `${L === "A" || L === "F" ? "an" : "a"} ${L}`;
const same = (a, b) => String(a || "").trim().toLowerCase() === String(b || "").trim().toLowerCase();

/* ---------- data ---------- */
async function scheduleCourses() {
  try { const m = await import("../schedule/schedule.js"); return (await m.loadCourses()).map(c => ({ ...c, own: false })); }
  catch (e) { return []; }
}
async function loadAll() {
  const [sched, rows] = await Promise.all([scheduleCourses(), store.list(APP)]);
  const own = [], items = [], settings = {};
  for (const r of rows) {
    if (!r.data) continue;
    if (r.id.startsWith("k-") && r.data.code) own.push({ id: r.id, ...r.data, own: true });
    else if (r.id.startsWith("s-")) settings[r.id.slice(2)] = r.data;
    else if (r.id.startsWith("g-") && r.data.course) items.push({ id: r.id, ...r.data });
  }
  const courses = [...sched, ...own].sort((a, b) => a.code.localeCompare(b.code));
  return { courses, items, settings };
}
const cutoffsOf = (settings, id) => ({ ...DEFAULT_CUTOFFS, ...((settings[id] && settings[id].cutoffs) || {}) });
const weightsOf = c => (c.weights || []).filter(w => w && w.label && +w.pct > 0);

function letterOf(p, cut) {
  for (const L of LETTERS) if (p >= cut[L] - 1e-9) return L;
  return "F";
}
const rank = L => L === "F" ? 4 : LETTERS.indexOf(L);
const toneOf = L => L === "A" || L === "B" ? "good" : L === "C" ? "warn" : "bad";

/**
 * Everything about one class. `asOf` pretends scores typed after that moment
 * haven't come back yet (used for "dropped a letter this week").
 */
function grade(course, allItems, cut, asOf = Infinity) {
  const weights = weightsOf(course);
  const mine = allItems.filter(i => i.course === course.id);
  const graded = i => typeof i.score === "number" && isFinite(i.score) && (i.at || 0) <= asOf;
  const cats = (weights.length ? weights : [{ label: POINTS, pct: 100 }]).map(w => ({ label: w.label, w: +w.pct, items: [], earned: 0, possible: 0, toCome: 0, nGraded: 0, nToCome: 0 }));
  const loose = [];
  for (const i of mine) {
    const c = weights.length ? cats.find(c => same(c.label, i.cat)) : cats[0];
    if (!c) { loose.push(i); continue; }
    c.items.push(i);
    const out = +i.outOf > 0 ? +i.outOf : 0;
    if (graded(i)) { c.earned += i.score; c.possible += out; c.nGraded++; }
    else { c.toCome += out; c.nToCome++; }
  }
  const totalW = cats.reduce((n, c) => n + c.w, 0) || 1;
  // final = a + b * x, x = average on everything still to come
  let a = 0, b = 0, gW = 0, gSum = 0;
  for (const c of cats) {
    c.avg = c.possible > 0 ? c.earned / c.possible : null;
    const all = c.possible + c.toCome;
    if (all > 0) { a += c.w * c.earned / all; b += c.w * c.toCome / all; }
    else b += c.w;   // nothing added yet: all of it still to come
    if (c.avg !== null) { gW += c.w; gSum += c.w * c.avg; }
  }
  a /= totalW; b /= totalW;
  const current = gW > 0 ? gSum / gW * 100 : null;
  const need = {};
  for (const L of LETTERS) {
    const t = cut[L] / 100;
    if (b < 1e-9) need[L] = { kind: "done", final: a * 100 };
    else {
      const x = (t - a) / b;
      need[L] = x <= 0 ? { kind: "locked" } : x > 1 + 1e-9 ? { kind: "out", max: (a + b) * 100 } : { kind: "need", x: x * 100 };
    }
  }
  return {
    course, cats, loose, current, letter: current === null ? null : letterOf(current, cut),
    left: b * 100, counted: gW / totalW * 100, need, cut,
    nGraded: cats.reduce((n, c) => n + c.nGraded, 0), nToCome: cats.reduce((n, c) => n + c.nToCome, 0),
    weighted: weights.length > 0, weightSum: weights.reduce((n, w) => n + +w.pct, 0),
  };
}

/** Classes that dropped a letter in the last 7 days. */
async function drops(now = Date.now()) {
  const { courses, items, settings } = await loadAll();
  const out = [];
  for (const c of courses) {
    const cut = cutoffsOf(settings, c.id), g = grade(c, items, cut), was = grade(c, items, cut, now - 7 * D);
    if (g.letter && was.letter && rank(g.letter) > rank(was.letter)) out.push({ g, was });
  }
  return out;
}

async function putItem(id, data) { await store.put(APP, id, data); }
async function saveWeights(course, weights) {
  if (course.own) { const raw = (await store.get(APP, course.id)) || { code: course.code }; await store.put(APP, course.id, { ...raw, weights }); return; }
  const raw = await store.get("courses", course.id);
  if (raw) await store.put("courses", course.id, { ...raw, weights });
}

/* ---------- view ---------- */
let ctx0, root, openId = null, target = "A";
const $ = s => root.querySelector(s);
function setRoute() { history.replaceState(null, "", `${location.pathname}${location.search}#grades${openId ? "/" + encodeURIComponent(openId) : ""}`); }

function undoToast(msg, undo) {
  ctx0.toast(msg, { label: "Undo", run: async () => { const t = document.querySelector(".toast"); if (t) t.hidden = true; await undo(); render(); } });
}

async function render() {
  const data = await loadAll();
  const course = openId && data.courses.find(c => c.id === openId);
  if (openId && !course) openId = null;
  $("#gr-title").textContent = course ? course.code : "Grades";
  $("#gr-back").hidden = !course;
  $("#gr-home").hidden = !!course;
  $("#gr-set").hidden = !course;
  if (course) renderCourse(course, data); else renderList(data);
}

function needLine(n, L) {
  if (!n) return "";
  if (n.kind === "done") return `Final: ${pct(n.final)}`;
  if (n.kind === "locked") return `${L} is locked in`;
  if (n.kind === "out") return `${L} is out of reach`;
  return `${pct(n.x, 0)} avg for ${an(L)}`;
}
/** The best letter still in reach, and what it takes. */
function bestReach(g) {
  for (const L of LETTERS) { const n = g.need[L]; if (n.kind === "locked" || n.kind === "need") return { L, n }; }
  return null;
}

function renderList({ courses, items, settings }) {
  if (!courses.length) {
    $("#gr-body").innerHTML = `
      <div class="ap-card pad gr-intro">
        <span class="gr-ic">${svg("calculator")}</span>
        <h2>Know where you stand</h2>
        <p class="gr-note">Add each score as it comes back. Grades shows your grade in every class and what you need on the rest.</p>
        <a class="pill-btn" href="#schedule">Add classes in Schedule</a>
        <p class="gr-note">Scan a syllabus too, and its grading weights fill in here by themselves.</p>
      </div>
      ${addClassForm()}`;
    wireAddClass();
    return;
  }
  const gs = courses.map(c => grade(c, items, cutoffsOf(settings, c.id)));
  $("#gr-body").innerHTML = `
    <div class="gr-list">${gs.map(g => {
      const best = g.current !== null ? bestReach(g) : null;
      const sub = g.current === null ? (g.nToCome ? `${g.nToCome} still to come · no scores yet` : "No scores yet")
        : [`${g.nGraded} graded`, g.nToCome ? `${g.nToCome} to come` : "", g.left > 0.05 ? (best ? needLine(best.n, best.L) : "") : "all graded"].filter(Boolean).join(" · ");
      return `<button class="ap-card gr-class" data-class="${esc(g.course.id)}">
        <span class="gr-class-top"><span class="grow"><span class="t">${esc(g.course.code)}</span>${g.course.name ? `<span class="s">${esc(g.course.name)}</span>` : ""}</span>
          ${g.current === null ? `<span class="ap-pill">—</span>` : `<span class="gr-num">${pct(g.current)}</span><span class="gr-letter ${toneOf(g.letter)}">${g.letter}</span>`}</span>
        <span class="ap-bar-meter"><i style="width:${g.current === null ? 0 : Math.max(0, Math.min(100, g.current))}%;background:var(--${g.letter ? toneOf(g.letter) : "accent"})"></i></span>
        <span class="gr-sub">${esc(sub)}${g.weighted ? "" : " · points"}</span>
      </button>`;
    }).join("")}</div>
    ${addClassForm()}`;
  root.querySelectorAll("[data-class]").forEach(b => b.onclick = () => openCourse(b.dataset.class));
  wireAddClass();
}

const addClassForm = () => `<details class="gr-addclass"><summary>Class not in Schedule?</summary>
  <form class="ap-input" id="gr-newclass" autocomplete="off">${svg("plus")}<input id="gr-newcode" placeholder="Course code, like CS 25100" aria-label="Course code"><button class="pill-btn" type="submit">Add</button></form></details>`;
function wireAddClass() {
  const f = $("#gr-newclass"); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault();
    const code = $("#gr-newcode").value.trim(); if (!code) return $("#gr-newcode").focus();
    const id = "k-" + uid();
    await store.put(APP, id, { code });
    openCourse(id);
  };
}
function openCourse(id) { openId = id; setRoute(); root.querySelector(".ap-scroll").scrollTop = 0; render(); }

function needBig(n, L, g) {
  if (n.kind === "done") return `<div class="gr-need-v">${pct(n.final)}</div><p class="gr-note">Everything's graded. That's your final, ${an(letterOf(n.final, g.cut))}.</p>`;
  if (n.kind === "locked") return `<div class="gr-need-v good">Locked in</div><p class="gr-note">Even zeros on everything left keep ${an(L)}.</p>`;
  if (n.kind === "out") return `<div class="gr-need-v bad">Out of reach</div><p class="gr-note">100% on everything left gets you ${pct(n.max)}, ${an(letterOf(n.max, g.cut))}.</p>`;
  const tone = n.x > 95 ? "bad" : n.x > 85 ? "warn" : "";
  return `<div class="gr-need-v ${tone}">${pct(n.x, 1)}<span>average</span></div><p class="gr-note">on the ${pct(g.left, 0)} of the grade still to come.</p>`;
}

function renderCourse(course, { items, settings }) {
  const g = grade(course, items, cutoffsOf(settings, course.id));
  const n = g.need[target];
  const catOpts = g.cats.map(c => `<option value="${esc(c.label)}">${esc(c.label)}</option>`).join("");
  const itemRow = i => {
    const done = typeof i.score === "number";
    const p = done && +i.outOf > 0 ? i.score / i.outOf * 100 : null;
    return `<button class="ap-row gr-item ${done ? "" : "tocome"}" data-item="${esc(i.id)}">
      <span class="grow"><span class="t">${esc(i.title || "Untitled")}</span><span class="s">${done ? `Graded ${md(i.at || Date.now())}` : "Still to come"}</span></span>
      <span class="gr-score">${done ? `${pts(i.score)}<small>/${pts(i.outOf)}</small>` : `—<small>/${pts(i.outOf)}</small>`}</span>
      ${p !== null ? `<span class="ap-pill ${toneOf(letterOf(p, g.cut))}">${pct(p, 0)}</span>` : `<span class="ap-pill">to come</span>`}
    </button>`;
  };
  $("#gr-body").innerHTML = `
    <section class="ap-card pad gr-hero">
      <span class="gr-k">Current grade</span>
      ${g.current === null ? `<div class="gr-big muted">—</div><p class="gr-note">Add your first score below.</p>`
        : `<div class="gr-big"><span class="gr-letter big ${toneOf(g.letter)}">${g.letter}</span>${pct(g.current)}</div>
           <div class="ap-bar-meter"><i style="width:${Math.max(0, Math.min(100, g.current))}%;background:var(--${toneOf(g.letter)})"></i></div>
           <p class="gr-note">From ${g.nGraded} score${g.nGraded === 1 ? "" : "s"}, covering ${pct(g.counted, 0)} of the grade.</p>`}
    </section>

    ${n.kind === "done" ? (g.nGraded ? `<section class="ap-card pad gr-need"><span class="gr-k">Final grade</span>${needBig(n, target, g)}
      <p class="gr-others">Add something that's still to come (leave the score empty) to see what you need on it.</p></section>` : "")
    : `<section class="ap-card pad gr-need">
      <div class="gr-need-head"><span class="gr-k">What do I need?</span>
        <div class="ap-tabs" role="group" aria-label="Target grade">${["A", "B", "C"].map(L => `<button data-target="${L}" aria-pressed="${target === L}">${L}</button>`).join("")}</div></div>
      ${needBig(n, target, g)}
      <p class="gr-others">${["A", "B", "C"].filter(L => L !== target).map(L => needLine(g.need[L], L)).join(" · ")}</p>
    </section>`}

    <form class="ap-card pad gr-add" id="gr-add" autocomplete="off">
      <span class="gr-k">Add a score</span>
      <input class="field" name="title" placeholder="What was it? (Quiz 3)" aria-label="Name" required>
      <div class="gr-add-row ${g.weighted ? "cats" : ""}">
        <input class="field" name="score" inputmode="decimal" placeholder="Score" aria-label="Score (leave empty if not graded yet)">
        <span class="gr-slash">/</span>
        <input class="field" name="outOf" inputmode="decimal" placeholder="Out of" aria-label="Out of" required>
        ${g.weighted ? `<select class="field" name="cat" aria-label="Category">${catOpts}</select>` : ""}
        <button class="pill-btn" type="submit">Add</button>
      </div>
      <span class="gr-note">Leave the score empty for something that's still to come.</span>
    </form>

    ${g.cats.map(c => `<section class="ap-sec"><h3>${esc(c.label)}${g.weighted ? `<span class="n">${pts(c.w)}%</span>` : ""}<span class="gr-h-avg">${c.avg !== null ? pct(c.avg * 100) : c.items.length ? "" : "nothing added"}</span></h3>
      ${c.items.length ? `<div class="ap-card">${c.items.sort((a, b) => (typeof a.score === "number") - (typeof b.score === "number") || (b.at || 0) - (a.at || 0)).map(itemRow).join("")}</div>`
        : g.weighted ? `<p class="gr-hint">Counts as still to come until you add something.</p>` : ""}
    </section>`).join("")}
    ${g.loose.length ? `<section class="ap-sec bad"><h3>No category<span class="n">${g.loose.length}</span></h3><div class="ap-card">${g.loose.map(itemRow).join("")}</div>
      <p class="gr-hint">These don't count. Tap one to pick a category.</p></section>` : ""}

    <section class="ap-card pad gr-weights">
      ${g.weighted ? `<span class="gr-k">Grading weights</span>
        <div class="gr-wlist">${g.cats.map(c => `<span class="chip">${esc(c.label)} ${pts(c.w)}%</span>`).join("")}</div>
        ${Math.abs(g.weightSum - 100) > 0.01 ? `<span class="gr-note warn">These add up to ${pts(g.weightSum)}%, so each is scaled to fit.</span>` : ""}`
      : `<span class="gr-k">No grading weights yet</span><span class="gr-note">Grading on total points for now. Scan the syllabus, or type the weights in.</span>`}
      <div class="gr-wacts"><button type="button" class="pill-btn secondary" id="gr-editw">${g.weighted ? "Edit weights" : "Add weights"}</button>${g.weighted ? "" : `<a class="pill-btn secondary" href="#syllabus">Scan syllabus</a>`}</div>
    </section>`;

  root.querySelectorAll("[data-target]").forEach(b => b.onclick = () => { target = b.dataset.target; render(); });
  const f = $("#gr-add");
  f.onsubmit = async e => {
    e.preventDefault();
    const title = f.title.value.trim(), outOf = num(f.outOf.value), raw = f.score.value.trim(), score = raw === "" ? null : num(raw);
    if (!title) return f.title.focus();
    if (!(outOf > 0)) { f.outOf.focus(); ctx0.toast("Out of needs a number, like 20"); return; }
    if (raw !== "" && !(score >= 0)) { f.score.focus(); ctx0.toast("Score needs a number"); return; }
    const id = "g-" + Date.now().toString(36) + uid();
    const cat = g.weighted ? f.cat.value : POINTS;
    await putItem(id, { course: course.id, cat, title, score, outOf, at: score === null ? null : Date.now() });
    await render();
    const nf = $("#gr-add"); if (nf.cat) nf.cat.value = cat; nf.title.focus();
    undoToast(`Added ${title}${score === null ? " (still to come)" : ` · ${pts(score)}/${pts(outOf)}`}`, () => store.remove(APP, id));
  };
  root.querySelectorAll("[data-item]").forEach(b => b.onclick = () => {
    const it = items.find(i => i.id === b.dataset.item); if (it) editItem(it, g);
  });
  $("#gr-editw").onclick = () => editWeights(course, g, settings);
}

function sheet(html) {
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet gr-sheet" role="dialog" aria-modal="true" autocomplete="off">${html}</form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  const c = f.querySelector('[data-act="cancel"]'); if (c) c.onclick = close;
  return { f, close };
}

function editItem(it, g) {
  const opts = g.cats.map(c => `<option value="${esc(c.label)}" ${same(c.label, it.cat) ? "selected" : ""}>${esc(c.label)}</option>`).join("");
  const { f, close } = sheet(`<h2>Edit score</h2>
    <label>Name<input class="field" name="title" value="${esc(it.title)}" required></label>
    <div class="two"><label>Score<input class="field" name="score" inputmode="decimal" value="${typeof it.score === "number" ? pts(it.score) : ""}" placeholder="Not graded yet"></label>
      <label>Out of<input class="field" name="outOf" inputmode="decimal" value="${pts(it.outOf)}" required></label></div>
    ${g.weighted ? `<label>Category<select class="field" name="cat">${g.cats.some(c => same(c.label, it.cat)) ? "" : `<option value="" selected>Pick one</option>`}${opts}</select></label>` : ""}
    <div class="acts"><button type="button" class="pill-btn danger" data-act="del">Delete</button>
      <span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">Save</button></span></div>`);
  f.querySelector('[data-act="del"]').onclick = async () => {
    close(); await store.remove(APP, it.id); await render();
    const { id, ...data } = it;
    undoToast(`Deleted ${it.title}`, () => store.put(APP, id, data));
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const outOf = num(f.outOf.value), raw = f.score.value.trim(), score = raw === "" ? null : num(raw);
    if (!(outOf > 0)) return f.outOf.focus();
    if (raw !== "" && !(score >= 0)) return f.score.focus();
    if (f.cat && !f.cat.value) return f.cat.focus();
    const changed = score !== it.score;
    const { id, ...data } = it;
    await putItem(id, { ...data, title: f.title.value.trim() || it.title, outOf, score, cat: f.cat ? f.cat.value : it.cat,
      at: score === null ? null : changed || !it.at ? Date.now() : it.at });
    close(); render();
  };
}

function editWeights(course, g, settings) {
  const ws = weightsOf(course).map(w => ({ label: w.label, pct: +w.pct }));
  const cut = cutoffsOf(settings, course.id);
  const row = (w = { label: "", pct: "" }) => `<div class="gr-wrow"><input class="field" data-w="label" value="${esc(w.label)}" placeholder="Exams" aria-label="Category">
    <input class="field" data-w="pct" inputmode="decimal" value="${w.pct === "" ? "" : pts(w.pct)}" placeholder="40" aria-label="Percent"><span>%</span>
    <button type="button" class="icon-btn" data-w="rm" aria-label="Remove">${svg("x")}</button></div>`;
  const { f, close } = sheet(`<h2>${esc(course.code)} grading</h2>
    <span class="note">${course.own ? "" : "Saved on the class, same place the Syllabus Scanner puts them. "}Leave empty to grade on total points.</span>
    <div class="gr-wrows">${(ws.length ? ws : [{ label: "", pct: "" }]).map(row).join("")}</div>
    <div class="gr-wfoot"><button type="button" class="link-btn" data-act="addw">+ Add category</button><span class="note" id="gr-wsum"></span></div>
    <label>Letter cutoffs (lowest percent for each)</label>
    <div class="gr-cuts">${LETTERS.map(L => `<label>${L}<input class="field" name="cut${L}" inputmode="decimal" value="${pts(cut[L])}"></label>`).join("")}</div>
    <div class="acts">${course.own ? `<button type="button" class="pill-btn danger" data-act="delclass">Delete class</button>` : "<span></span>"}
      <span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">Save</button></span></div>`);
  const rows = () => [...f.querySelectorAll(".gr-wrow")];
  const sum = () => { const s = rows().reduce((n, r) => n + (num(r.querySelector('[data-w="pct"]').value) || 0), 0); f.querySelector("#gr-wsum").textContent = s ? `Total ${pts(s)}%` : ""; };
  const wire = () => rows().forEach(r => {
    r.querySelector('[data-w="rm"]').onclick = () => { r.remove(); if (!rows().length) { f.querySelector(".gr-wrows").insertAdjacentHTML("beforeend", row()); wire(); } sum(); };
    r.querySelector('[data-w="pct"]').oninput = sum;
  });
  wire(); sum();
  f.querySelector('[data-act="addw"]').onclick = () => { f.querySelector(".gr-wrows").insertAdjacentHTML("beforeend", row()); wire(); rows().at(-1).querySelector("input").focus(); };
  const del = f.querySelector('[data-act="delclass"]');
  if (del) del.onclick = async () => {
    if (!confirm(`Delete ${course.code} and its scores?`)) return;
    close();
    const { items } = await loadAll();
    for (const i of items.filter(i => i.course === course.id)) await store.remove(APP, i.id);
    await store.remove(APP, course.id); await store.remove(APP, "s-" + course.id);
    openId = null; setRoute(); render(); ctx0.toast(`Deleted ${course.code}`);
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const next = [];
    for (const r of rows()) {
      const label = r.querySelector('[data-w="label"]').value.trim(), p = num(r.querySelector('[data-w="pct"]').value);
      if (!label && !r.querySelector('[data-w="pct"]').value.trim()) continue;
      if (!label) return r.querySelector('[data-w="label"]').focus();
      if (!(p > 0 && p <= 100)) return r.querySelector('[data-w="pct"]').focus();
      if (next.some(w => same(w.label, label))) { ctx0.toast(`"${label}" is in there twice`); return; }
      next.push({ label, pct: p });
    }
    const cuts = {};
    for (const L of LETTERS) { const v = num(f["cut" + L].value); if (!(v >= 0 && v <= 100)) return f["cut" + L].focus(); cuts[L] = v; }
    if (!(cuts.A > cuts.B && cuts.B > cuts.C && cuts.C > cuts.D)) { ctx0.toast("Cutoffs should go down from A to D"); return; }
    await saveWeights(course, next);
    // scores typed while grading on points keep working: move them into the only category
    if (next.length === 1) {
      const { items } = await loadAll();
      for (const i of items.filter(i => i.course === course.id && same(i.cat, POINTS))) { const { id, ...d } = i; await store.put(APP, id, { ...d, cat: next[0].label }); }
    }
    const same4 = LETTERS.every(L => cuts[L] === DEFAULT_CUTOFFS[L]);
    if (same4) { if (settings[course.id]) await store.remove(APP, "s-" + course.id); }
    else await store.put(APP, "s-" + course.id, { cutoffs: cuts });
    close(); render(); ctx0.toast("Saved");
  };
}

/* ---------- for the rest of GooseOS ---------- */
/** Today's At a glance: only when a class dropped a letter this week. */
async function summary() {
  const d = await drops(); if (!d.length) return null;
  const worst = d.sort((a, b) => a.g.current - b.g.current)[0];
  const tone = worst.g.letter === "A" || worst.g.letter === "B" ? "warn" : "bad";
  return d.length === 1
    ? { label: "Grades", value: `${worst.g.course.code} down to ${worst.g.letter}`, sub: `Was ${an(worst.was.letter)} a week ago · ${pct(worst.g.current)} now`,
        pct: Math.max(0, Math.min(100, Math.round(worst.g.current))), tone, open: `#grades/${encodeURIComponent(worst.g.course.id)}` }
    : { label: "Grades", value: `${d.length} classes dropped a letter`, sub: d.map(x => `${x.g.course.code} ${x.was.letter}→${x.g.letter}`).join(" · "), tone, open: "#grades" };
}

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./grades.css", import.meta.url).href;
  document.head.appendChild(link);
}
async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = `<div class="ap-bar"><button class="ap-home" id="gr-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button>
    <button class="ap-home" id="gr-back" aria-label="All classes" hidden>${svg("chevronLeft")}Classes</button>
    <span class="ap-title" id="gr-title">Grades</span><span class="ap-spacer"></span>
    <button class="icon-btn" id="gr-set" aria-label="Grading weights" hidden>${svg("settings")}</button></div>
    <div class="ap-scroll"><div class="ap-body" id="gr-body"></div></div>`;
  $("#gr-back").onclick = () => { openId = null; setRoute(); render(); };
  $("#gr-set").onclick = () => { const b = $("#gr-editw"); if (b) b.click(); };
  store.onChange(ch => { if ((ch.app === APP || ch.app === "courses") && ch.source === "remote" && ctx.isActive()) render(); });
}
async function show(arg) {
  openId = arg ? decodeURIComponent(arg) : null;
  await render();
}

// exported for tests
export { grade, letterOf, drops, DEFAULT_CUTOFFS };
export default { id: APP, name: "Grades", icon: "calculator", tint: "violet", mount, show, summary };
