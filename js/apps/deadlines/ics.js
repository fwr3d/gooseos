// Reads a Brightspace calendar feed (iCalendar / .ics text) into deadlines.

function unescapeText(s) {
  return s.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\");
}

/** iCalendar date → Date. "20261120T235900Z" (UTC), "20261120T235900" (local), "20261120" (all day → 11:59 PM). */
function parseDate(v) {
  const m = String(v).match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (!h) return new Date(+y, +mo - 1, +d, 23, 59);
  return z ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +(s || 0))) : new Date(+y, +mo - 1, +d, +h, +mi, +(s || 0));
}

export function parseICS(text) {
  const lines = String(text).replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const events = []; let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const name = line.slice(0, i).split(";")[0].toUpperCase();
    if (!(name in cur)) cur[name] = unescapeText(line.slice(i + 1));
  }
  return events;
}

/** Short course name: "CS 18000-LE1 Fall 2026" → "CS 18000". Falls back to the full text. */
export function shortCourse(s) {
  const m = String(s || "").match(/\b([A-Z]{2,5})\s?(\d{3,5})\b/);
  return m ? `${m[1]} ${m[2]}` : String(s || "").trim();
}

/** "Lesson 5 - Available": Brightspace saying a thing opened, not that anything is due. */
export const isAvailableOnly = title => /[-–]\s*available\s*$/i.test(String(title || "").trim());

/** Calendar events → deadlines. Skips "starts" and "available" events; keeps due dates and "ends" (closing) times.
 *  A closing time that lands at the same minute as the due time is dropped (it would be a copy). */
export function eventsToDeadlines(events) {
  const out = [];
  for (const e of events) {
    let title = (e.SUMMARY || "").trim();
    if (!title) continue;
    if (/\b(availability starts|start date|starts?)\s*$/i.test(title)) continue;
    if (isAvailableOnly(title)) continue;
    const due = parseDate(e.DTSTART || e.DTEND || "") || parseDate(e.DUE || "");
    if (!due) continue;
    const closes = /availability ends|end date|ends?\s*$/i.test(title);
    title = title.replace(/\s*[-–]\s*(due|availability ends|end date|ends)\s*$/i, "").trim();
    const base = title;
    if (closes) title += " (closes)";
    const desc = e.DESCRIPTION || "";
    const link = e.URL || (desc.match(/https?:\/\/\S+/) || [])[0] || "";
    out.push({ uid: e.UID || `${title}|${due.getTime()}`, title, course: shortCourse(e.LOCATION || ""), due: due.getTime(), url: link, base, closes });
  }
  const dueKeys = new Set(out.filter(x => !x.closes).map(x => `${x.course}|${x.base.toLowerCase()}|${x.due}`));
  return out.filter(x => !(x.closes && dueKeys.has(`${x.course}|${x.base.toLowerCase()}|${x.due}`)))
    .map(({ base, closes, ...rest }) => rest);
}

/** Small stable id from a calendar UID. */
export function idFor(uid) {
  let h = 5381; for (let i = 0; i < uid.length; i++) h = ((h << 5) + h + uid.charCodeAt(i)) >>> 0;
  return "bs-" + h.toString(36);
}
