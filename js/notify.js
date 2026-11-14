// Desktop/phone notifications. Shown through the service worker when possible,
// so they can carry buttons (Done, Snooze). Button presses come back through
// onAction(fn), even when the press reopened a closed GooseOS window.

export const supported = typeof window !== "undefined" && "Notification" in window;
export const permission = () => (supported ? Notification.permission : "denied");

/** Ask once. Call this right after the person sets something up that needs it. */
export async function ask() {
  if (!supported) return "denied";
  if (Notification.permission === "default") {
    try { return await Notification.requestPermission(); } catch (e) { return "denied"; }
  }
  return Notification.permission;
}

/**
 * show("CS 18000 Project 3", { body, tag, data: { key, open }, actions: [{ action: "done", title: "Done" }] })
 * Same tag replaces the old notification instead of stacking.
 */
export async function show(title, { body = "", tag, data = {}, actions = [], quiet = false } = {}) {
  if (permission() !== "granted") return false;
  const opts = { body, tag, data, icon: "icons/icon-192.png", badge: "icons/favicon-64.png", renotify: !!tag, silent: quiet, requireInteraction: !quiet };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg) { await reg.showNotification(title, { ...opts, actions: actions.slice(0, 2) }); return true; }
  } catch (e) { /* fall back below */ }
  try {
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); n.close(); deliver({ action: "open", data }); };
    return true;
  } catch (e) { return false; }
}

/* ---------- button presses ---------- */
const handlers = new Set();
const pending = [];

function deliver(msg) {
  if (msg.action === "open" && msg.data && msg.data.open) location.hash = msg.data.open.replace(/^#/, "");
  if (!handlers.size) { pending.push(msg); return; }
  for (const fn of handlers) { try { fn(msg); } catch (e) { console.error(e); } }
}

/** fn({ action: "open" | "done" | "snooze" | ..., data }) */
export function onAction(fn) {
  handlers.add(fn);
  while (pending.length) deliver(pending.shift());
  return () => handlers.delete(fn);
}

if (typeof navigator !== "undefined" && navigator.serviceWorker) {
  navigator.serviceWorker.addEventListener("message", e => {
    if (e.data && e.data.type === "notification") deliver({ action: e.data.action, data: e.data.data || {} });
  });
}

// A press that had to open a new window arrives as ?na=<action>&nk=<key>
try {
  const q = new URLSearchParams(location.search);
  if (q.get("na")) {
    pending.push({ action: q.get("na"), data: { key: q.get("nk") || "" } });
    history.replaceState(null, "", location.pathname + location.hash);
  }
} catch (e) { /* ignore */ }
