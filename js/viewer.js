// Full-screen viewer for files and notes. One at a time; Escape or the back button closes it.
//   openViewer({ title, sub, render(el), actions: [{ label, icon, run }] })
//   viewFile(id): images, text and code, audio and video show inside; anything else offers Download.
import { svg } from "./icons.js";
import * as files from "./files.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const TEXT = /\.(txt|md|csv|json|js|mjs|ts|py|java|c|cpp|h|cs|go|rs|rb|php|html|css|xml|yml|yaml|sql|sh|tex|log)$/i;
let current = null;

export function openViewer({ title, sub = "", render, actions = [], onClose }) {
  if (current) current.close();
  const el = document.createElement("div");
  el.className = "fv"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", title);
  el.innerHTML = `<div class="fv-bar">
      <button class="fv-back" data-fv="close" aria-label="Close">${svg("chevronLeft")}Back</button>
      <div class="fv-title"><b>${esc(title)}</b>${sub ? `<span>${esc(sub)}</span>` : ""}</div>
      <div class="fv-acts">${actions.map((a, i) => `<button class="fv-act" data-fv="${i}" title="${esc(a.label)}">${a.icon ? svg(a.icon) : ""}<span>${esc(a.label)}</span></button>`).join("")}</div>
    </div>
    <div class="fv-body"></div>`;
  document.body.appendChild(el);
  const body = el.querySelector(".fv-body");
  const cleanups = [];
  const close = () => {
    el.remove(); document.removeEventListener("keydown", onKey);
    cleanups.forEach(f => f()); if (current && current.el === el) current = null;
    if (onClose) onClose();
  };
  const onKey = e => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  el.addEventListener("click", e => {
    const k = e.target.closest("[data-fv]")?.dataset.fv; if (k == null) return;
    if (k === "close") return close();
    const a = actions[+k]; if (a) a.run({ close });
  });
  current = { el, close };
  render(body, { onCleanup: f => cleanups.push(f), close });
  el.querySelector(".fv-back").focus();
  return { close };
}

/** Show a saved file full screen. */
export async function viewFile(id, { toast } = {}) {
  const f = await files.get(id); if (!f) return;
  const type = f.type || "";
  openViewer({
    title: f.name, sub: files.sizeText(f.size),
    actions: [
      { label: "Download", icon: "download", run: () => files.download(id).catch(e => toast && toast(files.errorText(e))) },
      { label: "New tab", icon: "externalLink", run: () => files.openInTab(id).catch(e => toast && toast(files.errorText(e))) },
    ],
    async render(body, { onCleanup }) {
      body.innerHTML = `<div class="fv-wait">Opening…</div>`;
      let b;
      try { b = await files.blob(id); } catch (e) { body.innerHTML = `<div class="fv-msg"><b>Couldn't open this file</b><span>${esc(files.errorText(e))}</span></div>`; return; }
      const url = URL.createObjectURL(b); onCleanup(() => URL.revokeObjectURL(url));
      if (files.isImage(f)) body.innerHTML = `<div class="fv-media"><img src="${url}" alt="${esc(f.name)}"></div>`;
      else if (/^video\//.test(type)) body.innerHTML = `<div class="fv-media"><video src="${url}" controls></video></div>`;
      else if (/^audio\//.test(type)) body.innerHTML = `<div class="fv-media"><audio src="${url}" controls></audio></div>`;
      else if (/^text\/|json|xml|javascript/.test(type) || TEXT.test(f.name)) {
        const text = await b.text();
        body.innerHTML = `<pre class="fv-text"></pre>`; body.querySelector("pre").textContent = text;
      } else body.innerHTML = `<div class="fv-msg">${svg("file")}<b>${esc(f.name)}</b><span>This kind of file can't be shown here. Download it or open it in a new tab.</span></div>`;
    },
  });
}
