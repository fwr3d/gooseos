// Calendar feed: a private link your phone's calendar subscribes to, so
// deadlines alert you even when GooseOS is closed. Needs sync turned on.
//
// Saved items (app "feed"), synced like everything else:
//   "link":   { token, created }                 the secret part of the link
//   "agenda": { items: [{ key, title, due, course, kind, open, alarms }], at }
//             a copy of the open, dated agenda. api/feed.js turns it into a calendar.
import * as store from "./store.js";
import * as sync from "./sync.js";
import * as agenda from "./agenda.js";

const APP = "feed";
// minutes before the due time, per "How hard to nag" setting in Reminders
const ALARMS = { chill: [1440, 60], normal: [4320, 1440, 180, 60], relentless: [4320, 1440, 360, 180, 60, 30] };

export const getLink = () => store.get(APP, "link");
/** The link to subscribe to. scheme "webcal" opens the phone's calendar app directly. */
export function urlFor(token, scheme = "https") {
  const u = new URL(`api/feed?t=${token}`, location.origin + "/");
  return scheme === "webcal" ? u.href.replace(/^https?:/, "webcal:") : u.href;
}

async function snapshot() {
  const rm = (await store.get("reminders", "settings")) || {};
  const ramp = ALARMS[rm.intensity] || ALARMS.normal;
  return (await agenda.list())
    .filter(i => i.due && !i.done && i.kind !== "ping")
    .map(i => ({ key: i.key, title: i.title || "", due: i.due, course: i.course || "", kind: i.kind, open: i.open,
      alarms: i.kind === "deadline" || i.kind === "exam" ? ramp : [1440] }));
}

/** Save the agenda copy if it changed. Does nothing until a link exists. */
export async function refresh() {
  if (!(await getLink())) return false;
  const items = await snapshot(), cur = await store.get(APP, "agenda");
  if (cur && JSON.stringify(cur.items) === JSON.stringify(items)) return false;
  await store.put(APP, "agenda", { items, at: Date.now() });
  return true;
}

/** Make the link. Throws Error("signed-out") if sync is off. */
export async function create() {
  const have = await getLink(); if (have) return have;
  if (!sync.signedIn()) throw new Error("signed-out");
  const token = [...crypto.getRandomValues(new Uint8Array(24))].map(b => b.toString(16).padStart(2, "0")).join("");
  await sync.addFeedToken(token);
  const link = { token, created: Date.now() };
  await store.put(APP, "link", link);
  await refresh();
  sync.syncNow();
  return link;
}

/** Turn the link off. Calendars subscribed to it stop updating. */
export async function remove() {
  const link = await getLink(); if (!link) return;
  await sync.removeFeedToken(link.token);
  await store.remove(APP, "link");
  await store.remove(APP, "agenda");
}

/** Keep the agenda copy current while GooseOS is open. */
export function start() {
  let t = null;
  const soon = () => { clearTimeout(t); t = setTimeout(() => refresh().catch(e => console.error(e)), 1500); };
  store.onChange(ch => { if (ch.app !== APP || (ch.source === "remote" && ch.ids.includes("link"))) soon(); });
  soon();
}
