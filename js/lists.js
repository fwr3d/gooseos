// Lists: every dated thing belongs to one (School, Frat, Personal, Money, or
// one you made). Deadlines, Today, Reminders and the calendar feed filter by them.
//
// Saved items (app "lists"), one per list you changed or added:
//   <id>: { name, color, order, removed? }
//   The four starter lists exist even with nothing saved. Saving one renames or
//   recolors it. removed: true hides a list you made (its items fall back to Personal).
//
// An item's list: its own `list` field if it has one, otherwise School when it
// has a course and Personal when it doesn't. Old items need no migrating.
import * as store from "./store.js";

const APP = "lists";
export const STARTERS = {
  school: { name: "School", color: "#2f5bea", order: 0 },
  frat: { name: "Frat", color: "#8b5cf6", order: 1 },
  personal: { name: "Personal", color: "#22a45d", order: 2 },
  money: { name: "Money", color: "#e08a00", order: 3 },
};
export const COLORS = ["#2f5bea", "#8b5cf6", "#22a45d", "#e08a00", "#e5484d", "#0e9fb0", "#db2777", "#64748b"];

/** Every list, in order: [{ id, name, color, starter }] */
export async function loadLists() {
  const saved = new Map((await store.list(APP)).filter(r => r.data).map(r => [r.id, r.data]));
  const out = [];
  for (const [id, s] of Object.entries(STARTERS)) out.push({ id, ...s, ...(saved.get(id) || {}), starter: true });
  for (const [id, d] of saved) if (!STARTERS[id] && !d.removed && d.name) out.push({ id, color: COLORS[7], order: 99, ...d, starter: false });
  return out.sort((a, b) => a.order - b.order);
}

/** Which list an item is in. Pass the loaded lists so a deleted list falls back to Personal. */
export function listOf(item, lists) {
  const id = item && item.list;
  if (id && (!lists || lists.some(l => l.id === id))) return id;
  return item && item.course ? "school" : "personal";
}

export const byId = (lists, id) => lists.find(l => l.id === id) || lists.find(l => l.id === "personal");

/** "frat" / "#frat" / "Frat" → the list, or null. */
export function matchList(word, lists) {
  const w = String(word || "").toLowerCase().replace(/^#/, "").replace(/[,.:]$/, "");
  if (!w) return null;
  return lists.find(l => l.id === w || l.name.toLowerCase() === w) || null;
}

export async function saveList(id, data) {
  const cur = (await store.get(APP, id)) || {};
  await store.put(APP, id, { ...cur, ...data });
}
export async function addList(name, color) {
  const lists = await loadLists();
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "list";
  let id = base, n = 2;
  while (lists.some(l => l.id === id) || await store.get(APP, id)) id = `${base}-${n++}`;
  await store.put(APP, id, { name, color: color || COLORS[lists.length % COLORS.length], order: Math.max(...lists.map(l => l.order)) + 1 });
  return id;
}
export async function removeList(id) {
  if (STARTERS[id]) return;
  await saveList(id, { removed: true });
}
