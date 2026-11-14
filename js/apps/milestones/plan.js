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

/** Steps for a template. Exam uses `topics`; Custom uses `lines`. */
export function templateSteps(template, { topics = [], lines = [] } = {}) {
  if (template === "exam") {
    const ts = topics.map(t => t.trim()).filter(Boolean);
    const k = ts.length;
    const reviews = ts.map((t, i) => ({ title: `Review: ${t}`, at: k === 1 ? 0.4 : (i / (k - 1)) * 0.65, estMin: 60 }));
    return [...reviews, { title: "Full review", at: 1, estMin: 120, dayBefore: true }];
  }
  if (template === "custom") {
    const ls = lines.map(l => l.trim()).filter(Boolean);
    return ls.map((t, i) => ({ title: t, at: ls.length === 1 ? 0.8 : 0.05 + (i / (ls.length - 1)) * 0.9, estMin: 45 }));
  }
  return (TEMPLATES[template] || TEMPLATES.project).steps.map(s => ({ ...s }));
}

/** Build a full plan. "Full review" for exams lands on the day before the exam. */
export function buildPlan(template, from, due, blocked = DEFAULT_BLOCKED, opts = {}) {
  const raw = templateSteps(template, opts);
  if (template === "exam") {
    // spread topic reviews right up to the day before the full review, however long the runway is
    const days = availableDays(from, due, blocked), n = days.length;
    const fullDay = startOfDay(due - 864e5);
    let f = days.findIndex(d => +d >= +fullDay); if (f < 0) f = n - 1;
    const top = n > 1 ? Math.max(0, f - 1) / (n - 1) : 0;
    const topics = raw.filter(s => !s.dayBefore), k = topics.length;
    topics.forEach((s, i) => { s.at = k === 1 ? top / 2 : (i / (k - 1)) * top; });
  }
  const placed = placeSteps(raw, from, due, blocked);
  return placed.map((s, i) => {
    let date = s.date;
    if (s.dayBefore) {
      const d = new Date(due); d.setDate(d.getDate() - 1); d.setHours(STEP_HOUR, 0, 0, 0);
      date = +d > from ? +d : Math.min(from + 30 * 60e3, due);
    }
    return { id: "s" + (i + 1) + Math.random().toString(36).slice(2, 6), title: s.title, date, estMin: s.estMin || 45, done: false };
  });
}

/** Re-plan: spread unfinished steps evenly from today to the due date, in order. Finished steps stay put. */
export function replan(steps, now, due, blocked = DEFAULT_BLOCKED) {
  const open = steps.filter(s => !s.done);
  if (!open.length) return steps;
  const from = Math.min(now, due);
  const k = open.length;
  const spaced = placeSteps(open.map((s, i) => ({ ...s, at: k === 1 ? 0.5 : i / (k - 1) * 0.9 })), from, due, blocked);
  const byId = new Map(spaced.map(s => [s.id, s.date]));
  return steps.map(s => (s.done ? s : { ...s, date: byId.get(s.id) }));
}
