// Keeps GooseOS's files on the device so it opens without internet.
// Change VERSION whenever you publish an update (2.7 -> 2.8, and so on);
// installed copies then show "An update is ready" and reload into the new version.
const VERSION = "5.3";
const SHELL = `shell-${VERSION}`;
const FONTS = "fonts";
// Python for the Code app. Keep this in step with the version in js/apps/code/py-worker.js.
const PYODIDE_PATH = "/pyodide/v0.29.3/";
const PYODIDE = "pyodide-v0.29.3";

const FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/styles.css",
  "js/main.js",
  "js/store.js",
  "js/sync.js",
  "js/config.js",
  "js/icons.js",
  "js/hand-icons.js",
  "js/hand-ui.js",
  "js/line-icons.js",
  "js/capture.js",
  "js/home.js",
  "js/agenda.js",
  "js/notify.js",
  "js/feed.js",
  "js/lists.js",
  "js/latest.js",
  "js/files.js",
  "js/notes-panel.js",
  "js/notes-panel.css",
  "js/viewer.js",
  "js/apps/transfer/transfer.js",
  "js/apps/transfer/transfer.css",
  "js/apps/pdf/pdf.js",
  "js/apps/pdf/pdf.css",
  "js/apps/pdf/makepdf.js",
  "js/apps/deadlines/deadlines.js",
  "js/apps/deadlines/deadlines.css",
  "js/apps/deadlines/parse.js",
  "js/apps/deadlines/ics.js",
  "js/apps/milestones/milestones.js",
  "js/apps/milestones/milestones.css",
  "js/apps/milestones/plan.js",
  "js/apps/milestones/templates.js",
  "js/apps/milestones/workspace.js",
  "js/apps/milestones/practice.js",
  "js/apps/wallet/wallet.js",
  "js/apps/wallet/wallet.css",
  "js/apps/reset/reset.js",
  "js/apps/reset/reset.css",
  "js/apps/grades/grades.js",
  "js/apps/grades/grades.css",
  "js/apps/code/code.js",
  "js/apps/code/code.css",
  "js/apps/code/editor.js",
  "js/apps/code/runner.js",
  "js/apps/code/py-worker.js",
  "js/apps/syllabus/syllabus.js",
  "js/apps/syllabus/syllabus.css",
  "js/apps/syllabus/scan.js",
  "js/apps/syllabus/pdftext.js",
  "js/apps/schedule/schedule.js",
  "js/apps/schedule/schedule.css",
  "js/apps/reminders/reminders.js",
  "js/apps/reminders/reminders.css",
  "js/apps/today/today.js",
  "js/apps/today/today.css",
  "js/apps/index.js",
  "js/apps/whiteboard/whiteboard.js",
  "js/apps/whiteboard/whiteboard.css",
  "icons/favicon-64.png",
  "icons/source/goose.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];
// Optional files: cached if present, skipped if not.
const OPTIONAL = ["js/vendor/supabase.js", "js/vendor/pdfjs/pdf.min.mjs", "js/vendor/pdfjs/pdf.worker.min.mjs"];

const isLocal = ["localhost", "127.0.0.1"].includes(self.location.hostname);

self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    // cache: "reload" skips the browser's own HTTP cache, so an update never saves last version's files
    await cache.addAll(FILES.map(f => new Request(f, { cache: "reload" })));
    await Promise.all(OPTIONAL.map(f => cache.add(new Request(f, { cache: "reload" })).catch(() => {})));
  })());
});

self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => (k.startsWith("shell-") && k !== SHELL) || (k.startsWith("pyodide-") && k !== PYODIDE)).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener("message", event => {
  if (event.data === "skipWaiting") self.skipWaiting();
});

// Notification buttons (Done, Snooze) and clicks: hand them to an open GooseOS
// window, or open one. js/notify.js picks them up.
self.addEventListener("notificationclick", event => {
  const n = event.notification, data = n.data || {}, action = event.action || "open";
  n.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (wins.length) {
      const w = wins[0];
      w.postMessage({ type: "notification", action, data });
      if (action === "open" && w.focus) await w.focus();
      return;
    }
    const q = action === "open" ? "" : `?na=${encodeURIComponent(action)}&nk=${encodeURIComponent(data.key || "")}`;
    await self.clients.openWindow(new URL(`./${q}${action === "open" ? data.open || "" : ""}`, self.registration.scope).href);
  })());
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Google Fonts: use the saved copy right away, refresh it in the background.
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const fresh = fetch(req).then(res => { if (res.ok || res.type === "opaque") cache.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    })());
    return;
  }

  // Python runtime and packages: these files never change for a given version,
  // so once one is saved it's used as-is and the Code app works offline.
  if (url.hostname === "cdn.jsdelivr.net" && url.pathname.startsWith(PYODIDE_PATH)) {
    event.respondWith((async () => {
      const cache = await caches.open(PYODIDE);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }

  if (url.origin !== self.location.origin) return; // sync requests etc. go straight to the network
  if (url.pathname.startsWith("/api/")) return;    // Brightspace relay: always live, never saved

  // Opening the app: always serve the home screen page.
  if (req.mode === "navigate") {
    event.respondWith((async () => {
      if (isLocal) { try { return await fetch(req); } catch (e) { /* fall through to cache */ } }
      const cached = await (await caches.open(SHELL)).match("index.html");
      return cached || fetch(req);
    })());
    return;
  }

  // App files: saved copy first (fast, offline). On localhost, network first so edits show up.
  event.respondWith((async () => {
    if (isLocal) {
      try { const res = await fetch(req); if (res.ok) (await caches.open(SHELL)).put(req, res.clone()); return res; }
      catch (e) { const hit = await caches.match(req); if (hit) return hit; throw e; }
    }
    // only this version's saved files, so an older copy left in another cache is never served
    const hit = await (await caches.open(SHELL)).match(req, { ignoreSearch: true });
    return hit || fetch(req);
  })());
});
