// Files: anything you attach or send (Transfer, Milestones, PDF editor).
// The file itself goes to your private Supabase storage folder (see the Files
// part of supabase/schema.sql) and is also kept on this device, so files you've
// opened work offline. A short record of each file syncs like everything else,
// which is how your other devices find out it exists.
//
// Saved items (app "files"), one per file:
//   <id>: { name, type, size, scope: "transfer" | "milestone" | "pdf", owner?, pinned?,
//           from (device name), created, uploaded, error?, expires? }
//   owner: what it belongs to, like "milestones:m-abc" or "milestones:m-abc:s-xyz" (a step)
//   expires: Transfer files are cleaned up after this time unless pinned
import * as store from "./store.js";
import * as sync from "./sync.js";

const APP = "files";
export const MAX_BYTES = 50 * 1024 * 1024;
export const TRANSFER_DAYS = 7;
const D = 864e5;

/* ---------- this device's copies (a separate IndexedDB, so the main one never changes shape) ---------- */
let dbp = null;
function db() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open("gooseos-files", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("blobs");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}
async function local(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("blobs", mode), req = fn(tx.objectStore("blobs"));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
  });
}
const keepLocal = (id, blob) => local("readwrite", s => s.put(blob, id));
const readLocal = id => local("readonly", s => s.get(id));
const dropLocal = id => local("readwrite", s => s.delete(id));
export const hasLocal = async id => !!(await readLocal(id).catch(() => null));

/* ---------- device name, so a file can say where it came from ---------- */
export function deviceName() {
  try { const n = localStorage.getItem("gooseos-device"); if (n) return n; } catch (e) { /* ignore */ }
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android phone"
    : /Mac/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows laptop" : "Computer";
}

/* ---------- records ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/** Every file, newest first. Filter with { scope, owner } (owner matches itself and anything under it). */
export async function list({ scope, owner } = {}) {
  return (await store.list(APP)).filter(r => r.data && r.data.name)
    .map(r => ({ id: r.id, ...r.data }))
    .filter(f => (!scope || f.scope === scope) && (!owner || f.owner === owner || String(f.owner || "").startsWith(owner + ":")))
    .sort((a, b) => b.created - a.created);
}
export async function get(id) { const d = await store.get(APP, id); return d ? { id, ...d } : null; }
export async function update(id, patch) { const d = await store.get(APP, id); if (d) await store.put(APP, id, { ...d, ...patch }); }

/** Save a file: on this device right away, then up to your storage. Returns the record. */
export async function add(file, { name, scope = "transfer", owner = "", pinned = false } = {}) {
  if (file.size > MAX_BYTES) throw new Error("too-big");
  const id = "f-" + uid();
  const meta = { name: name || file.name || "file", type: file.type || "application/octet-stream", size: file.size, scope, owner, pinned,
    from: deviceName(), created: Date.now(), uploaded: false, ...(scope === "transfer" ? { expires: Date.now() + TRANSFER_DAYS * D } : {}) };
  await keepLocal(id, file);
  await store.put(APP, id, meta);
  upload(id).catch(() => {});   // in the background; retried later if it fails
  return { id, ...meta };
}

/** The file's contents: this device's copy, or downloaded (and kept) if it came from another device. */
export async function blob(id) {
  const have = await readLocal(id).catch(() => null);
  if (have) return have;
  const meta = await get(id);
  if (!meta) throw new Error("gone");
  if (!meta.uploaded) throw new Error("not-uploaded");
  const fb = await sync.fileBucket();
  if (!fb) throw new Error("signed-out");
  const { data, error } = await fb.bucket.download(`${fb.folder}/${id}`);
  if (error) throw new Error(error.message || "download-failed");
  const b = data.type ? data : new Blob([data], { type: meta.type });
  await keepLocal(id, b).catch(() => {});
  return b;
}

/** Delete everywhere. If you're offline, the cloud copy goes the next time you're online. */
export async function remove(id) {
  await store.remove(APP, id);
  await dropLocal(id).catch(() => {});
  trash(id);
  flushTrash();
}

/* ---------- uploads, deletes, cleanup ---------- */
const uploading = new Set();
async function upload(id) {
  if (uploading.has(id)) return;
  uploading.add(id);
  try {
    const meta = await store.get(APP, id);
    if (!meta || meta.uploaded) return;
    const b = await readLocal(id); if (!b) return;   // made on another device: it uploads it
    const fb = await sync.fileBucket(); if (!fb) return;   // signed out: try again later
    const { error } = await fb.bucket.upload(`${fb.folder}/${id}`, b, { contentType: meta.type, upsert: true });
    const now = await store.get(APP, id); if (!now) return;   // deleted meanwhile
    if (error) { await store.put(APP, id, { ...now, error: error.message || "Upload failed" }); return; }
    const { error: _e, ...rest } = now;
    await store.put(APP, id, { ...rest, uploaded: true });
  } finally { uploading.delete(id); }
}

function trashList() { try { return JSON.parse(localStorage.getItem("gooseos-files-trash") || "[]"); } catch (e) { return []; } }
function setTrash(l) { try { localStorage.setItem("gooseos-files-trash", JSON.stringify(l)); } catch (e) { /* ignore */ } }
function trash(id) { const l = trashList(); if (!l.includes(id)) setTrash([...l, id]); }
async function flushTrash() {
  const l = trashList(); if (!l.length) return;
  const fb = await sync.fileBucket(); if (!fb) return;
  const { error } = await fb.bucket.remove(l.map(id => `${fb.folder}/${id}`));
  if (!error) setTrash(trashList().filter(id => !l.includes(id)));
}

/** Retry uploads, finish deletes, clear expired Transfer files, drop copies of files deleted elsewhere. */
export async function tidy() {
  const now = Date.now(), all = await list();
  for (const f of all) {
    if (f.expires && !f.pinned && f.expires < now) { await remove(f.id); continue; }
    if (!f.uploaded) await upload(f.id).catch(() => {});
  }
  await flushTrash().catch(() => {});
}

/** At boot: keep files moving in the background. */
export function start() {
  setTimeout(() => tidy().catch(e => console.error("files", e)), 4000);
  setInterval(() => { if (document.visibilityState === "visible") tidy().catch(() => {}); }, 120000);
  let was = sync.signedIn();
  sync.onStatus(() => { const on = sync.signedIn(); if (on && !was) tidy().catch(() => {}); was = on; });
  window.addEventListener("online", () => tidy().catch(() => {}));
  // a file deleted on another device: drop this device's copy too
  store.onChange(ch => { if (ch.app === APP && ch.source === "remote") for (const id of ch.ids || []) store.get(APP, id).then(d => { if (!d) dropLocal(id).catch(() => {}); }); });
}

/* ---------- small helpers for the apps ---------- */
export const isPdf = f => /pdf/i.test(f.type || "") || /\.pdf$/i.test(f.name || "");
export const isImage = f => /^image\//i.test(f.type || "");
export function sizeText(n) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}
/** Hand a file to the browser to save. */
export async function download(id) {
  const meta = await get(id), b = await blob(id);
  const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = meta ? meta.name : "file"; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
/** Open in a new tab (images, PDFs, text); falls back to saving it. */
export async function openInTab(id) {
  const b = await blob(id), url = URL.createObjectURL(b);
  const w = window.open(url, "_blank", "noopener");
  if (!w) { const meta = await get(id); const a = document.createElement("a"); a.href = url; a.download = meta ? meta.name : "file"; a.click(); }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
/** Plain words for an error from add() / blob(). */
export function errorText(e) {
  const m = e && e.message;
  return m === "too-big" ? "That file is over 50 MB."
    : m === "signed-out" ? "Sign in to sync to get files from your other devices."
    : m === "not-uploaded" ? "It hasn't finished uploading from the other device yet."
    : m === "gone" ? "That file was deleted."
    : /bucket/i.test(m || "") ? "File storage isn't set up yet. Run the Files part of supabase/schema.sql in Supabase."
    : !navigator.onLine ? "You're offline. Try again when you're connected." : "Something went wrong with that file. Try again.";
}
