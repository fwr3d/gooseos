// Finds dated items in syllabus text: exams, quizzes, projects, homework, labs,
// papers, presentations, and no-class days. Also picks up grading weights.
// Works offline with patterns and keywords; nothing leaves the device.
//
// scanSyllabus(text, { now, semesterStart, meetings }) →
//   { items: [{ type, title, due, timeKnown, line }], breaks: [{ label, from, to, line }], weights: [{ label, pct }] }

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const WEEKDAY_RE = "(?:mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|rsday|urday)?\\.?";
const WD_INDEX = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };

// order matters: first match wins
const TYPES = [
  ["break", /\b(no class(es)?|no lecture|class(es)? (are )?cancell?ed|holiday|recess|spring break|fall break|thanksgiving|winter break|reading day|labor day|memorial day|mlk day|martin luther king|no school)\b/i],
  ["exam", /\b(midterm|mid-term|final exam|final(?!\s+(project|paper|presentation|report|essay|demo))|exam\b|exam\s*\d|test\s*\d|test\b(?!ing|s? cases))/i],
  ["quiz", /\bquiz(zes)?\b/i],
  ["presentation", /\b(presentation|present|demo|poster)\b/i],
  ["project", /\b(project|proj\b|pa\s?\d+|programming assignment|milestone|capstone)\b/i],
  ["lab", /\blab\s*\d*\b/i],
  ["paper", /\b(paper|essay|report|reflection|write-?up)\b/i],
  ["homework", /\b(hw\s*\d*|homework|problem set|pset|assignment|worksheet|exercise)\b/i],
];
const DUE_WORD = /\b(due|deadline|submit|turn in|by)\b/i;
// mentions of graded things: one mention + two dates = one item ("PA1 released Jan 20, due Feb 3")
const ITEM_WORD = /\b(midterm|final|exam|test|quiz|project|pa\s?\d+|hw\s*\d*|homework|problem set|pset|lab\s*\d*|paper|essay|report|presentation|assignment)\b/gi;
const TENTATIVE = /\b(tba|tbd|to be (announced|determined))\b/i;
const IN_CLASS = /\b(in[- ]class|during class|in lecture)\b/i;

const pad = n => String(n).padStart(2, "0");

/** A date mention in a line → { start, end?, idx, len } (end is set for ranges like "Mar 16–20"). */
function findDates(line, ctx) {
  const out = [];
  let m;
  // "Mar 16" / "March 16th" / "Mar 16-20" / "Mar 30 - Apr 3"
  const reMonth = new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s*[-–]\\s*(?:${MONTH_RE}\\s+)?(\\d{1,2})(?:st|nd|rd|th)?)?\\b`, "gi");
  while ((m = reMonth.exec(line))) {
    const mon = MONTHS[m[1].slice(0, 3).toLowerCase()], day = +m[2];
    if (day < 1 || day > 31) continue;
    const start = withYear(mon, day, ctx);
    let end = null;
    if (m[4]) { const mon2 = m[3] ? MONTHS[m[3].slice(0, 3).toLowerCase()] : mon; end = withYear(mon2, +m[4], ctx); if (end < start) end = null; }
    out.push({ start, end, idx: m.index, len: m[0].length });
  }
  // "2/18", "2/18/27", "2/18-2/20"
  const reNum = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s*[-–]\s*(\d{1,2})\/(\d{1,2}))?\b/g;
  while ((m = reNum.exec(line))) {
    const mon = +m[1] - 1, day = +m[2];
    if (mon < 0 || mon > 11 || day < 1 || day > 31) continue;
    if (out.some(o => m.index >= o.idx && m.index < o.idx + o.len)) continue;
    let y = m[3] ? +m[3] : null; if (y && y < 100) y += 2000;
    const start = y ? +new Date(y, mon, day) : withYear(mon, day, ctx);
    let end = null;
    if (m[4]) { end = withYear(+m[4] - 1, +m[5], ctx); if (end < start) end = null; }
    out.push({ start, end, idx: m.index, len: m[0].length });
  }
  // "Week 7" (+ optional weekday) → counted from the semester start
  if (ctx.semesterStart && !out.length) {
    const reWeek = new RegExp(`\\bweek\\s*(\\d{1,2})(?:[,:\\s]+(${WEEKDAY_RE}))?`, "i");
    if ((m = line.match(reWeek))) {
      const n = +m[1];
      const s = new Date(ctx.semesterStart); s.setHours(0, 0, 0, 0);
      const monday = new Date(s); monday.setDate(s.getDate() - ((s.getDay() + 6) % 7)); // week 1's Monday
      const d = new Date(monday); d.setDate(monday.getDate() + (n - 1) * 7);
      if (m[2]) { const wd = WD_INDEX[m[2].slice(0, 3).toLowerCase()]; d.setDate(d.getDate() + ((wd + 6) % 7)); }
      else d.setDate(d.getDate() + 4); // no day given → that week's Friday
      out.push({ start: +d, end: null, idx: m.index, len: m[0].length, fromWeek: true });
    }
  }
  return out.sort((a, b) => a.idx - b.idx);
}

/** Pick the year: the semester's year, or for dates without one, the nearest that isn't long past. */
function withYear(mon, day, ctx) {
  const base = ctx.semesterStart ? new Date(ctx.semesterStart) : new Date(ctx.now);
  let y = base.getFullYear();
  let d = new Date(y, mon, day);
  if (ctx.semesterStart) { if (d < base - 45 * 864e5) d = new Date(y + 1, mon, day); }
  else if (d < ctx.now - 120 * 864e5) d = new Date(y + 1, mon, day);
  return +d;
}

/** "11:59 pm", "11:59PM", "9am", "noon", "midnight" → minutes after midnight. */
function findTime(line) {
  let m;
  if (/\bnoon\b/i.test(line)) return 12 * 60;
  if (/\bmidnight\b/i.test(line)) return 23 * 60 + 59;
  // a range like "6:30-7:30pm" or "6:30 - 7:30 PM": the start, using the end's am/pm
  if ((m = line.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)/i))) {
    const ap = m[3] || m[6];
    let h = +m[1] % 12; if (/p/i.test(ap) && !(m[3] == null && +m[1] > +m[4])) h += 12;
    return h * 60 + (m[2] ? +m[2] : 0);
  }
  if ((m = line.match(/\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)/i))) {
    let h = +m[1] % 12; if (/p/i.test(m[3])) h += 12;
    return h * 60 + (m[2] ? +m[2] : 0);
  }
  if ((m = line.match(/\b(\d{1,2}):(\d{2})\b/))) { let h = +m[1]; if (h >= 1 && h <= 7) h += 12; if (h === 11 && +m[2] === 59) h = 23; return h * 60 + +m[2]; }
  return null;
}

/** Class time for an exam on this weekday, from Schedule meetings ({ days: "MWF", start: "09:30" }). */
function classTime(dayMs, meetings = []) {
  const letter = "UMTWRFS"[new Date(dayMs).getDay()];
  const m = meetings.find(x => (x.days || "").includes(letter) && x.start && (x.kind || "lecture") === "lecture") || meetings.find(x => (x.days || "").includes(letter) && x.start);
  if (!m) return null;
  const [h, mi] = m.start.split(":").map(Number);
  return h * 60 + (mi || 0);
}

/** Make a readable title from the line, minus dates, times, weekdays and filler. */
function cleanTitle(line, dates) {
  let t = line;
  for (const d of [...dates].sort((a, b) => b.idx - a.idx)) t = t.slice(0, d.idx) + " " + t.slice(d.idx + d.len);
  t = t
    .replace(/\b\d{1,2}(:\d{2})?\s*(a\.?m\.?|p\.?m\.?)(?=\W|$)/gi, " ")
    .replace(/\b\d{1,2}:\d{2}\b/g, " ")
    .replace(/\b(noon|midnight)\b/gi, " ")
    .replace(new RegExp(`\\b${WEEKDAY_RE}(?=\\W|$)`, "gi"), " ")
    .replace(/\bweek\s*\d{1,2}\b/gi, " ")
    .replace(/\b(due|deadline|on|by|at|is|will be|in class|in-class|during class|eastern|et|est|edt|released|assigned|out|tba|tbd|no class(es)?|no lecture|class(es)? (are )?cancell?ed)\b/gi, " ")
    .replace(/[|•▪◦●*·\t]+/g, " ")
    .replace(/\(\s*\)/g, " ")
    .replace(/\s+[-–—]\s+(?=[-–—,;:]|\s*$)/g, " ")
    .replace(/([,;:])(\s*[-–—,;:])+/g, "$1")
    .replace(/\s+([,;:])/g, "$1")
    .replace(/\s*[-–—:,;]+\s*$/g, "")
    .replace(/^\s*[-–—:,;.)]+\s*/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (t.length > 80) t = t.slice(0, 77).trim() + "…";
  return t ? t[0].toUpperCase() + t.slice(1) : "";
}

const DEFAULT_TITLES = { exam: "Exam", quiz: "Quiz", project: "Project", presentation: "Presentation", paper: "Paper", lab: "Lab", homework: "Homework" };

export function scanSyllabus(text, { now = Date.now(), semesterStart = null, meetings = [] } = {}) {
  const ctx = { now, semesterStart };
  const items = [], breaks = [], weights = [];
  // lines, and bullet- or pipe-separated parts of a line ("Feb 10 Hashing • PA2 due Feb 17")
  const lines = String(text || "").replace(/\r/g, "").split(/\n/)
    .flatMap(l => l.split(/\s+[•▪◦●|]\s+|\s*;\s+/))
    .map(l => l.trim()).filter(Boolean);
  const seen = new Set();

  for (const line of lines) {
    // grading weights: "Exams 40%", "Midterm 1 .... 20 %", "Projects: 30%"
    // (one or several per line: "Homework 40%   Quizzes 10%")
    if (/%/.test(line) && !findDates(line, ctx).length) {
      const pairs = [...line.matchAll(/([A-Za-z][A-Za-z0-9 &/+'’()-]{1,40}?)\s*[:.\-–—]*\s*\(?(\d{1,3}(?:\.\d+)?)\s*%\)?/g)];
      const covered = pairs.reduce((n, p) => n + p[0].length, 0);
      if (pairs.length && covered >= line.replace(/\s+/g, " ").length * 0.6) {
        for (const p of pairs) if (+p[2] > 0 && +p[2] <= 100) weights.push({ label: p[1].trim(), pct: +p[2] });
        continue;
      }
    }

    const dates = findDates(line, ctx);
    if (!dates.length) continue;
    const type = (TYPES.find(([, re]) => re.test(line)) || [null])[0];
    const isDue = DUE_WORD.test(line);
    if (!type && !isDue) continue;                // a topic line like "Mar 3: Recursion", not a deadline

    if (type === "break") {
      const d = dates[0];
      const label = cleanTitle(line, dates).replace(/^[,;:\s]+|[,;:\s]+$/g, "");
      breaks.push({ label: label || "No class", from: d.start, to: d.end || d.start, line });
      continue;
    }
    const kind = type || "homework";
    const mentions = (line.match(ITEM_WORD) || []).length;
    let chunks;
    if (dates.length > 1 && mentions <= 1 && !dates.some(d => d.end)) {
      // one thing, two dates ("PA1 released Jan 20, due Feb 3") → the date after "due", else the last one
      const dueAt = line.search(DUE_WORD);
      const pick = dates.find(d => dueAt >= 0 && d.idx > dueAt) || dates[dates.length - 1];
      chunks = [{ text: line, date: pick, all: dates }];
    } else if (dates.length > 1 && !dates.some(d => d.end)) {
      // several things on one line ("3/26 Quiz 2, 4/9 Quiz 3"): each date with the text up to the next date
      chunks = dates.map((d, i) => {
        const from = i === 0 ? 0 : d.idx, to = i + 1 < dates.length ? dates[i + 1].idx : line.length;
        return { text: line.slice(from, to), date: d };
      });
      // if the words come before their dates ("Quiz 3 Feb 10, Quiz 4 Feb 24"), split after each date instead
      if (chunks.slice(1).some(c => !ITEM_WORD.test(c.text.replace(/^\S+\s*/, "")) && (ITEM_WORD.lastIndex = 0, true))) {
        chunks = dates.map((d, i) => ({ text: line.slice(i === 0 ? 0 : dates[i - 1].idx + dates[i - 1].len, d.idx + d.len), date: d }));
      }
      ITEM_WORD.lastIndex = 0;
    } else {
      chunks = [{ text: line, date: dates[0] }];
    }
    for (const ch of chunks) {
      const chDates = ch.all || findDates(ch.text, ctx);
      const chType = (TYPES.find(([, re]) => re.test(ch.text)) || [kind])[0];
      if (chType === "break") continue;
      const tMin = findTime(ch.text);
      let timeKnown = tMin != null, mins = tMin;
      if (!timeKnown && (chType === "exam" || chType === "quiz" || IN_CLASS.test(ch.text))) {
        const ct = classTime(ch.date.start, meetings); if (ct != null) { mins = ct; timeKnown = true; }
      }
      if (mins == null) mins = chType === "exam" || chType === "quiz" ? 9 * 60 : 23 * 60 + 59;
      const due = new Date(ch.date.start); due.setHours(Math.floor(mins / 60), mins % 60, 0, 0);
      const title = cleanTitle(ch.text, chDates.length ? chDates : [ch.date]).replace(/^[,;:\s]+|[,;:\s]+$/g, "") || DEFAULT_TITLES[chType] || "Assignment";
      const tentative = TENTATIVE.test(ch.text);
      const key = `${title.toLowerCase()}|${+due}`;
      if (seen.has(key)) continue; seen.add(key);
      items.push({ type: chType, title, due: +due, timeKnown: timeKnown && !tentative, tentative, line, fromWeek: !!ch.date.fromWeek });
    }
  }
  items.sort((a, b) => a.due - b.due);
  breaks.sort((a, b) => a.from - b.from);
  return { items, breaks, weights };
}

/** Rough "same thing" check: shared words after dropping filler. */
export function similar(a, b) {
  const words = s => new Set(String(s).toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(w => w && !["the", "a", "an", "of", "and", "due", "for"].includes(w)));
  const A = words(a), B = words(b); if (!A.size || !B.size) return false;
  let same = 0; for (const w of A) if (B.has(w)) same++;
  return same / Math.min(A.size, B.size) >= 0.6;
}

export const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
