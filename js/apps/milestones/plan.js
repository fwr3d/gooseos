// Milestones planning: turn a template + due date into dated steps, and re-plan
// unfinished steps. Rules:
//   - Steps sit at a share of the time left (a template's `at`, 0..1).
//   - Blocked days (default Fri + Sat) are skipped when there are other days to use.
//   - A step's time is 8 PM on its day, or earlier on the due day, and never after the due time.

export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const DEFAULT_BLOCKED = [5, 6]; // Fri, Sat
const STEP_HOUR = 20;

export const TEMPLATES = {
  project: { label: "CS project", steps: [
    { title: "Read the spec and set up the repo", at: 0.05, estMin: 45 },
    { title: "Get the first test passing", at: 0.25, estMin: 60 },
    { title: "Core features working", at: 0.55, estMin: 120 },
    { title: "Edge cases and tests", at: 0.8, estMin: 90 },
    { title: "Submit early", at: 0.95, estMin: 30 },
  ] },
  paper: { label: "Paper", steps: [
    { title: "Pick the topic", at: 0.05, estMin: 30 },
    { title: "Find sources", at: 0.2, estMin: 60 },
    { title: "Outline", at: 0.35, estMin: 45 },
    { title: "Full draft", at: 0.6, estMin: 120 },
    { title: "Revise", at: 0.85, estMin: 60 },
    { title: "Citations and submit", at: 0.95, estMin: 30 },
  ] },
  exam: { label: "Exam", steps: [] },        // built from the topics you list
  presentation: { label: "Presentation", steps: [
    { title: "Outline", at: 0.15, estMin: 30 },
    { title: "Make the slides", at: 0.5, estMin: 90 },
    { title: "Practice run 1", at: 0.75, estMin: 30 },
    { title: "Practice run 2", at: 0.92, estMin: 30 },
  ] },
  application: { label: "Application", steps: [
    { title: "Tweak the resume", at: 0.1, estMin: 45 },
    { title: "Apply", at: 0.3, estMin: 30 },
    { title: "Online assessment", at: 0.6, estMin: 90 },
    { title: "Follow up", at: 0.95, estMin: 15 },
  ] },
  custom: { label: "Custom", steps: [] },   // your own steps, spaced evenly
};

const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };

/** Days a step can land on, from `from` up to the due date, minus blocked days (unless that leaves nothing). */
export function availableDays(from, due, blocked = DEFAULT_BLOCKED) {
  const days = [];
  const first = startOfDay(from), last = startOfDay(due);
  // a step on the due day only makes sense if the due time leaves room (due at 9 AM → use the day before)
  const dueDate = new Date(due);
  const useDueDay = dueDate.getHours() >= 12;
  for (let d = new Date(first); d <= last; d.setDate(d.getDate() + 1)) {
    if (+d === +last && !useDueDay && +first !== +last) continue;
    days.push(new Date(d));
  }
  const open = days.filter(d => !blocked.includes(d.getDay()));
  return open.length ? open : days.length ? days : [startOfDay(from)];
}

/** Time for a step on a given day: 8 PM, pulled earlier if it would land after the due time. */
function stepTime(day, due, from) {
  const t = new Date(day); t.setHours(STEP_HOUR, 0, 0, 0);
  let ms = +t;
  if (ms > due - 60 * 60e3) ms = due - 60 * 60e3;   // at least an hour before it's due
  if (ms < from) ms = Math.min(from + 30 * 60e3, due); // never in the past
  return Math.min(ms, due);
}

/** Place steps (each with `at` 0..1) between `from` and `due`. Returns new step objects with `date`. */
export function placeSteps(steps, from, due, blocked = DEFAULT_BLOCKED) {
  const days = availableDays(from, due, blocked);
  const n = days.length;
  let prev = 0;
  return steps.map(s => {
    let idx = Math.round(Math.max(0, Math.min(1, s.at)) * (n - 1));
    idx = Math.max(idx, prev); prev = idx;          // keep the order
    return { ...s, date: stepTime(days[idx], due, from) };
  });
}

/* ---------- exams ----------
   Kept short and open: a few study sessions spread out, then a final review the
   night before. How you study in each one is up to you. Topics you list are split
   across at most 4 sessions, so a plan is never more than 5 steps.
   (Older saved plans may still have the longer kinds: gather, first, quiz, practice,
   mistakes, cheat, night, again. Those keep working.) */
const at8 = (day, h = STEP_HOUR) => { const t = new Date(day); t.setHours(h, 0, 0, 0); return +t; };
const MAX_SESSIONS = 4;

/** Exam steps with dates. opts: { topics: [] } */
export function examPlan(from, due, blocked = DEFAULT_BLOCKED, { topics = [] } = {}) {
  const ts = topics.map(t => t.trim()).filter(Boolean);
  const nightBefore = startOfDay(due - 864e5);
  // working days: everything before the night before (or just today if the exam is tomorrow).
  // With under 3 open days, skipped days (Fri/Sat) get used too: it's crunch time.
  const before = b => availableDays(from, due, b).filter(d => +d < +nightBefore);
  let days = before(blocked);
  if (days.length < 3) { const all = before([]); if (all.length > days.length) days = all; }
  if (!days.length) days = [startOfDay(from)];
  const n = days.length;
  const when = i => stepTime(days[Math.max(0, Math.min(n - 1, i))], due, from);
  const out = [];
  const add = (s, date) => out.push({ estMin: 45, ...s, date });

  // how many sessions: one per topic group, or by how much time there is
  const k = ts.length ? Math.min(ts.length, MAX_SESSIONS, n) : n >= 6 ? 3 : n >= 3 ? 2 : 1;
  const groups = Array.from({ length: k }, (_, i) => ts.slice(Math.round(i * ts.length / k), Math.round((i + 1) * ts.length / k)));
  // spread them out: first one soon, last one a day or so before the final review
  const at = i => k === 1 ? Math.floor((n - 1) / 2) : Math.round(i * (n - 1) / (k - 1));
  groups.forEach((g, i) => add({
    title: g.length ? `Study: ${g.join(", ")}` : k === 1 ? "Study" : `Study (${i + 1} of ${k})`,
    estMin: 60, kind: "study", ...(g.length === 1 ? { topic: g[0] } : {}),
  }, when(at(i))));
  // the night before (never in the past, never after the exam)
  const t = at8(nightBefore);
  add({ title: "Final review", estMin: 45, kind: "review" }, t > from ? Math.min(t, due - 3600e3) : Math.min(from + 30 * 60e3, due));
  return chainDays(out, from, due);
}

/** Steps that share a day become one study block: back to back, ending where the last one starts. */
function chainDays(steps, from, due) {
  const groups = new Map();
  steps.forEach((s, i) => { const k = +startOfDay(s.date); if (!groups.has(k)) groups.set(k, []); groups.get(k).push({ ...s, i }); });
  const out = [];
  for (const g of groups.values()) {
    for (let j = g.length - 2; j >= 0; j--) g[j].date = g[j + 1].date - (g[j].estMin || 45) * 60e3;
    const shift = Math.max(0, from + 30 * 60e3 - g[0].date);   // never in the past
    for (const s of g) out.push({ ...s, date: Math.min(s.date + shift, due - 3600e3) + s.i });   // + i keeps the order on ties
  }
  return out.sort((a, b) => a.date - b.date).map(({ i, ...s }) => s);
}

/** A "Shaky" quiz gets one more review: tomorrow evening, before the practice exam if there's room. */
export function shakyReviewDate(steps, now, due) {
  const practice = steps.find(s => s.kind === "practice" && !s.done && s.date > now);
  const tomorrow = at8(startOfDay(now + 864e5));
  let t = practice && practice.date - 864e5 > now ? Math.min(tomorrow, practice.date - 3600e3) : tomorrow;
  t = Math.min(t, due - 864e5 > now ? due - 864e5 : due - 3600e3);
  return Math.max(t, now + 30 * 60e3);
}

/* ---------- breaks ----------
   Breaks and days off come from Schedule's semester ({ label, from, to }). An open step on
   one moves to the nearest open day before the exam (earlier wins a tie), keeping its time,
   and skipped days (Fri/Sat) are only used when nothing else is close. Left alone: finished
   steps, steps you dated yourself (pinned), and the final review, which belongs to the night before. */
const addDays = (t, k) => { const d = new Date(t); d.setDate(d.getDate() + k); return +d; };
export function offBreaks(steps, now, due, breaks = [], blocked = DEFAULT_BLOCKED) {
  const off = new Map();
  for (const b of breaks || []) {
    if (!b || !b.from) continue;
    for (let d = +startOfDay(b.from), end = +startOfDay(b.to || b.from), n = 0; d <= end && n < 120; d = addDays(d, 1), n++) off.set(d, b.label || "Break");
  }
  if (!off.size) return { steps, moved: [] };
  const first = +startOfDay(now), dueDay = +startOfDay(due);
  const last = new Date(due).getHours() >= 12 ? dueDay : addDays(dueDay, -1);
  const free = (d, strict) => !off.has(d) && d >= first && d <= last && !(strict && blocked.includes(new Date(d).getDay()));
  const moved = [], dates = new Map(steps.map(s => [s.id, s.date]));
  const stays = s => s.done || s.pinned || s.kind === "review" || s.kind === "night" || !off.has(+startOfDay(s.date));
  const out = steps.map(s => {
    if (stays(s)) return s;
    const d0 = +startOfDay(s.date);
    let pick = null;
    for (const strict of [true, false]) {
      for (let k = 1; k <= 60 && pick === null; k++) for (const d of [addDays(d0, -k), addDays(d0, k)]) if (free(d, strict)) { pick = d; break; }
      if (pick !== null) break;
    }
    if (pick === null) return s;
    const t = new Date(s.date), nd = new Date(pick); nd.setHours(t.getHours(), t.getMinutes(), 0, 0);
    let ms = Math.min(+nd, due - 3600e3);
    // another step already at that time on that day: go right before it, the way study blocks chain
    const len = (s.estMin || 45) * 60e3;
    for (let n = 0; n < 8; n++) {
      const hit = steps.find(x => x.id !== s.id && !x.done && Math.abs(dates.get(x.id) - ms) < len && +startOfDay(dates.get(x.id)) === pick);
      if (!hit) break;
      ms = dates.get(hit.id) - len;
    }
    if (ms < now) ms = Math.min(now + 30 * 60e3, due);
    dates.set(s.id, ms);
    moved.push({ id: s.id, label: off.get(d0) });
    return { ...s, date: ms, offBreak: off.get(d0) };
  });
  return { steps: moved.length ? out : steps, moved };
}

/** Steps for a template. Custom uses `lines`; your own templates pass `steps` ({ title, at, estMin }).
 *  (Exams have their own builder above.) */
export function templateSteps(template, { lines = [], steps } = {}) {
  if (Array.isArray(steps)) return steps.map(s => ({ ...s })).sort((a, b) => a.at - b.at);
  if (template === "custom") {
    const ls = lines.map(l => l.trim()).filter(Boolean);
    return ls.map((t, i) => ({ title: t, at: ls.length === 1 ? 0.8 : 0.05 + (i / (ls.length - 1)) * 0.9, estMin: 45 }));
  }
  return (TEMPLATES[template] || TEMPLATES.project).steps.map(s => ({ ...s }));
}

/** Build a full plan. Steps may carry kind/topic (exams use them for Got it / Shaky). */
export function buildPlan(template, from, due, blocked = DEFAULT_BLOCKED, opts = {}) {
  const placed = template === "exam" ? examPlan(from, due, blocked, opts) : placeSteps(templateSteps(template, opts), from, due, blocked);
  return placed.map((s, i) => ({
    id: "s" + (i + 1) + Math.random().toString(36).slice(2, 6), title: s.title, date: s.date, estMin: s.estMin || 45, done: false,
    ...(s.kind ? { kind: s.kind } : {}), ...(s.topic ? { topic: s.topic } : {}),
  }));
}

/** Re-plan: spread unfinished steps evenly from today to the due date, in order. Finished steps stay put. */
// An exam's final review stays on the night before; the other open steps spread out before it.
export function replan(steps, now, due, blocked = DEFAULT_BLOCKED) {
  const order = [...steps].filter(s => !s.done).sort((a, b) => a.date - b.date);
  if (!order.length) return steps;
  const from = Math.min(now, due);
  const byId = new Map();
  const finals = order.filter(s => s.kind === "review" || s.kind === "night");
  let end = due;
  if (finals.length) {
    const t = at8(startOfDay(due - 864e5));
    end = t > from ? Math.min(t, due - 3600e3) : Math.min(from + 30 * 60e3, due);
    finals.forEach((s, i) => byId.set(s.id, end + i));
  }
  const open = order.filter(s => !finals.includes(s));
  const k = open.length;
  if (k) placeSteps(open.map((s, i) => ({ ...s, at: k === 1 ? 0.5 : i / (k - 1) * 0.9 })), from, end, blocked)
    .forEach(s => byId.set(s.id, s.date));
  // a re-planned step isn't one you dated yourself anymore
  return steps.map(s => { if (s.done) return s; const { pinned, offBreak, ...rest } = s; return { ...rest, date: byId.get(s.id) }; });
}
