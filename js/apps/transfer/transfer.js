// Transfer: move files between your laptop and phone. Drop a file in (or paste,
// or tap to pick one) and it shows up on your other devices a few seconds later.
// Files clean themselves up after 7 days unless you pin them.
//
// The files and their records live in js/files.js (scope "transfer").
// Which files this device has already seen is kept per device (localStorage),
// so the red badge only counts what's new here.
import * as files from "../../files.js";
import * as sync from "../../sync.js";
import * as store from "../../store.js";
import { svg } from "../../icons.js";

const APP = "transfer", M = 60e3, H = 60 * M, D = 24 * H;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ago = t => { const m = Math.round((Date.now() - t) / M); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };
const iconFor = f => files.isPdf(f) ? "fileText" : files.isImage(f) ? "image" : "file";

function seen() { try { return new Set(JSON.parse(localStorage.getItem("transfer-seen") || "[]")); } catch (e) { return new Set(); } }
function markSeen(ids) { try { const s = seen(); ids.forEach(i => s.add(i)); localStorage.setItem("transfer-seen", JSON.stringify([...s].slice(-500))); } catch (e) { /* ignore */ } }
const fromHere = f => f.from === files.deviceName();

/* ---------- view ---------- */
let ctx0, root, poll = null, newIds = new Set();
const $ = s => root.querySelector(s);

async function send(list) {
  const arr = [...list].filter(Boolean); if (!arr.length) return;
  let ok = 0;
  for (const f of arr) {
    try { await files.add(f, { scope: "transfer" }); ok++; }
    catch (e) { ctx0.toast(`${f.name}: ${files.errorText(e)}`); }
  }
  if (ok) ctx0.toast(sync.signedIn() ? `Sending ${ok} file${ok === 1 ? "" : "s"} to your other devices.` : `Saved ${ok} file${ok === 1 ? "" : "s"} here. Sign in to sync to send them.`);
  render();
}

function statusText(f) {
  if (f.error) return { text: files.errorText({ message: f.error }), bad: true };
  if (!f.uploaded) return fromHere(f) ? { text: sync.signedIn() ? "Uploading…" : "Only on this device (sign in to send)" } : { text: `Waiting for ${f.from} to finish uploading` };
  return null;
}

function rowHtml(f) {
  const st = statusText(f), isNew = newIds.has(f.id);
  const left = f.expires && !f.pinned ? Math.max(0, Math.ceil((f.expires - Date.now()) / D)) : null;
  const meta = [fromHere(f) ? "From this device" : `From ${f.from}`, ago(f.created), files.sizeText(f.size), f.pinned ? "Pinned" : left !== null ? `deletes in ${left}d` : ""].filter(Boolean).join(" · ");
  return `<div class="ap-row tr-row ${isNew ? "new" : ""}" data-id="${esc(f.id)}">
    <span class="tr-thumb" data-thumb="${files.isImage(f) ? esc(f.id) : ""}">${svg(iconFor(f))}</span>
    <button class="grow tr-open" data-act="open"><span class="t">${esc(f.name)}${isNew ? ` <span class="ap-pill good">new</span>` : ""}</span>
      <span class="s ${st && st.bad ? "bad" : ""}">${esc(st ? st.text : meta)}</span></button>
    <button class="icon-btn" data-act="pin" aria-label="${f.pinned ? "Unpin" : "Pin, keep it"}" title="${f.pinned ? "Unpin" : "Pin: keep it past 7 days"}" aria-pressed="${!!f.pinned}">${svg("pin")}</button>
    <button class="icon-btn" data-act="save" aria-label="Download" title="Download">${svg("download")}</button>
    <button class="icon-btn" data-act="del" aria-label="Delete" title="Delete">${svg("trash2")}</button>
  </div>`;
}

import { latest } from "../../latest.js";
const render = latest(renderNow);
async function renderNow() {
  const all = await files.list({ scope: "transfer" });
  const s = seen();
  // new = not seen on this device before this visit; stays tagged until you leave Transfer
  for (const f of all) if (!fromHere(f) && !s.has(f.id)) newIds.add(f.id);
  const signed = sync.signedIn();
  $("#tr-body").innerHTML = `
    ${!sync.enabled ? `<div class="ap-card pad tr-warn"><b>Sync is off</b><span>Transfer needs sync to reach your other devices. Files you add stay on this device.</span></div>`
      : !signed ? `<div class="ap-card pad tr-warn"><b>Sign in to send files</b><span>Your phone and laptop both need to be signed in to the same account.</span><button class="pill-btn secondary" data-open="settings" style="align-self:flex-start">Sign in</button></div>` : ""}
    <label class="ap-card tr-drop" id="tr-drop" tabindex="0">
      <input type="file" id="tr-pick" multiple hidden>
      <span class="tr-drop-ic">${svg("upload")}</span>
      <b>Drop files here, or tap to choose</b>
      <span>You can also paste a screenshot with Ctrl+V. Up to 50 MB each.</span>
    </label>
    <section class="ap-sec"><h3>Files<span class="n">${all.length}</span></h3>
      ${all.length ? `<div class="ap-card">${all.map(rowHtml).join("")}</div>`
        : `<div class="ap-card"><div class="ap-empty"><b>Nothing here yet</b>Add a file on one device and it shows up on the other. Files delete themselves after ${files.TRANSFER_DAYS} days unless you pin them.</div></div>`}
    </section>
    <p class="ap-hint">This device is “${esc(files.deviceName())}”. Files stay private to your account.</p>`;
  $("#tr-pick").onchange = e => { send(e.target.files); e.target.value = ""; };
  loadThumbs();
  // seen once shown; the "new" tags stay until you leave
  markSeen([...newIds]);
}

async function loadThumbs() {
  for (const el of root.querySelectorAll("[data-thumb]")) {
    const id = el.dataset.thumb; if (!id || !(await files.hasLocal(id))) continue;
    try { const b = await files.blob(id), url = URL.createObjectURL(b); el.innerHTML = `<img src="${url}" alt="">`; el.querySelector("img").onload = () => URL.revokeObjectURL(url); } catch (e) { /* keep the icon */ }
  }
}

async function openFile(f) {
  if (files.isPdf(f) && (await import("../index.js")).default.some(a => a.id === "pdf")) { location.hash = `pdf/${encodeURIComponent(f.id)}`; return; }
  try { await files.openInTab(f.id); } catch (e) { ctx0.toast(files.errorText(e)); }
}

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./transfer.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = `<div class="ap-bar"><button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button><span class="ap-title">Transfer</span></div>
    <div class="ap-scroll"><div class="ap-body" id="tr-body"></div></div>`;
  el.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.closest("[data-id]").dataset.id, f = await files.get(id); if (!f) return render();
    const act = b.dataset.act;
    if (act === "open") openFile(f);
    else if (act === "save") { try { await files.download(id); } catch (err) { ctx0.toast(files.errorText(err)); } }
    else if (act === "pin") { await files.update(id, { pinned: !f.pinned }); ctx0.toast(f.pinned ? "Unpinned. It deletes 7 days after it was sent." : "Pinned. It stays until you delete it."); render(); }
    else if (act === "del") { if (!confirm(`Delete “${f.name}” from all your devices?`)) return; await files.remove(id); ctx0.toast("Deleted."); render(); }
  });
  // drag and drop anywhere on the app, and paste
  el.addEventListener("dragover", e => { if ([...(e.dataTransfer?.types || [])].includes("Files")) { e.preventDefault(); el.classList.add("tr-over"); } });
  el.addEventListener("dragleave", e => { if (e.target === el || !el.contains(e.relatedTarget)) el.classList.remove("tr-over"); });
  el.addEventListener("drop", e => { e.preventDefault(); el.classList.remove("tr-over"); send(e.dataTransfer.files); });
  document.addEventListener("paste", e => {
    if (!ctx0.isActive() || /input|textarea/i.test(document.activeElement?.tagName || "")) return;
    const fs = [...(e.clipboardData?.files || [])];
    if (fs.length) { e.preventDefault(); send(fs.map((f, i) => f.name && f.name !== "image.png" ? f : new File([f], `Pasted ${new Date().toLocaleString().replace(/[/:]/g, "-")}${i ? ` ${i + 1}` : ""}.png`, { type: f.type }))); }
  });
  store.onChange(ch => { if (ch.app === "files" && ctx.isActive()) { clearTimeout(rt); rt = setTimeout(render, 300); } });
  sync.onStatus(() => { if (ctx.isActive()) render(); });
}
let rt = null;

// while it's open, check for new files every few seconds instead of every minute
function show() { render(); clearInterval(poll); poll = setInterval(() => { if (ctx0.isActive() && document.visibilityState === "visible") sync.syncNow(); }, 5000); sync.syncNow(); }
function hide() { clearInterval(poll); newIds = new Set(); }

/** Red bubble: files from your other devices you haven't looked at here. */
async function badge() {
  const s = seen();
  const n = (await files.list({ scope: "transfer" })).filter(f => !fromHere(f) && !s.has(f.id)).length;
  return n || "";
}

export default { id: APP, name: "Transfer", icon: "arrowLeftRight", tint: "navy", mount, show, hide, badge };
