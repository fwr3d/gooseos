// Shared data layer for every app. Everything is saved on the device first
// (IndexedDB), so apps open and save instantly, even offline. sync.js copies
// changed items to the cloud when signed in.
//
// An item is { app, id, data, updated, deleted, dirty }.
//   updated: time of the last change (ms). The newest version wins when syncing.
//   deleted: removed items are kept as markers so the deletion syncs too.
//   dirty:   changed on this device and not uploaded yet.

const DB_NAME = "gooseos";
const ITEMS = "items";
const META = "meta";
let dbPromise = null;
const listeners = new Set();

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        const items = db.createObjectStore(ITEMS, { keyPath: ["app", "id"] });
        items.createIndex("app", "app");
        db.createObjectStore(META, { keyPath: "k" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(stores, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    let out;
    Promise.resolve(fn(tx)).then(v => { out = v; });
    tx.oncomplete = () => resolve(out);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

const req = r => new Promise((resolve, reject) => { r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });

function emit(change) {
  for (const fn of listeners) { try { fn(change); } catch (e) { console.error(e); } }
}

/** Listen for changes. fn({ app, ids, source: "local" | "remote" }). Returns an unsubscribe function. */
export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

/** All live items for one app, as [{ id, data, updated }]. */
export async function list(app) {
  const all = await run([ITEMS], "readonly", tx => req(tx.objectStore(ITEMS).index("app").getAll(app)));
  return all.filter(i => !i.deleted).map(i => ({ id: i.id, data: i.data, updated: i.updated }));
}

export async function get(app, id) {
  const i = await run([ITEMS], "readonly", tx => req(tx.objectStore(ITEMS).get([app, id])));
  return i && !i.deleted ? i.data : null;
}

export async function put(app, id, data) {
  const item = { app, id, data, updated: Date.now(), deleted: false, dirty: true };
  await run([ITEMS], "readwrite", tx => { tx.objectStore(ITEMS).put(item); });
  emit({ app, ids: [id], source: "local" });
}

export async function remove(app, id) {
  const item = { app, id, data: null, updated: Date.now(), deleted: true, dirty: true };
  await run([ITEMS], "readwrite", tx => { tx.objectStore(ITEMS).put(item); });
  emit({ app, ids: [id], source: "local" });
}

/* ---------- used by sync.js ---------- */

/** Items changed on this device and not uploaded yet (including deletions). */
export async function pending() {
  const all = await run([ITEMS], "readonly", tx => req(tx.objectStore(ITEMS).getAll()));
  return all.filter(i => i.dirty);
}

/** After an upload: clear the dirty flag, unless the item changed again meanwhile. */
export async function markSynced(items) {
  await run([ITEMS], "readwrite", async tx => {
    const st = tx.objectStore(ITEMS);
    for (const sent of items) {
      const cur = await req(st.get([sent.app, sent.id]));
      if (cur && cur.updated === sent.updated) { cur.dirty = false; st.put(cur); }
    }
  });
}

/** Mark everything as needing upload (used when signing in with data already on this device). */
export async function markAllDirty() {
  await run([ITEMS], "readwrite", async tx => {
    const st = tx.objectStore(ITEMS);
    const all = await req(st.getAll());
    for (const i of all) { i.dirty = true; st.put(i); }
  });
}

/** Merge rows from the cloud. Keeps whichever version is newer. */
export async function applyRemote(rows) {
  const changed = new Map();
  await run([ITEMS], "readwrite", async tx => {
    const st = tx.objectStore(ITEMS);
    for (const r of rows) {
      const cur = await req(st.get([r.app, r.id]));
      if (cur && cur.updated >= r.updated) continue;
      st.put({ app: r.app, id: r.id, data: r.deleted ? null : r.data, updated: r.updated, deleted: !!r.deleted, dirty: false });
      if (!changed.has(r.app)) changed.set(r.app, []);
      changed.get(r.app).push(r.id);
    }
  });
  for (const [app, ids] of changed) emit({ app, ids, source: "remote" });
  return changed.size > 0;
}

export async function getMeta(k) {
  const r = await run([META], "readonly", tx => req(tx.objectStore(META).get(k)));
  return r ? r.v : undefined;
}
export async function setMeta(k, v) {
  await run([META], "readwrite", tx => { tx.objectStore(META).put({ k, v }); });
}

/** Ask the browser not to clear our data when the device is low on space. */
export async function askPersistent() {
  try {
    if (navigator.storage && navigator.storage.persist && !(await navigator.storage.persisted())) {
      await navigator.storage.persist();
    }
  } catch (e) { /* not supported */ }
}
