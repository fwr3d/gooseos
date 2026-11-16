// Laundry Timer: one tap starts a washer or dryer timer. You get a ping when
// it's done and another 10 minutes later if you haven't said you took it out.
// The pings go through Reminders like everything else, marked "loud" so they
// still buzz in quiet hours (you started the load, you want to know).
//
// Saved items (app "laundry"):
//   "settings":        { washer: minutes, dryer: minutes }   your machines' usual times
//   "washer", "dryer": { start, end (ms), min, out }          the current load
//                      out: true once you tap "Got it out". A load nobody
//                      collected stops counting 3 hours after it finished.
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import * as notify from "../../notify.js";

const APP = "laundry", M = 60e3, NUDGE = 10 * M, STALE = 3 * 3600e3;
const KINDS = {
  washer: { label: "Washer", icon: "washingMachine", def: 30, done: "Washer's done", body: "Move it to the dryer before someone else does.", again: "Still in the washer" },
  dryer: { label: "Dryer", icon: "wind", def: 45, done: "Dryer's done", body: "Grab it before it wrinkles.", again: "Still in the dryer" },
};
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clock = t => new Date(t).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const minsLeft = ms => Math.max(1, Math.ceil(ms / M));
const ago = ms => { const m = Math.floor(ms / M); return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`; };

/* ---------- data ---------- */
async function getSettings() { const s = (await store.get(APP, "settings")) || {}; return { washer: s.washer || KINDS.washer.def, dryer: s.dryer || KINDS.dryer.def }; }
const isActive = (l, now) => !!(l && l.end && !l.out && now < l.end + STALE);
async function loads(now = Date.now()) {
  const out = {};
  for (const k of Object.keys(KINDS)) { const l = await store.get(APP, k); out[k] = isActive(l, now) ? l : null; }
  return out;
}

export async function startLoad(kind, min) {
  const now = Date.now();
  await store.put(APP, kind, { start: now, end: now + min * M, min, out: false });
  const s = await getSettings(); if (s[kind] !== min) await store.put(APP, "settings", { ...s, [kind]: min });
  if (notify.permission() === "default") notify.ask();
}
async function addTime(kind, min) {
  const l = await store.get(APP, kind); if (!l) return;
  const now = Date.now();
  await store.put(APP, kind, { ...l, end: Math.max(l.end, now) + min * M });
}
async function takeOut(kind) { const l = await store.get(APP, kind); if (l) await store.put(APP, kind, { ...l, out: true, outAt: Date.now() }); }
const cancel = kind => store.remove(APP, kind);

/* ---------- for Reminders, Today and the home screen ---------- */
async function agenda() {
  const now = Date.now(), L = await loads(now), out = [];
  for (const [k, l] of Object.entries(L)) {
    if (!l) continue;
    const K = KINDS[k], id = `${APP}:${k}-${l.start}`;
    out.push({ key: `${id}-done`, title: K.done, kind: "ping", loud: true, due: l.end, done: false, open: "#laundry", body: K.body });
    out.push({ key: `${id}-again`, title: K.again, kind: "ping", loud: true, due: l.end + NUDGE, done: false, open: "#laundry", body: "It finished 10 minutes ago. Tap “Got it out” to stop these." });
  }
  return out;
}
function soonest(L, now) {
  const list = Object.entries(L).filter(([, l]) => l).map(([k, l]) => ({ k, l, left: l.end - now }));
  return list.sort((a, b) => a.left - b.left)[0] || null;
}
async function badge() {
  const now = Date.now(), s = soonest(await loads(now), now);
  return !s ? "" : s.left <= 0 ? "done" : `${minsLeft(s.left)}m`;
}
async function summary() {
  const now = Date.now(), L = await loads(now), on = Object.entries(L).filter(([, l]) => l);
  if (!on.length) return null;
  const parts = on.map(([k, l]) => l.end <= now ? `${KINDS[k].label} done` : `${KINDS[k].label} ${minsLeft(l.end - now)} min`);
  const s = soonest(L, now), d = s.l.end - s.l.start;
  return { label: "Laundry", value: parts.join(" · "), sub: s.left > 0 ? `done at ${clock(s.l.end)}` : `finished ${ago(-s.left)}`,
    pct: Math.min(100, Math.round((now - s.l.start) / d * 100)), tone: s.left <= 0 ? "warn" : "good", open: "#laundry" };
}
/** Small home widget. */
async function widget(el) {
  const now = Date.now(), L = await loads(now), s = soonest(L, now);
  el.classList.add("h-laundry");
  if (!s) { el.innerHTML = `<span class="h-k">Laundry</span><span class="h-t">Tap to start a load</span><span class="h-s">${svg("washingMachine")}</span>`; return; }
  const K = KINDS[s.k], other = Object.entries(L).find(([k, l]) => l && k !== s.k);
  el.innerHTML = `<span class="h-k">${esc(K.label)}</span>
    <span class="h-big">${s.left > 0 ? `${minsLeft(s.left)}<small>m</small>` : "Done"}</span>
    <span class="h-t">${s.left > 0 ? `done at ${esc(clock(s.l.end))}` : `finished ${esc(ago(-s.left))}`}</span>
    ${other ? `<span class="h-s">${esc(KINDS[other[0]].label)}: ${other[1].end > now ? `${minsLeft(other[1].end - now)} min` : "done"}</span>` : ""}
    <span class="h-meter"><i style="width:${Math.min(100, Math.round((now - s.l.start) / (s.l.end - s.l.start) * 100))}%"></i></span>`;
}

/** A one-off calendar event with alarms, so the phone buzzes even if GooseOS is closed. */
function icsFor(kind, l) {
  const f = t => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const K = KINDS[kind];
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//GooseOS//Laundry//EN", "BEGIN:VEVENT",
    `UID:${kind}-${l.start}@gooseos`, `DTSTAMP:${f(Date.now())}`, `DTSTART:${f(l.end)}`, `DTEND:${f(l.end + NUDGE)}`, `SUMMARY:${K.done}`, `DESCRIPTION:${K.body}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${K.done}`, "TRIGGER:PT0M", "END:VALARM",
    "BEGIN:VALARM", "ACTION:DISPLAY", `DESCRIPTION:${K.again}`, "TRIGGER:PT10M", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"];
  return new Blob([lines.join("\r\n")], { type: "text/calendar" });
}

/* ---------- view ---------- */
let ctx0, root, timer = null, cache = null, settings = null;
const $ = s => root.querySelector(s);

function card(k, l, now) {
  const K = KINDS[k], min = settings[k];
  const head = `<div class="lt-head"><span class="lt-ic">${svg(K.icon)}</span><b>${K.label}</b></div>`;
  if (!l) return `<section class="ap-card pad lt-card" data-kind="${k}">${head}
      <div class="lt-set"><button class="icon-btn" data-act="less" aria-label="5 minutes less">−</button><span class="lt-min"><b>${min}</b> min</span><button class="icon-btn" data-act="more" aria-label="5 minutes more">${svg("plus")}</button></div>
      <button class="pill-btn lt-go" data-act="start">Start ${K.label.toLowerCase()}</button></section>`;
  const left = l.end - now, pct = Math.min(100, Math.round((now - l.start) / (l.end - l.start) * 100));
  if (left > 0) return `<section class="ap-card pad lt-card on" data-kind="${k}">${head}
      <div class="lt-time" data-end="${l.end}">${mmss(left)}</div>
      <div class="ap-bar-meter lt-meter"><i style="width:${pct}%"></i></div>
      <div class="lt-sub">Done at ${esc(clock(l.end))}</div>
      <div class="lt-btns"><button class="pill-btn secondary" data-act="add">+5 min</button><button class="pill-btn secondary" data-act="ics">${svg("bell")} Phone alert</button><button class="pill-btn secondary danger-t" data-act="cancel">Cancel</button></div></section>`;
  const late = -left >= NUDGE;
  return `<section class="ap-card pad lt-card done ${late ? "late" : ""}" data-kind="${k}">${head}
      <div class="lt-time">Done</div>
      <div class="lt-sub">Finished ${esc(ago(-left))}${late ? ". Someone might move it." : ""}</div>
      <div class="lt-btns"><button class="pill-btn" data-act="out">Got it out</button><button class="pill-btn secondary" data-act="add">+5 min</button></div></section>`;
}

async function render() {
  const now = Date.now();
  [cache, settings] = await Promise.all([loads(now), getSettings()]);
  const anyOn = Object.values(cache).some(Boolean);
  $("#lt-body").innerHTML = `<div class="lt-grid">${Object.keys(KINDS).map(k => card(k, cache[k], now)).join("")}</div>
    <p class="lt-note">${anyOn ? "You'll get a ping when it's done and again 10 minutes later. On iPhone, pings only come while GooseOS is open. Tap “Phone alert” to add a calendar alarm that buzzes even when it's closed."
      : "Set each machine's usual time once with − and +. GooseOS remembers it."}</p>`;
}
// once a second, just update the countdown text; redraw fully when a load finishes
function tickView() {
  const now = Date.now(); let redraw = false;
  root.querySelectorAll(".lt-time[data-end]").forEach(el => { const left = +el.dataset.end - now; if (left <= 0) redraw = true; else el.textContent = mmss(left); });
  if (redraw) render();
}

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./laundry.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = `<div class="ap-bar"><button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button><span class="ap-title">Laundry</span></div>
    <div class="ap-scroll"><div class="ap-body" id="lt-body"></div></div>`;
  el.addEventListener("click", async e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const k = b.closest("[data-kind]").dataset.kind, K = KINDS[k], act = b.dataset.act;
    if (act === "less" || act === "more") {
      const min = Math.max(5, Math.min(180, settings[k] + (act === "more" ? 5 : -5)));
      await store.put(APP, "settings", { ...settings, [k]: min });
    } else if (act === "start") { await startLoad(k, settings[k]); ctx0.toast(`${K.label} started. Done at ${clock(Date.now() + settings[k] * M)}.`); }
    else if (act === "add") { await addTime(k, 5); ctx0.toast("Added 5 minutes."); }
    else if (act === "cancel") { await cancel(k); ctx0.toast(`${K.label} timer cancelled.`); }
    else if (act === "out") {
      await takeOut(k);
      if (k === "washer" && !cache.dryer) {
        const t = setTimeout(() => { const el = document.querySelector(".toast"); if (el) el.hidden = true; }, 6000);
        ctx0.toast("Nice. Start the dryer?", { label: `Start · ${settings.dryer} min`, run: async () => { clearTimeout(t); document.querySelector(".toast").hidden = true; await startLoad("dryer", settings.dryer); render(); } });
      } else ctx0.toast("Nice. Timer cleared.");
    } else if (act === "ics") {
      const a = document.createElement("a"); a.href = URL.createObjectURL(icsFor(k, cache[k])); a.download = `${k}-done.ics`; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
      return;
    }
    render();
  });
  store.onChange(ch => { if (ch.app === APP && ctx.isActive()) render(); });
}
async function show() { await render(); clearInterval(timer); timer = setInterval(() => { if (ctx0.isActive()) tickView(); }, 1000); }
function hide() { clearInterval(timer); }

/** At boot: keep the home-screen badge and widget counting down while a load runs. */
function start() {
  setInterval(async () => {
    if (location.hash.length > 1 || document.hidden) return;
    const ic = document.querySelector('#apps [data-open="laundry"] .sq'); if (!ic) return;
    const b = await badge();
    let el = ic.querySelector(".badge");
    if (b && !el) { el = document.createElement("span"); el.className = "badge"; ic.appendChild(el); }
    if (el) { if (b) el.textContent = b; else el.remove(); }
    for (const w of document.querySelectorAll('#small-widgets [data-open="laundry"]')) await widget(w);
  }, 15000);
}

export default { id: APP, name: "Laundry", icon: "washingMachine", color: ["#67e8f9", "#0891b2"], mount, show, hide, badge, widget, summary, agenda, start, complete() {} };
