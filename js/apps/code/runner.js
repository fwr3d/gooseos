// Runs a program and streams back what happened. Python runs in py-worker.js.
// This is the only part that knows which language it is: another language
// would be a second runner with the same run() / stop() / warm() shape.
const TIMEOUT = 60000;

let worker = null, version = "", state = "idle";   // idle | loading | ready
const statusFns = new Set();
let current = null;   // { onEvent, resolve, timer }

export const language = "Python";
export function onStatus(fn) { statusFns.add(fn); return () => statusFns.delete(fn); }
function setStatus(s, text) { state = s; for (const fn of statusFns) fn({ state, text, version }); }
export function status() { return { state, version }; }

function spawn() {
  worker = new Worker(new URL("./py-worker.js", import.meta.url), { type: "module" });
  setStatus("loading", "Starting Python…");
  worker.onmessage = e => {
    const m = e.data;
    if (m.type === "status") { setStatus(state === "ready" ? "ready" : "loading", m.text); if (current) current.onEvent(m); return; }
    if (m.type === "ready") { version = m.version; setStatus("ready", ""); return; }
    if (!current) return;
    if (m.type === "started") { clearTimeout(current.timer); current.timer = setTimeout(() => stop("timeout"), TIMEOUT); setStatus("ready", ""); }
    current.onEvent(m);
    if (m.type === "done") finish(m.failed ? "failed" : "done");
  };
  worker.onerror = e => {
    e.preventDefault();
    if (current) current.onEvent({ type: "error", kind: "Error", msg: "Python couldn't start. Check your connection and try again.", line: 0, file: "", trace: e.message || "" });
    kill(); finish("failed");
  };
  worker.postMessage({ type: "warm" });
}
function kill() { if (worker) worker.terminate(); worker = null; setStatus("idle", ""); }
function finish(how) {
  if (!current) return;
  const c = current; current = null; clearTimeout(c.timer); c.resolve(how);
}

/** Load Python ahead of time so the first Run is quick. */
export function warm() { if (!worker) spawn(); }

/** Run a program. files: [{ name, text } | { name, bytes: ArrayBuffer }]. Resolves "done" | "stopped" | "timeout" | "failed". */
export function run({ files, main, stdin }, onEvent) {
  if (current) stop("stopped");
  if (!worker) spawn();
  return new Promise(resolve => {
    current = { onEvent, resolve, timer: null };
    const copy = files.map(f => f.bytes ? { name: f.name, bytes: f.bytes.slice(0) } : f);
    worker.postMessage({ type: "run", files: copy, main, stdin }, copy.filter(f => f.bytes).map(f => f.bytes));
  });
}

/** Stop the program right now (the worker is thrown away and reloads, from cache, on the next run). */
export function stop(why = "stopped") {
  if (!current) return;
  kill(); finish(why);
}
export const running = () => !!current;
