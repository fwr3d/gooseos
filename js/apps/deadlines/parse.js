// Turns quick-capture text like "cs proj 3 due fri 11:59" into a deadline:
//   { title, course, source, due: Date, hasTime }
// Understands:
//   course   first word if it's a known course (or looks like one: "cs", "ma261", "CS 18000")
//   source   "gradescope"/"gs", "ed", "brightspace"/"bs" anywhere in the text
//   day      today, tonight, tomorrow/tmrw, mon..sun, next fri, 11/20, nov 20, 20 nov, in 3 days
//   time     11:59, 11:59pm, 9am, noon, midnight (no am/pm: 1-7 → pm, 11:59 → pm)
// With no day, it's due today if the time is still ahead, otherwise tomorrow. With no time, 11:59 PM.

const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const DAY_ALIASES = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const MONTHS = { jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11 };
const SOURCES = { gradescope: "gradescope", gs: "gradescope", ed: "ed", edstem: "ed", brightspace: "brightspace", bs: "brightspace", d2l: "brightspace" };
const FILLER = new Set(["due", "by", "at", "on", "@", "is", "for", "the"]);
// common department codes, so "ma" or "phys" counts as a course even before you've used it
const DEPTS = new Set(["cs", "ma", "math", "phys", "chm", "chem", "engl", "ece", "me", "ae", "aae", "ie", "ce", "che", "bme", "engr", "enge", "stat", "econ", "biol", "bio", "hist", "psy", "comm", "mgmt", "pol", "phil", "tech", "cnit", "it", "art", "ent", "eaps", "hk", "nutr", "soc", "spch", "ece", "mse", "abe", "bcm", "nuc"]);

const pad = n => String(n).padStart(2, "0");

/** Normalize a course for matching: "CS 18000" / "cs18000" / "cs" → "CS 18000" / "CS". */
export function normCourse(s) {
  const m = String(s).trim().match(/^([a-z]{2,5})\s*(\d{3,5})?$/i);
  if (!m) return String(s).trim();
  return m[2] ? `${m[1].toUpperCase()} ${m[2]}` : m[1].toUpperCase();
}

function parseTime(tok, next) {
  let m;
  if (tok === "noon") return { h: 12, m: 0, used: 1 };
  if (tok === "midnight") return { h: 23, m: 59, used: 1 };
  if ((m = tok.match(/^(\d{1,2})(?::(\d{2}))?(am|pm|a|p)?$/))) {
    let h = +m[1], mi = m[2] ? +m[2] : 0, ap = m[3], used = 1;
    if (!ap && (next === "am" || next === "pm")) { ap = next; used = 2; }
    if (!m[2] && !ap) return null;            // a bare number isn't a time ("proj 3")
    if (h > 23 || mi > 59) return null;
    if (ap) { ap = ap[0]; if (ap === "p" && h < 12) h += 12; if (ap === "a" && h === 12) h = 0; }
    else if (h >= 1 && h <= 7) h += 12;       // "5:00" for school almost always means 5 PM
    else if (h === 11 && mi === 59) h = 23;   // 11:59 deadlines are PM
    return { h, m: mi, used };
  }
  return null;
}

export function parseCapture(text, now = new Date(), knownCourses = []) {
  const raw = String(text || "").trim();
  const words = raw.split(/\s+/).filter(Boolean);
  const lower = words.map(w => w.toLowerCase().replace(/[,.]$/, ""));
  const used = new Array(words.length).fill(false);
  let course = "", source = "", day = null, time = null;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const known = knownCourses.map(c => ({ full: c, norm: normCourse(c).toLowerCase(), dept: normCourse(c).split(" ")[0].toLowerCase() }));

  // course: first word (or first two, like "cs 180")
  if (lower.length) {
    const two = lower.length > 1 && /^\d{3,5}$/.test(lower[1]) ? `${lower[0]} ${lower[1]}` : null;
    const one = lower[0];
    // exact ("cs 18000"), short number ("ma261" → "MA 26100"), or department only ("cs" → "CS 18000")
    const match = c => {
      const n = normCourse(c).toLowerCase();
      return known.find(k => k.norm === n) || (/\d/.test(n) && known.find(k => k.norm.startsWith(n))) || (!/\d/.test(n) && known.find(k => k.dept === n));
    };
    if (two && /^[a-z]{2,5}$/.test(lower[0])) { const k = match(two); course = k ? k.full : normCourse(two); used[0] = used[1] = true; }
    else if (/^[a-z]{2,5}\d{3,5}$/.test(one)) { const k = match(one); course = k ? k.full : normCourse(one); used[0] = true; }
    else if (/^[a-z]{2,5}$/.test(one) && (match(one) || DEPTS.has(one))) { const k = match(one); course = k ? k.full : normCourse(one); used[0] = true; }
  }

  for (let i = 0; i < lower.length; i++) {
    if (used[i]) continue;
    const w = lower[i], nx = lower[i + 1];
    if (SOURCES[w] && !source) { source = SOURCES[w]; used[i] = true; continue; }
    if (day === null) {
      if (w === "today" || w === "tonight" || w === "tn") { day = new Date(today); used[i] = true; if (w === "tonight" && !time) time = { h: 23, m: 59, soft: true }; continue; }
      if (w === "tomorrow" || w === "tmrw" || w === "tmr" || w === "tom") { day = new Date(today); day.setDate(day.getDate() + 1); used[i] = true; continue; }
      if (w === "next" && nx in DAY_ALIASES) { const t = DAY_ALIASES[nx]; day = new Date(today); let d = (t - day.getDay() + 7) % 7 || 7; day.setDate(day.getDate() + d + 7); used[i] = used[i + 1] = true; i++; continue; }
      if (w in DAY_ALIASES) { const t = DAY_ALIASES[w]; day = new Date(today); day.setDate(day.getDate() + ((t - day.getDay() + 7) % 7)); used[i] = true; day._weekday = true; continue; }
      if (w === "in" && /^\d+$/.test(nx || "") && /^(day|days|d)$/.test(lower[i + 2] || "")) { day = new Date(today); day.setDate(day.getDate() + +nx); used[i] = used[i + 1] = used[i + 2] = true; i += 2; continue; }
      let m;
      if ((m = w.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/))) {
        let y = m[3] ? +m[3] : today.getFullYear(); if (y < 100) y += 2000;
        day = new Date(y, +m[1] - 1, +m[2]); if (!m[3] && day < today - 60 * 864e5) day.setFullYear(y + 1); used[i] = true; continue;
      }
      if (w in MONTHS && /^\d{1,2}(st|nd|rd|th)?$/.test(nx || "")) { day = new Date(today.getFullYear(), MONTHS[w], parseInt(nx)); if (day < today - 60 * 864e5) day.setFullYear(day.getFullYear() + 1); used[i] = used[i + 1] = true; i++; continue; }
      if (/^\d{1,2}(st|nd|rd|th)?$/.test(w) && (nx in MONTHS) && !/^\d{1,2}(st|nd|rd|th)?$/.test(lower[i + 2] || "")) { day = new Date(today.getFullYear(), MONTHS[nx], parseInt(w)); if (day < today - 60 * 864e5) day.setFullYear(day.getFullYear() + 1); used[i] = used[i + 1] = true; i++; continue; }
    }
    if (!time || time.soft) {
      // a plain number right after a day is a time: "sat 5" → Sat 5 PM
      if (day && i > 0 && used[i - 1] && /^\d{1,2}$/.test(w) && +w >= 1 && +w <= 12) {
        let h = +w; if (h >= 1 && h <= 7) h += 12; if (h === 12) h = 12;
        time = { h, m: 0, used: 1 }; used[i] = true; continue;
      }
      const t = parseTime(w, nx);
      if (t) { time = t; for (let k = 0; k < t.used; k++) used[i + k] = true; i += t.used - 1; continue; }
    }
  }

  // drop filler words that sit next to the date/time ("due", "by", "at")
  for (let i = 0; i < lower.length; i++) {
    if (!used[i] && FILLER.has(lower[i])) {
      const nearUsed = (i + 1 < lower.length && used[i + 1]) || (i > 0 && used[i - 1] && i === lower.length - 1) || lower[i] === "due";
      if (nearUsed) used[i] = true;
    }
  }
  const title = words.filter((_, i) => !used[i]).join(" ").replace(/\s+-\s*$/, "").trim();

  const hasTime = !!time && !time.soft;
  const h = time ? time.h : 23, mi = time ? time.m : 59;
  let due = null;
  if (day) {
    due = new Date(day); due.setHours(h, mi, 0, 0);
    // "fri" said on a Friday after the time has passed → next week
    if (day._weekday && due < now) due.setDate(due.getDate() + 7);
  } else if (time) {
    due = new Date(today); due.setHours(h, mi, 0, 0);
    if (due < now) due.setDate(due.getDate() + 1);
  }
  return { title, course, source, due, hasTime: hasTime || !!day };
}

/** Friendly due text: "Today 11:59 PM", "Tomorrow 9:00 AM", "Fri 11:59 PM", "Nov 20, 11:59 PM". */
export function dueLabel(due, now = new Date()) {
  if (!due) return "";
  const d = new Date(due), t0 = new Date(now); t0.setHours(0, 0, 0, 0);
  const d0 = new Date(d); d0.setHours(0, 0, 0, 0);
  const days = Math.round((d0 - t0) / 864e5);
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days === -1) return `Yesterday ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}, ${time}`;
}

export const toLocalInput = d => { const x = new Date(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}-${pad(x.getDate())}T${pad(x.getHours())}:${pad(x.getMinutes())}`; };
export { DAYS };
