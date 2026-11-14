// Relay for Brightspace calendar feeds.
// Browsers can't read a Brightspace calendar link directly from another site,
// so GooseOS asks this function to fetch it. It only talks to Brightspace
// calendar-feed links, never anything else, and keeps nothing.
//   GET /api/ics?url=https://<school>.brightspace.com/d2l/le/calendar/feed/user/feed.ics?token=...

const MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_HOST = /(^|\.)(brightspace\.com|desire2learn\.com)$/i;

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.statusCode = status;
  res.setHeader("Content-Type", type);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.end(body);
}

module.exports = async function handler(req, res) {
  if (req.method !== "GET") return send(res, 405, "Only GET is allowed.");
  let target;
  try {
    const q = new URL(req.url, "http://local").searchParams.get("url") || "";
    target = new URL(q);
  } catch (e) {
    return send(res, 400, "That isn't a valid link.");
  }
  if (target.protocol !== "https:" || !ALLOWED_HOST.test(target.hostname) || !/\/calendar\/feed\//i.test(target.pathname)) {
    return send(res, 400, "Only Brightspace calendar subscription links are allowed.");
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch(target, { signal: ctrl.signal, redirect: "follow", headers: { "User-Agent": "GooseOS calendar sync", Accept: "text/calendar,*/*" } });
    if (!r.ok) return send(res, 502, `Brightspace answered ${r.status}. The link may have expired; make a new one in Brightspace.`);
    const final = new URL(r.url || target);
    if (!ALLOWED_HOST.test(final.hostname)) return send(res, 502, "Brightspace redirected somewhere unexpected.");
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_BYTES) return send(res, 502, "That calendar is too big.");
    const text = buf.toString("utf8");
    if (!/BEGIN:VCALENDAR/.test(text)) return send(res, 502, "That link didn't return a calendar. Make sure you copied the subscribe link.");
    return send(res, 200, text, "text/calendar; charset=utf-8");
  } catch (e) {
    return send(res, 504, e.name === "AbortError" ? "Brightspace took too long to answer." : "Couldn't reach Brightspace.");
  } finally {
    clearTimeout(timer);
  }
};
