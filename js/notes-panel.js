// Notes panel: a study guide or practice questions from a milestone's workspace,
// shown beside your work (Whiteboard, PDF editor). On a phone it's a sheet at the
// bottom you can drag taller or shorter.
//
// Each board or PDF keeps its own state, passed in through get()/set():
//   { doc: the doc id it was showing, ref: true while the panel is open }
// The docs are store app "docs" items owned by "milestones:<mid>[:<step id>]", plus
// markdown and text files attached to a milestone (id "file:<file id>", kind "file").
import * as store from "./store.js";
import * as files from "./files.js";
import { svg } from "./icons.js";
import { renderMd, KINDS } from "./apps/milestones/workspace.js";

const NOTE_FILE = /\.(md|markdown|txt)$/i;
const isNoteFile = f => /markdown|^text\/plain/i.test(f.type || "") || NOTE_FILE.test(f.name || "");
/** "b1_t2_domain_range.md" → "Domain range" (short codes like b1, t2, 03 up front are dropped) */
const fileTitle = n => {
  const base = String(n || "").replace(NOTE_FILE, "").replace(/[_-]+/g, " ").trim();
  const t = base.replace(/^(?:[a-z]?\d+[a-z]?\s+)+/i, "") || base;
  return t ? t[0].toUpperCase() + t.slice(1) : "Untitled";
};
/** Docs newest first, then files in name order (so t1, t2, … stay in sequence). */
const byOrder = (a, b) => (a.kind === "file") - (b.kind === "file")
  || (a.kind === "file" ? a.name.localeCompare(b.name, undefined, { numeric: true }) : (b.updated || 0) - (a.updated || 0));
const textCache = new Map();
async function fileBody(d) {
  if (!textCache.has(d.fileId)) textCache.set(d.fileId, files.blob(d.fileId).then(b => b.text()).catch(e => { textCache.delete(d.fileId); throw e; }));
  return textCache.get(d.fileId);
}

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const shortDate = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const ICON = { note: "fileText", guide: "notebook", questions: "circleHelp" };
const PHONE = "(max-width: 899px)";

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./notes-panel.css", import.meta.url).href;
  document.head.appendChild(link);
}

/** Every milestone doc, with its milestone and step title. */
export async function loadNotes() {
  const [d, m, f] = await Promise.all([store.list("docs").catch(() => []), store.list("milestones").catch(() => []), files.list({ owner: "milestones" }).catch(() => [])]);
  const ms = new Map(m.filter(r => r.data && r.data.title).map(r => [r.id, r.data]));
  const place = owner => {
    const [, mid, sid] = String(owner).split(":"), mm = ms.get(mid);
    const step = mm && sid && (mm.steps || []).find(x => x.id === sid);
    return { ms: mm, mid, step: step ? step.title : "" };
  };
  const docs = [
    ...d.filter(r => r.data && String(r.data.owner || "").startsWith("milestones:")).map(r => ({ id: r.id, ...r.data, ...place(r.data.owner) })),
    ...f.filter(isNoteFile).map(x => ({ id: "file:" + x.id, fileId: x.id, kind: "file", title: fileTitle(x.name), name: x.name, updated: x.created, ...place(x.owner) })),
  ].filter(x => x.ms);
  return { docs, ms };
}

/**
 * host: the app's root element (gets class "np-open" while open, and the phone sheet height)
 * panel: an empty <aside> for the panel · button: the toggle button (aria-pressed)
 * get(): this board/PDF's { doc, ref } · set(patch): save changes to it
 * key: localStorage key for the phone sheet height
 */
export function notesPanel({ host, panel, button, get, set, key }) {
  loadCss();
  let notes = null, list = false;
  panel.classList.add("np"); panel.hidden = true; panel.setAttribute("aria-label", "Notes");
  try { const h = localStorage.getItem(key); if (h) host.style.setProperty("--np-h", h); } catch (_) { /* ignore */ }

  async function paint() {
    const st = get() || {}, open = !!st.ref;
    host.classList.toggle("np-open", open); panel.hidden = !open;
    if (button) button.setAttribute("aria-pressed", String(open));
    if (!open) return;
    if (!notes) notes = await loadNotes();
    const doc = !list && st.doc && notes.docs.find(d => d.id === st.doc);
    const close = `<button class="icon-btn" data-np="close" aria-label="Close notes" title="Close">${svg("x")}</button>`;
    const grab = `<div class="np-grab" data-np="grab" aria-hidden="true"></div>`;
    if (doc) {
      const sub = [doc.kind === "file" ? "File" : KINDS[doc.kind] || "Note", doc.ms.title, doc.step].filter(Boolean).join(" · ");
      const isFile = doc.kind === "file";
      panel.innerHTML = `${grab}<div class="np-h"><button class="icon-btn" data-np="list" aria-label="All notes" title="All notes">${svg("chevronLeft")}</button>
        <div class="np-t"><b>${esc(doc.title)}</b><span>${esc(sub)}</span></div>${close}</div>
        <div class="np-b"><article class="fv-doc ws-md np-doc">${isFile ? `<p class="np-dim">Loading…</p>` : renderMd(doc.body || "") || `<p class="np-dim">Nothing written yet.</p>`}</article></div>`;
      if (isFile) {
        const art = panel.querySelector(".np-doc"), want = doc.id;
        let html;
        try {
          const text = await fileBody(doc);
          html = /\.txt$/i.test(doc.name) ? `<pre class="np-pre">${esc(text)}</pre>` : renderMd(text) || `<p class="np-dim">This file is empty.</p>`;
        } catch (e) { html = `<p class="np-dim">Couldn't open this file. ${esc(files.errorText(e))}</p>`; }
        if (art.isConnected && (get() || {}).doc === want) art.innerHTML = html;
      }
      return;
    }
    // every milestone that has docs, upcoming first, then the rest newest first
    const day = new Date().setHours(0, 0, 0, 0), groups = new Map();
    for (const d of notes.docs) { if (!groups.has(d.mid)) groups.set(d.mid, []); groups.get(d.mid).push(d); }
    const order = [...groups.keys()].sort((a, b) => {
      const A = notes.ms.get(a).due || 0, B = notes.ms.get(b).due || 0, ua = A >= day, ub = B >= day;
      return ua !== ub ? (ua ? -1 : 1) : ua ? A - B : B - A;
    });
    const row = d => `<button class="np-row ${d.id === st.doc ? "on" : ""}" data-doc="${esc(d.id)}">${svg(ICON[d.kind] || "fileText")}
      <span class="np-t"><b>${esc(d.title)}</b><span>${esc([d.kind === "file" ? "File" : KINDS[d.kind] || "Note", d.step].filter(Boolean).join(" · "))}</span></span></button>`;
    panel.innerHTML = `${grab}<div class="np-h"><div class="np-t"><b>Notes</b><span>Study guides, questions and notes from your milestones</span></div>${close}</div>
      <div class="np-b">${order.length ? order.map(mid => {
        const m = notes.ms.get(mid), l = groups.get(mid).sort(byOrder);
        return `<div class="np-g"><h5>${esc(m.title)}<small>${esc([m.course, m.due ? shortDate(m.due) : ""].filter(Boolean).join(" · "))}</small></h5>${l.map(row).join("")}</div>`;
      }).join("") : `<p class="np-empty">No notes yet. Add a study guide or practice questions in a milestone's workspace and they'll show up here.</p>`}</div>`;
  }
  async function toggle() { await set({ ref: !(get() || {}).ref }); paint(); }
  panel.addEventListener("click", async e => {
    const d = e.target.closest("[data-doc]"), a = e.target.closest("[data-np]");
    if (d) { list = false; await set({ doc: d.dataset.doc }); await paint(); const b = panel.querySelector(".np-b"); if (b) b.scrollTop = 0; return; }
    if (!a) return;
    if (a.dataset.np === "list") { list = true; paint(); }
    if (a.dataset.np === "close") { await set({ ref: false }); paint(); }
  });
  // on a phone, drag the handle (or the header) to make the sheet taller or shorter
  panel.addEventListener("pointerdown", e => {
    if (!e.target.closest('[data-np="grab"]') && !(e.target.closest(".np-h") && !e.target.closest("button"))) return;
    if (!matchMedia(PHONE).matches) return;
    const y0 = e.clientY, h0 = panel.offsetHeight;
    const move = ev => host.style.setProperty("--np-h", Math.min(innerHeight * 0.9, Math.max(140, h0 + y0 - ev.clientY)) + "px");
    const up = () => { removeEventListener("pointermove", move); removeEventListener("pointerup", up); try { localStorage.setItem(key, host.style.getPropertyValue("--np-h")); } catch (_) { /* ignore */ } };
    addEventListener("pointermove", move); addEventListener("pointerup", up);
    e.preventDefault();
  });
  store.onChange(ch => { if ((ch.app === "docs" || ch.app === "milestones" || ch.app === "files") && notes) { notes = null; if (!panel.hidden) paint(); } });
  return {
    paint,
    toggle,
    /** Notes may have changed elsewhere: reload them next time. */
    refresh() { notes = null; list = false; return paint(); },
  };
}

/** The toggle button's inside, for a toolbar. */
export const notesButton = (cls = "") => `<button class="np-btn ${cls}" aria-pressed="false" title="Study guides, questions and notes from your milestones">${svg("notebook")}<span>Notes</span></button>`;
