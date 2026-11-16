// One list of everything with a date, from every app.
// An app joins by exporting:
//   agenda()      -> [{ key, title, due, kind, course?, done, open? }]
//                    key:  unique everywhere, starts with the app id ("deadlines:d-abc")
//                    due:  ms since epoch (or null for "no date")
//                    kind: "deadline" | "step" | "task" | ...
//                    open: hash to open it, like "#deadlines"
//                    loud: true lets a ping buzz in quiet hours and during class (timers you just started)
//   complete(key) -> marks that item done
// Hidden apps are left out. Reminders and Today read only this list.
import apps from "./apps/index.js";
import * as store from "./store.js";

let cache = null;
store.onChange(() => { cache = null; });

async function collect() {
  const out = [];
  await Promise.all(apps.filter(a => a.agenda && !a.hidden).map(async a => {
    try {
      for (const it of (await a.agenda()) || []) {
        if (!it || !it.key) continue;
        out.push({ kind: "item", done: false, ...it, app: a.id, appName: a.name, open: it.open || `#${a.id}` });
      }
    } catch (e) { console.error(`agenda from ${a.id} failed`, e); }
  }));
  out.sort((a, b) => (a.due ?? Infinity) - (b.due ?? Infinity));
  return out;
}

/** Every open item, soonest first. Pass { done: true } to include finished ones. */
export async function list(opts = {}) {
  if (!cache) cache = collect();
  const all = await cache;
  return opts.done ? all : all.filter(i => !i.done);
}

/** Mark one item done in the app it came from. */
export async function complete(key) {
  const app = apps.find(a => a.id === String(key).split(":")[0]);
  if (!app || !app.complete) return false;
  await app.complete(key);
  cache = null;
  return true;
}

export function refresh() { cache = null; }
