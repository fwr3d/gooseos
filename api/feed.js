// Private calendar feed: your phone's calendar subscribes to this link and
// shows every open GooseOS deadline, with alerts, even when GooseOS is closed.
//   GET /api/feed?t=<token>
// The token is made in Reminders. It only unlocks the short list GooseOS saves
// for the feed (titles and due times), never the rest of your data.

const TOKEN = /^[a-f0-9]{32,64}$/;
const KEEP_LATE_FOR = 7 * 864e5; // overdue things stay on the calendar for a week

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", status === 200 ? "private, max-age=300" : "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

const pad = n => String(n).padStart(2, "0");
const stamp = t => { const d = new Date(t); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`; };
const text = s => String(s ?? "").replace(/\\/g, "\\\\").replace(/\r?\n/g, "\\n").replace(/([,;])/g, "\\$1");
// calendar lines may be at most 75 bytes; longer ones continue on the next line after a space
function fold(line) {
  const out = [];
  let cur = "", bytes = 0;
  for (const ch of line) {
    const b = Buffer.byteLength(ch);
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ""; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join("\r\n ");
}
function trigger(min) {
  const m = Math.max(1, Math.round(min));
  if (m % 1440 === 0) return `-P${m / 1440}D`;
  if (m % 60 === 0) return `-PT${m / 60}H`;
  return `-PT${m}M`;
}

/** items: [{ key, title, due, course?, kind?, open?, alarms?: [minutes before] }] */
function buildICS(items, { now = Date.now(), origin = "" } = {}) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GooseOS//Deadlines//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "X-WR-CALNAME:GooseOS", "X-WR-CALDESC:Deadlines from GooseOS", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const it of items || []) {
    if (!it || !it.key || !Number.isFinite(it.due) || it.due < now - KEEP_LATE_FOR) continue;
    const title = [it.course, it.title].filter(Boolean).join(" · ") || "Deadline";
    lines.push("BEGIN:VEVENT", `UID:${text(it.key)}@gooseos`, `DTSTAMP:${stamp(now)}`, `DTSTART:${stamp(it.due)}`, `DTEND:${stamp(it.due)}`,
      `SUMMARY:${text(title)}`, `DESCRIPTION:${text(it.kind === "exam" ? "Exam, from GooseOS" : "Due, from GooseOS")}`);
    if (origin && it.open) lines.push(`URL:${origin}/${String(it.open).replace(/[\r\n]/g, "")}`);
    for (const min of (Array.isArray(it.alarms) ? it.alarms : []).slice(0, 6)) {
      if (!Number.isFinite(min) || min <= 0) continue;
      lines.push("BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${text(title)}`, `TRIGGER:${trigger(min)}`, "END:VALARM");
    }
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, "Only GET is allowed.");
  const token = new URL(req.url, "http://local").searchParams.get("t") || "";
  if (!TOKEN.test(token)) return send(res, 404, "No calendar at this link.");

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const { SUPABASE_URL, SUPABASE_KEY } = await import("../js/config.js");
    if (!SUPABASE_URL || !SUPABASE_KEY) return send(res, 503, "Sync isn't set up, so there is no calendar feed.");
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/feed_agenda`, {
      method: "POST", signal: ctrl.signal,
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ feed_token: token }),
    });
    if (!r.ok) return send(res, 502, "Couldn't load the calendar. If this is new, the feed part of supabase/schema.sql may not have been run yet.");
    const data = await r.json();
    if (data === null) return send(res, 404, "No calendar at this link. It may have been turned off in GooseOS.");
    const host = req.headers["x-forwarded-host"] || req.headers.host || "";
    const proto = req.headers["x-forwarded-proto"] || (/^(localhost|127\.)/.test(host) ? "http" : "https");
    return send(res, 200, buildICS(data.items, { origin: host ? `${proto}://${host}` : "" }), "text/calendar; charset=utf-8");
  } catch (e) {
    return send(res, 504, e.name === "AbortError" ? "The calendar took too long to load." : "Couldn't load the calendar.");
  } finally {
    clearTimeout(timer);
  }
}

module.exports = handler;
module.exports.buildICS = buildICS;
