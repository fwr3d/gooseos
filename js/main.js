// The GooseOS shell: home screen, opening and closing apps, install tips,
// offline support and the sync sign-in sheet.
import apps from "./apps/index.js";
import * as store from "./store.js";
import * as sync from "./sync.js";

const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- toast ---------- */
let toastT = null;
function toast(msg, action) {
  let t = $(".toast");
  if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
  t.innerHTML = `<span>${esc(msg)}</span>`;
  if (action) { const b = document.createElement("button"); b.textContent = action.label; b.onclick = action.run; t.appendChild(b); }
  t.hidden = false; clearTimeout(toastT);
  if (!action) toastT = setTimeout(() => (t.hidden = true), 2600);
}

/* ---------- clock ---------- */
function tick() {
  const n = new Date();
  $("#time").textContent = n.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }).replace(/\s?[AP]M$/i, "");
  $("#date").textContent = n.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

/* ---------- home grid ---------- */
async function renderGrid() {
  const icons = await Promise.all(apps.map(async a => {
    let badge = "";
    try { badge = a.badge ? (await a.badge()) || "" : ""; } catch (e) { badge = ""; }
    const style = `background:${a.iconBg || "var(--accent)"};${a.iconBorder ? `border:1px solid ${a.iconBorder};` : ""}`;
    return `<button class="app-ic" data-open="${a.id}"><span class="sq" style="${style}">${a.icon}${badge ? `<span class="badge">${esc(badge)}</span>` : ""}</span><span class="lb">${esc(a.name)}</span></button>`;
  }));
  $("#apps").innerHTML = icons.join("");
}

/* ---------- opening and closing apps ---------- */
const views = new Map(); // id -> section element
let current = "";
let openedFromHome = false;

async function show(id) {
  const app = apps.find(a => a.id === id);
  if (current && current !== id) hideCurrent();
  if (!app) { current = ""; $("#home").hidden = false; renderGrid(); return; }
  let el = views.get(id);
  if (!el) {
    el = document.createElement("section"); el.className = "view"; el.dataset.app = id; el.setAttribute("aria-label", app.name);
    $("#views").appendChild(el); views.set(id, el);
    await app.mount(el, { store, toast, isActive: () => current === id });
  }
  current = id;
  $("#home").hidden = true; el.hidden = false;
  if (app.show) app.show();
}
function hideCurrent() {
  const app = apps.find(a => a.id === current), el = views.get(current);
  if (app && app.hide) app.hide();
  if (el) el.hidden = true;
}
function route() { show(location.hash.slice(1)); }
function goHome() {
  if (openedFromHome) { openedFromHome = false; history.back(); }
  else { history.replaceState(null, "", location.pathname + location.search); route(); }
}
document.addEventListener("click", e => {
  const o = e.target.closest("[data-open]");
  if (o) { openedFromHome = true; location.hash = o.dataset.open; return; }
  if (e.target.closest("[data-home]")) goHome();
});
window.addEventListener("hashchange", route);

/* ---------- install tips ---------- */
const standalone = matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
function dismissed() { try { return localStorage.getItem("install-dismissed") === "1"; } catch (e) { return false; } }
let deferredPrompt = null;
function showInstall(text, withButton) {
  if (standalone || dismissed()) return;
  $("#install-text").textContent = text; $("#install-btn").hidden = !withButton; $("#install").hidden = false;
}
window.addEventListener("beforeinstallprompt", e => {
  e.preventDefault(); deferredPrompt = e;
  showInstall("Install GooseOS to get it in your Start menu or home screen. It works offline too.", true);
});
$("#install-btn").onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null; $("#install").hidden = true;
};
$("#install-dismiss").onclick = () => { $("#install").hidden = true; try { localStorage.setItem("install-dismissed", "1"); } catch (e) { /* ignore */ } };
window.addEventListener("appinstalled", () => { $("#install").hidden = true; toast("Installed. Open it from your home screen or Start menu."); });
if (isIOS && !standalone) showInstall("To install: tap the Share button in Safari, then “Add to Home Screen”.", false);

/* ---------- offline support + updates ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      const reg = await navigator.serviceWorker.register("sw.js");
      const offer = w => toast("An update is ready.", { label: "Reload", run: () => w.postMessage("skipWaiting") });
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => { if (w.state === "installed" && navigator.serviceWorker.controller) offer(w); });
      });
      let reloaded = false;
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (!reloaded) { reloaded = true; location.reload(); } });
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
    } catch (e) { console.warn("Offline support unavailable", e); }
  });
}

/* ---------- account / sync sheet ---------- */
const LABELS = { "signed-out": "Sign in to sync", syncing: "Syncing…", synced: "Synced", offline: "Offline · will sync later", error: "Sync problem" };
let syncState = null;
function renderAccount(s) {
  syncState = s;
  const btn = $("#account");
  if (s.status === "off") { btn.hidden = true; return; }
  btn.hidden = false;
  btn.className = "account " + ({ synced: "ok", syncing: "busy", offline: "busy", error: "err" }[s.status] || "");
  btn.querySelector("span").textContent = s.status === "synced" && s.email ? `Synced · ${s.email}` : LABELS[s.status] || "";
}
function openSheet() { $("#sheet").hidden = false; drawSheet(); }
function closeSheet() { $("#sheet").hidden = true; }
$("#account").onclick = openSheet;
$("#sheet-close").onclick = closeSheet;
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

let pendingEmail = "";
function drawSheet(step) {
  const body = $("#sheet-body");
  if (syncState && syncState.email && syncState.status !== "signed-out") {
    $("#sheet-title").textContent = "Syncing is on";
    body.innerHTML = `<p>Signed in as <b>${esc(syncState.email)}</b>. Everything you make syncs to your other devices signed in with this email.</p>
      ${syncState.status === "error" ? `<p class="err">Last sync failed: ${esc(syncState.error || "unknown error")}</p>` : ""}
      <div class="row" style="display:flex;gap:8px"><button class="btn primary" id="s-sync">Sync now</button><button class="btn" id="s-out">Sign out</button></div>
      <p>Signing out keeps everything on this device. It just stops syncing.</p>`;
    $("#s-sync").onclick = () => { sync.syncNow(); toast("Syncing…"); };
    $("#s-out").onclick = async () => { await sync.signOut(); closeSheet(); toast("Signed out. Your stuff is still on this device."); };
    return;
  }
  $("#sheet-title").textContent = "Sync your stuff";
  if (step !== "code") {
    body.innerHTML = `<p>Sign in on your PC and your iPhone with the same email, and everything stays in sync. We'll email you a 6-digit code.</p>
      <form id="s-email-f"><input class="field" id="s-email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com" required value="${esc(pendingEmail)}">
      <button class="btn primary" type="submit" id="s-send">Email me a code</button><span class="err" id="s-err"></span></form>`;
    $("#s-email").focus();
    $("#s-email-f").onsubmit = async e => {
      e.preventDefault(); pendingEmail = $("#s-email").value.trim();
      $("#s-send").disabled = true; $("#s-send").textContent = "Sending…";
      try { await sync.sendCode(pendingEmail); drawSheet("code"); }
      catch (err) { $("#s-err").textContent = friendly(err); $("#s-send").disabled = false; $("#s-send").textContent = "Email me a code"; }
    };
  } else {
    body.innerHTML = `<p>We sent a code to <b>${esc(pendingEmail)}</b>. Type it here. It can take a minute to arrive, so check spam too.</p>
      <form id="s-code-f"><input class="field code-in" id="s-code" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" required>
      <button class="btn primary" type="submit" id="s-verify">Sign in</button><span class="err" id="s-err"></span>
      <button class="btn ghost" type="button" id="s-back">Use a different email</button></form>`;
    $("#s-code").focus();
    $("#s-back").onclick = () => drawSheet();
    $("#s-code-f").onsubmit = async e => {
      e.preventDefault(); $("#s-verify").disabled = true; $("#s-verify").textContent = "Checking…";
      try { await sync.verifyCode(pendingEmail, $("#s-code").value.replace(/\s/g, "")); closeSheet(); toast("Signed in. Syncing your stuff."); }
      catch (err) { $("#s-err").textContent = friendly(err); $("#s-verify").disabled = false; $("#s-verify").textContent = "Sign in"; }
    };
  }
}
function friendly(err) {
  const m = (err && err.message) || "";
  if (/expired|invalid/i.test(m)) return "That code didn't work. Check it, or go back and send a new one.";
  if (/rate|too many|seconds/i.test(m)) return "Too many tries. Wait a minute and try again.";
  if (!navigator.onLine) return "You're offline. Connect to the internet to sign in.";
  return m || "Something went wrong. Try again.";
}

/* ---------- start ---------- */
tick(); setInterval(tick, 10000);
store.askPersistent();
route();
sync.onStatus(renderAccount);
sync.start();
store.onChange(() => { if (!current) renderGrid(); });
