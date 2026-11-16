// The GooseOS shell: home screen (clock, widgets, app grid, dock), opening and
// closing apps, install tips, offline support and the Settings sheet.
import apps from "./apps/index.js";
import * as store from "./store.js";
import * as sync from "./sync.js";
import { svg } from "./icons.js";
import * as capture from "./capture.js";
import * as feed from "./feed.js";
import { renderHome as drawHome, pickerHtml, wirePicker } from "./home.js";

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

/* ---------- system app: Settings ---------- */
const SETTINGS = { id: "settings", name: "Settings", icon: "settings", color: ["#8e9aaf", "#5b667a"], dock: true, system: true };
const allIcons = () => [...apps, SETTINGS];
const tileStyle = a => `background:linear-gradient(160deg,${a.color[0]},${a.color[1]})`;

/* ---------- home (layout lives in home.js) ---------- */
let syncState = { status: "off" };
const SYNC_TEXT = { off: "Saved on this device", "signed-out": "Tap to turn on sync", syncing: "Syncing…", synced: "Synced", offline: "Offline · will sync later", error: "Sync problem · tap" };
const SYNC_DOT = { synced: "ok", syncing: "busy", offline: "busy", error: "err" };
async function renderHome() {
  await drawHome({ settingsApp: SETTINGS, syncState, syncText: SYNC_TEXT[syncState.status] || "", syncDot: SYNC_DOT[syncState.status] || "" });
}
let goT = null;
function renderGooseWidget() { if (current) return; clearTimeout(goT); goT = setTimeout(renderHome, 200); }

/* ---------- opening and closing apps ---------- */
const views = new Map();
let current = "";
let openedFromHome = false;

// "#events/abc" opens the events app and hands "abc" to its show(arg)
async function show(hash) {
  const [id, ...rest] = hash.split("/");
  const arg = rest.join("/");
  if (id === "settings") { history.replaceState(null, "", location.pathname + location.search); openSettings(); return; }
  const app = apps.find(a => a.id === id);
  if (current && current !== id) hideCurrent();
  if (!app) { current = ""; $("#home").hidden = false; renderHome(); return; }
  let el = views.get(id);
  if (!el) {
    el = document.createElement("section"); el.className = "view"; el.dataset.app = id; el.setAttribute("aria-label", app.name);
    $("#views").appendChild(el); views.set(id, el);
    await app.mount(el, { store, toast, svg, isActive: () => current === id });
  }
  current = id;
  $("#home").hidden = true; el.hidden = false;
  if (app.show) app.show(arg);
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
  if (o) { if (o.dataset.open === "settings") { openSettings(); return; } openedFromHome = true; location.hash = o.dataset.open; return; }
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
  showInstall("Install GooseOS for your Start menu or home screen. Works offline.", true);
});
$("#install-btn").onclick = async () => {
  if (!deferredPrompt) return;
  deferredPrompt.prompt(); await deferredPrompt.userChoice.catch(() => null);
  deferredPrompt = null; $("#install").hidden = true;
};
$("#install-dismiss").innerHTML = svg("x");
$("#install-dismiss").onclick = () => { $("#install").hidden = true; try { localStorage.setItem("install-dismissed", "1"); } catch (e) { /* ignore */ } };
window.addEventListener("appinstalled", () => { $("#install").hidden = true; toast("Installed. Open it from your home screen or Start menu."); });
if (isIOS && !standalone) showInstall("To install: tap Share in Safari, then “Add to Home Screen”.", false);

/* ---------- offline support + updates ---------- */
if ("serviceWorker" in navigator) {
  window.addEventListener("load", async () => {
    try {
      // Only offer updates when an older version was already running this page
      // (not on the very first visit, when the offline copy is just being saved).
      const hadController = !!navigator.serviceWorker.controller;
      const reg = await navigator.serviceWorker.register("sw.js");
      let wantReload = false;
      const offer = w => toast("An update is ready.", { label: "Reload", run: () => { wantReload = true; w.postMessage("skipWaiting"); } });
      if (hadController && reg.waiting) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        w && w.addEventListener("statechange", () => { if (w.state === "installed" && hadController) offer(w); });
      });
      navigator.serviceWorker.addEventListener("controllerchange", () => { if (wantReload) { wantReload = false; location.reload(); } });
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => {}); });
    } catch (e) { console.warn("Offline support unavailable", e); }
  });
}

/* ---------- Settings sheet ---------- */
function openSheet() { $("#sheet").hidden = false; }
function closeSheet() { $("#sheet").hidden = true; }
$("#sheet-close").innerHTML = svg("x");
$("#sheet-close").onclick = closeSheet;
$("#sheet").addEventListener("click", e => { if (e.target.id === "sheet") closeSheet(); });
document.addEventListener("keydown", e => { if (e.key === "Escape" && !$("#sheet").hidden) closeSheet(); });

function openSettings() { drawSettings(); openSheet(); }
// Hidden apps stay off the home screen; this is the one place to open them.
function hiddenRows() {
  const hid = apps.filter(a => a.hidden);
  if (!hid.length) return "";
  return `<div class="group-h">Hidden apps</div><div class="group">${hid.map(a =>
    `<button class="row row-btn" data-hidden-open="${a.id}"><span class="tile-ic" style="${tileStyle(a)}">${svg(a.icon)}</span><div class="grow"><div class="t">${esc(a.name)}</div><div class="s">Not on your home screen</div></div></button>`).join("")}</div>`;
}
document.addEventListener("click", e => {
  const b = e.target.closest("[data-hidden-open]");
  if (b) { closeSheet(); openedFromHome = true; location.hash = b.dataset.hiddenOpen; }
});
function drawSettings() {
  $("#sheet-title").textContent = "Settings";
  const s = syncState, signedIn = s.email && s.status !== "signed-out";
  const syncRow = s.status === "off"
    ? `<div class="row"><span class="tile-ic" style="background:#8e9aaf">${svg("cloudOff")}</span><div class="grow"><div class="t">Sync is off</div><div class="s">Everything is saved on this device.</div></div></div>`
    : signedIn
      ? `<div class="row"><span class="tile-ic" style="background:#22a45d">${svg("cloud")}</span><div class="grow"><div class="t">${esc(SYNC_TEXT[s.status])}</div><div class="s">${esc(s.email)}</div></div></div>
         ${s.status === "error" ? `<div class="row"><div class="grow err">${esc(s.error || "Something went wrong.")}</div></div>` : ""}
         <button class="row row-btn" id="st-sync"><span class="tile-ic" style="background:#2348c9">${svg("refreshCw")}</span><div class="grow t">Sync now</div></button>
         <button class="row row-btn danger" id="st-out"><span class="tile-ic" style="background:#e5484d">${svg("logOut")}</span><div class="grow t">Sign out</div></button>`
      : `<button class="row row-btn" id="st-in"><span class="tile-ic" style="background:#2348c9">${svg("cloud")}</span><div class="grow"><div class="t">Sign in to sync</div><div class="s">Keep your PC and iPhone in step.</div></div></button>`;
  const installRow = standalone ? "" : `<div class="group-h">Install</div><div class="group"><div class="row"><span class="tile-ic" style="background:#ff9f1c">${svg("download")}</span><div class="grow"><div class="t">Get GooseOS as an app</div><div class="s">${isIOS ? "In Safari: Share → Add to Home Screen" : deferredPrompt ? "Adds it to your Start menu" : "Use your browser's Install option"}</div></div>${deferredPrompt ? `<button class="pill-btn" id="st-install">Install</button>` : ""}</div></div>`;
  $("#sheet-body").innerHTML = `
    <div class="group-h">Sync</div><div class="group">${syncRow}</div>
    <div id="st-home"></div>
    ${installRow}
    ${hiddenRows()}
    <div class="group-h">About</div>
    <div class="group"><div class="row"><img src="icons/apple-touch-icon.png" alt="" width="30" height="30" style="border-radius:8px"><div class="grow"><div class="t">GooseOS</div><div class="s">Your school home screen. Icons by Lucide.</div></div></div></div>`;
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on("#st-in", () => drawSignIn());
  on("#st-sync", () => { sync.syncNow(); toast("Syncing…"); });
  on("#st-out", async () => { await sync.signOut(); toast("Signed out. Your stuff is still on this device."); drawSettings(); });
  on("#st-install", () => $("#install-btn").click());
  // pick which widgets the home screen shows
  pickerHtml().then(html => { const box = $("#st-home"); if (!box) return; box.innerHTML = html; wirePicker(box, () => { toast("Home screen updated"); renderHome(); }); });
}

let pendingEmail = "";
function drawSignIn(step) {
  const creating = step === "create";
  $("#sheet-title").textContent = creating ? "Make your account" : "Sign in";
  $("#sheet-body").innerHTML = `<p>${creating
      ? "Pick an email and a password. You'll use them on your PC and your iPhone."
      : "Use the same email and password on your PC and your iPhone, and everything stays in sync."}</p>
    <form id="s-form">
      <input class="field" id="s-email" type="email" autocomplete="email" inputmode="email" placeholder="Email" required value="${esc(pendingEmail)}" aria-label="Email">
      <input class="field" id="s-pass" type="password" autocomplete="${creating ? "new-password" : "current-password"}" placeholder="${creating ? "Password (at least 6 characters)" : "Password"}" minlength="6" required aria-label="Password">
      <button class="pill-btn" type="submit" id="s-go">${creating ? "Make account and sign in" : "Sign in"}</button>
      <span class="err" id="s-err"></span>
      <button class="link-btn" type="button" id="s-switch">${creating ? "I already have an account" : "First time? Make an account"}</button>
      <button class="link-btn" type="button" id="s-back" style="color:var(--muted)">Back to Settings</button>
    </form>`;
  $(pendingEmail ? "#s-pass" : "#s-email").focus();
  $("#s-switch").onclick = () => { pendingEmail = $("#s-email").value.trim(); drawSignIn(creating ? "" : "create"); };
  $("#s-back").onclick = drawSettings;
  $("#s-form").onsubmit = async e => {
    e.preventDefault();
    pendingEmail = $("#s-email").value.trim();
    const go = $("#s-go"), label = go.textContent;
    go.disabled = true; go.textContent = creating ? "Making account…" : "Signing in…"; $("#s-err").textContent = "";
    try {
      if (creating) await sync.createAccount(pendingEmail, $("#s-pass").value);
      else await sync.signIn(pendingEmail, $("#s-pass").value);
      closeSheet(); toast("Signed in. Syncing your stuff.");
    } catch (err) { $("#s-err").textContent = friendly(err); go.disabled = false; go.textContent = label; }
  };
}
function friendly(err) {
  const m = (err && err.message) || "";
  if (err && err.code === "confirm_email_on") return "Account made, but Supabase wants to confirm it by email first. In Supabase, turn off Authentication → Sign In / Providers → “Confirm email”, then sign in.";
  if (/invalid login credentials/i.test(m)) return "Wrong email or password. First time here? Tap “Make an account”.";
  if (/already registered|already exists/i.test(m)) return "There's already an account with this email. Tap “I already have an account” and sign in.";
  if (/email not confirmed/i.test(m)) return "This account isn't confirmed yet. In Supabase, turn off “Confirm email”, or confirm it under Authentication → Users.";
  if (/signups not allowed|signup.*disabled/i.test(m)) return "New accounts are turned off for GooseOS. Sign in with your existing account.";
  if (/password/i.test(m) && /least|short|weak/i.test(m)) return "That password is too short or too simple. Use at least 6 characters.";
  if (/rate|too many|seconds/i.test(m)) return "Too many tries. Wait a minute and try again.";
  if (!navigator.onLine) return "You're offline. Connect to the internet to sign in.";
  return m || "Something went wrong. Try again.";
}

/* ---------- quick capture ---------- */
capture.init({ toast });
document.addEventListener("click", e => { if (e.target.closest("[data-quick]")) capture.open(); });

/* ---------- start ---------- */
tick(); setInterval(tick, 10000);
setInterval(() => { if (!current) renderGooseWidget(); }, 5 * 60000);
store.askPersistent();
route();
// background jobs (Reminders' scheduler) run whether or not their view is open
for (const a of apps) if (a.start) { try { a.start({ store, toast, svg }); } catch (e) { console.error(e); } }
sync.onStatus(s => {
  syncState = s;
  if (!current) renderGooseWidget();
  if (!$("#sheet").hidden && $("#sheet-title").textContent === "Settings") drawSettings();
});
sync.start();
feed.start();
let homeT = null;
store.onChange(() => { if (!current) { clearTimeout(homeT); homeT = setTimeout(renderHome, 300); } });
