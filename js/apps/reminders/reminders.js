// Nag Reminders: every dated item from js/agenda.js gets notifications that
// come more often as the due time gets closer, and keep coming once it's late,
// until you mark it done or snooze it.
//
// Saved items (app "reminders"):
//   "settings":  { intensity: "chill"|"normal"|"relentless", quietFrom: "01:00", quietTo: "08:00", holdInClass: true,
//                  byList: { <list id>: "chill"|"normal"|"relentless"|"off" },   lists that nag differently (missing = same as intensity)
//                  feedSkip: [<list id>] }                                       lists left out of the phone calendar
//   "missed":    { list: [{ key, title, at }] }  reminders that came due while GooseOS was closed
//   <agenda key>: { sent: ["3d", "1d", ...], snoozedUntil }
//
// It runs while GooseOS is open (an installed window counts, even minimized).
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import * as agenda from "../../agenda.js";
import * as notify from "../../notify.js";
import { isInClass } from "../schedule/schedule.js";
import { dueLabel } from "../deadlines/parse.js";
import * as feed from "../../feed.js";
import * as sync from "../../sync.js";
import { loadLists } from "../../lists.js";

const APP = "reminders";
const H = 3600e3, D = 24 * H;
const DEFAULTS = { intensity: "normal", quietFrom: "01:00", quietTo: "08:00", holdInClass: true, byList: {}, feedSkip: [] };

/** How hard one item nags: its list's setting, or the main one. "off" = never. */
export function intensityFor(item, settings) {
  const own = item && item.list && settings.byList ? settings.byList[item.list] : null;
  return own || settings.intensity;
}
const RAMPS = {
  chill: ["1d", "1h"],
  normal: ["3d", "1d", "morning", "3h", "1h"],
  relentless: ["3d", "1d", "morning", "6h", "3h", "1h", "30m"],
};
const OFFSETS = { "3d": 3 * D, "1d": D, "6h": 6 * H, "3h": 3 * H, "1h": H, "30m": 30 * 60e3 };
const RAMP_TEXT = {
  chill: "1 day and 1 hour before",
  normal: "3 days, 1 day, the morning of, 3 hours and 1 hour before",
  relentless: "3 days, 1 day, the morning of, 6 h, 3 h, 1 h and 30 min before",
};
const LATE_EVERY = 2 * H, LATE_FOR = 3 * D;
const STALE = 10 * 60e3;   // a step this old when GooseOS opens goes to "missed" instead of buzzing

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const toMin = s => { const [h, m] = String(s || "0:0").split(":").map(Number); return h * 60 + (m || 0); };
function ago(ms) { const m = Math.round(ms / 60000); return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`; }

export async function getSettings() { return { ...DEFAULTS, ...((await store.get(APP, "settings")) || {}) }; }

/** The reminder times for one item: [{ id, at }]. */
export function stepsFor(item, settings, now = Date.now()) {
  if (!item.due) return [];
  const due = item.due;
  if (item.kind === "ping") return [{ id: "at", at: due }];
  const intensity = intensityFor(item, settings);
  if (intensity === "off") return [];
  const ids = item.kind === "deadline" || item.kind === "exam" ? RAMPS[intensity] || RAMPS.normal : ["1d", "morning"];
  const out = [];
  for (const id of ids) {
    if (id === "morning") {
      const m = new Date(due); m.setHours(9, 0, 0, 0);
      if (due - m.getTime() >= 2 * H) out.push({ id, at: m.getTime() });
    } else out.push({ id, at: due - OFFSETS[id] });
  }
  if (item.kind === "deadline" || item.kind === "step") {
    for (let t = due + LATE_EVERY, n = 1; t <= Math.min(now, due + LATE_FOR); t += LATE_EVERY, n++) out.push({ id: `late${n}`, at: t, late: true });
  }
  // drop steps that bunch up (e.g. "1 day" and "morning of" within the same hour)
  out.sort((a, b) => a.at - b.at);
  return out.filter((s, i) => i === 0 || s.at - out[i - 1].at >= 20 * 60e3 || s.late);
}

function inQuiet(settings, t) {
  const d = new Date(t), m = d.getHours() * 60 + d.getMinutes(), a = toMin(settings.quietFrom), b = toMin(settings.quietTo);
  return a === b ? false : a < b ? m >= a && m < b : m >= a || m < b;
}

function whenText(item, now) {
  const left = item.due - now;
  if (item.kind === "ping") return "";
  if (left < 0) return `Overdue by ${ago(-left)} · was due ${dueLabel(item.due)}`;
  if (left < H) return `Due in ${Math.max(1, Math.round(left / 60000))} min`;
  if (left < D) return `Due in ${Math.round(left / H)} hours · ${dueLabel(item.due)}`;
  return `Due ${dueLabel(item.due)}`;
}
const titleOf = item => (item.course ? `${item.course} · ` : "") + item.title;

/* ---------- the scheduler ---------- */
let ctx0 = null, bootAt = Date.now(), ticking = false, lastFired = 0;

async function tick() {
  if (ticking) return; ticking = true;
  try {
    const now = Date.now();
    const [settings, items] = await Promise.all([getSettings(), agenda.list()]);
    const quiet = inQuiet(settings, now);
    const cls = settings.holdInClass ? await isInClass(now).catch(() => null) : null;
    const missed = [];
    for (const item of items) {
      if (!item.due || item.done) continue;
      const st = await store.get(APP, item.key);
      if (!st) { await store.put(APP, item.key, { sent: [], seen: now }); continue; }   // first time we see it
      const steps = stepsFor(item, settings, now).filter(s => s.at <= now);
      if (!steps.length) continue;
      const sent = new Set(st.sent || []);
      // steps that were already past when the item showed up (you just added it) never buzz
      const early = steps.filter(s => s.at < (st.seen || 0) && !sent.has(s.id));
      if (early.length) { early.forEach(s => sent.add(s.id)); await store.put(APP, item.key, { ...st, sent: [...sent] }); }
      let todo = steps.filter(s => !sent.has(s.id));
      const snoozeDue = st.snoozedUntil && st.snoozedUntil <= now && !st.snoozeFired;
      if (st.snoozedUntil && st.snoozedUntil > now) continue;
      if (!todo.length && !snoozeDue) continue;
      const latest = todo[todo.length - 1] || { id: "snooze", at: st.snoozedUntil };
      // came due while GooseOS was closed → list it as missed, don't buzz for old news
      if (latest.at < bootAt - STALE) {
        missed.push({ key: item.key, title: titleOf(item), at: latest.at });
        await store.put(APP, item.key, { ...st, sent: [...sent, ...todo.map(s => s.id)], snoozeFired: true });
        continue;
      }
      if (quiet && !item.loud) continue;   // loud: something you asked to hear about right away
      if (cls && !item.loud && item.due > cls.end) continue;   // hold until class ends, unless it's due before then
      const ok = await fire(item, now);
      if (ok || notify.permission() !== "granted") await store.put(APP, item.key, { ...st, sent: [...sent, ...todo.map(s => s.id)], snoozeFired: true });
    }
    if (missed.length) {
      const cur = (await store.get(APP, "missed")) || { list: [] };
      const keys = new Set(missed.map(m => m.key));
      await store.put(APP, "missed", { list: [...missed, ...cur.list.filter(m => !keys.has(m.key))].slice(0, 20) });
      if (ctx0) ctx0.toast(`${missed.length} reminder${missed.length === 1 ? "" : "s"} came due while GooseOS was closed.`, { label: "See", run: () => { location.hash = "reminders"; document.querySelector(".toast").hidden = true; } });
    }
  } catch (e) { console.error("reminders", e); }
  finally { ticking = false; }
}

async function fire(item, now) {
  const body = whenText(item, now);
  const shown = await notify.show(item.kind === "ping" ? item.title : titleOf(item), {
    body: item.kind === "ping" ? item.body || "" : body, tag: item.key, data: { key: item.key, open: item.open },
    actions: item.kind === "ping" ? [] : [{ action: "done", title: "Done" }, notifSnooze(now)],
  });
  if (!shown && ctx0 && now - lastFired > 4000) {
    // no notification permission: at least show it inside GooseOS
    ctx0.toast(`${titleOf(item)} · ${body}`, { label: "Open", run: () => { location.hash = item.open.replace(/^#/, ""); document.querySelector(".toast").hidden = true; } });
  }
  lastFired = now;
  return shown;
}

/** Snooze choices: 1 hour, tonight at 8, tomorrow at 9 AM. "Tonight" only before 7 PM. */
const TONIGHT = 20, MORNING = 9;
function snoozeTimes(now = Date.now()) {
  const d = new Date(now), at = (dayOff, h) => { const x = new Date(d); x.setDate(x.getDate() + dayOff); x.setHours(h, 0, 0, 0); return +x; };
  const out = [{ id: "1h", label: "1 hour", at: now + H, msg: "Snoozed for 1 hour." }];
  if (d.getHours() < TONIGHT - 1) out.push({ id: "tonight", label: "Tonight", at: at(0, TONIGHT), msg: "Snoozed until 8 PM." });
  // before 5 AM, "tomorrow morning" means later today
  out.push({ id: "am", label: "Tomorrow morning", at: at(d.getHours() < 5 ? 0 : 1, MORNING), msg: "Snoozed until 9 AM." });
  return out;
}

export async function snooze(key, ms = H) { return snoozeTo(key, Date.now() + ms); }
export async function snoozeTo(key, until) {
  const st = (await store.get(APP, key)) || { sent: [] };
  await store.put(APP, key, { ...st, snoozedUntil: until, snoozeFired: false });
}

/** The notification's snooze button: 1 hour in the daytime, tomorrow morning in the evening. */
function notifSnooze(now = Date.now()) {
  return new Date(now).getHours() >= 18 || new Date(now).getHours() < 5
    ? { action: "snooze-am", title: "Snooze till morning" } : { action: "snooze", title: "Snooze 1 hour" };
}

async function onAction({ action, data }) {
  const key = data && data.key; if (!key) return;
  if (action === "done") { await agenda.complete(key); if (ctx0) ctx0.toast("Marked done."); }
  else if (action === "snooze") { await snooze(key); if (ctx0) ctx0.toast("Snoozed for 1 hour."); }
  else if (action === "snooze-am") { const t = snoozeTimes().find(s => s.id === "am"); await snoozeTo(key, t.at); if (ctx0) ctx0.toast(t.msg); }
}

function start(ctx) {
  ctx0 = ctx; bootAt = Date.now();
  notify.onAction(onAction);
  setTimeout(tick, 2500);
  setInterval(tick, 30000);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
  // first run: offer to turn notifications on (needs a click, so it rides on the toast button)
  setTimeout(async () => {
    if (notify.permission() !== "default") return;
    const items = await agenda.list();
    if (!items.some(i => i.due)) return;
    ctx.toast("Turn on reminders so deadlines can't sneak up on you.", { label: "Turn on", run: async () => { document.querySelector(".toast").hidden = true; const p = await notify.ask(); ctx.toast(p === "granted" ? "Reminders are on." : "Reminders stay inside GooseOS. You can turn them on in the Reminders app."); } });
  }, 5000);
}

/* ---------- view ---------- */
let root;
const $ = s => root.querySelector(s);

function permCard() {
  const p = notify.permission();
  if (p === "granted") return "";
  if (!notify.supported) return `<div class="ap-card pad rm-perm"><b>This browser can't show notifications</b><span>Reminders will show inside GooseOS while it's open.</span></div>`;
  if (p === "denied") return `<div class="ap-card pad rm-perm"><b>Notifications are blocked</b><span>Click the lock or settings icon next to the address bar (or in the app window's title bar), set <b>Notifications</b> to Allow, then reload GooseOS. Until then, reminders show inside GooseOS while it's open.</span></div>`;
  return `<div class="ap-card pad rm-perm"><b>Turn on notifications</b><span>So reminders reach you even when you're in another window.</span><button class="pill-btn" id="rm-allow" style="align-self:flex-start">Turn on notifications</button></div>`;
}

/* Calendar feed: reminders that reach your phone when GooseOS is closed (js/feed.js). */
async function feedCard() {
  const link = await feed.getLink();
  const head = `<b>Get reminders on your phone</b>`;
  if (!link) {
    const why = `<span>GooseOS can only remind you while it's open. Add your deadlines to your phone's calendar and it alerts you any time, with the same timing as “How hard to nag”.</span>`;
    return sync.signedIn()
      ? `<div class="ap-card pad rm-feed">${head}${why}<button class="pill-btn" id="rm-feed-make" style="align-self:flex-start">Make my calendar link</button></div>`
      : `<div class="ap-card pad rm-feed">${head}${why}<span>This needs sync, so your phone can reach your deadlines.</span><button class="pill-btn secondary" data-open="settings" style="align-self:flex-start">${sync.enabled ? "Sign in to sync" : "Sync is off"}</button></div>`;
  }
  const local = ["localhost", "127.0.0.1"].includes(location.hostname);
  return `<div class="ap-card pad rm-feed">${head}
    <span>Your calendar link is on. Open it on your phone to subscribe. New and changed deadlines show up there on their own, usually within an hour or so.</span>
    ${local ? `<span class="rm-feed-warn">You're on this computer's test address, so this link won't work on a phone. Make it from the real GooseOS site.</span>` : ""}
    <div class="rm-feed-row"><a class="pill-btn" href="${esc(feed.urlFor(link.token, "webcal"))}">Add to calendar</a><button class="pill-btn secondary" id="rm-feed-copy">${svg("copy")}Copy link</button><button class="link-btn" id="rm-feed-off">Turn off</button></div>
    <span class="ap-hint">On iPhone, if alerts don't appear, open the subscribed calendar's settings and switch off “Remove Alerts”. Google Calendar ignores a feed's alerts, so set default notifications for the calendar there. Keep this link private: anyone with it can see your deadline titles.</span>
  </div>`;
}

async function nextFor(item, settings, now) {
  const st = (await store.get(APP, item.key)) || { sent: [] };
  if (st.snoozedUntil && st.snoozedUntil > now) return { at: st.snoozedUntil, snoozed: true };
  const steps = stepsFor(item, settings, now + LATE_FOR);
  const sent = new Set(st.sent || []);
  const s = steps.find(x => x.at > now && !sent.has(x.id));
  return s ? { at: s.at } : null;
}

function itemRow(item, extra, now) {
  const late = item.due < now;
  return `<div class="ap-row" data-key="${esc(item.key)}">
    <button class="ap-check" data-act="done" aria-label="Mark done">${svg("check")}</button>
    <button class="grow rm-open" data-act="open" style="border:0;background:none;text-align:left;padding:0;color:inherit"><span class="t">${esc(titleOf(item))}</span><span class="s">${esc(extra)}</span></button>
    ${late ? `<span class="ap-pill bad">late</span>` : ""}
    <button class="icon-btn" data-act="snooze" aria-label="Snooze" title="Snooze" aria-haspopup="menu">${svg("bellOff")}</button>
  </div>`;
}

async function render() {
  const now = Date.now();
  const [settings, items, missed] = await Promise.all([getSettings(), agenda.list(), store.get(APP, "missed")]);
  const dated = items.filter(i => i.due && i.kind !== "ping");
  const late = dated.filter(i => i.due < now);
  const upcoming = [];
  for (const i of dated.filter(i => i.due >= now)) { const n = await nextFor(i, settings, now); if (n) upcoming.push({ item: i, n }); }
  upcoming.sort((a, b) => a.n.at - b.n.at);
  const fmtAt = t => { const s = dueLabel(t); return s; };
  const missedList = ((missed && missed.list) || []).filter(m => now - m.at < 2 * D);

  const feedHtml = await feedCard();
  const [lists, link] = await Promise.all([loadLists(), feed.getLink()]);
  const skip = new Set(settings.feedSkip || []);
  const LEVELS = [["", "Same"], ["chill", "Chill"], ["normal", "Normal"], ["relentless", "Relentless"], ["off", "Off"]];
  const byListHtml = `<div class="rm-lists"><span class="rm-lists-h">By list</span>${lists.map(l => `<div class="rm-lrow">
      <span class="rm-lname"><i style="background:${esc(l.color)}"></i>${esc(l.name)}</span>
      <select class="field" data-blist="${esc(l.id)}" aria-label="How hard to nag for ${esc(l.name)}">${LEVELS.map(([v, t]) => `<option value="${v}" ${(settings.byList || {})[l.id] === v || (!v && !(settings.byList || {})[l.id]) ? "selected" : ""}>${t}</option>`).join("")}</select>
      ${link ? `<label class="rm-phone"><input type="checkbox" data-flist="${esc(l.id)}" ${skip.has(l.id) ? "" : "checked"}> Phone</label>` : ""}
    </div>`).join("")}
    <span class="ap-hint">“Same” follows the setting above. “Off” means no pings for that list${link ? ", and Phone picks which lists go to your phone's calendar" : ""}.</span></div>`;

  $("#rm-body").innerHTML = `
    ${permCard()}
    ${feedHtml}
    ${missedList.length ? `<section class="ap-sec"><h3>While GooseOS was closed<span class="n">${missedList.length}</span><span class="ap-spacer"></span><button class="link-btn" id="rm-clear" style="font-size:12.5px;padding:0">Clear</button></h3><div class="ap-card">${missedList.map(m => `<div class="ap-row"><span class="grow"><span class="t">${esc(m.title)}</span><span class="s">Reminder was due ${esc(dueLabel(m.at))}</span></span></div>`).join("")}</div></section>` : ""}
    ${late.length ? `<section class="ap-sec bad"><h3>Overdue<span class="n">${late.length}</span></h3><div class="ap-card">${late.map(i => itemRow(i, `Was due ${dueLabel(i.due)} · nagging every 2 hours`, now)).join("")}</div></section>` : ""}
    <section class="ap-sec"><h3>Next reminders</h3><div class="ap-card">${upcoming.length ? upcoming.slice(0, 12).map(({ item, n }) => itemRow(item, `${n.snoozed ? "Snoozed until" : "Next reminder"} ${fmtAt(n.at)} · due ${dueLabel(item.due)}`, now)).join("") : `<div class="ap-empty"><b>Nothing to remind you about</b>Add deadlines in Deadlines and they'll show up here.</div>`}</div></section>
    <section class="ap-sec"><h3>How hard to nag</h3><div class="ap-card pad">
      <div class="ap-tabs rm-int" role="group" aria-label="Reminder intensity" style="align-self:flex-start">${["chill", "normal", "relentless"].map(k => `<button data-int="${k}" aria-pressed="${settings.intensity === k}">${k[0].toUpperCase() + k.slice(1)}</button>`).join("")}</div>
      <span class="ap-hint">For deadlines: ${RAMP_TEXT[settings.intensity]}, then every 2 hours once it's late. Project steps and to-dos get 1 day before and the morning of.</span>
      ${byListHtml}
      <div class="rm-grid">
        <label>Quiet from<input class="field" type="time" id="rm-qf" value="${esc(settings.quietFrom)}"></label>
        <label>Quiet until<input class="field" type="time" id="rm-qt" value="${esc(settings.quietTo)}"></label>
      </div>
      <label class="rm-toggle"><input type="checkbox" id="rm-class" ${settings.holdInClass ? "checked" : ""}> Hold reminders during class (uses your Schedule)</label>
      <button class="pill-btn secondary" id="rm-test" style="align-self:flex-start">Send a test reminder</button>
    </div></section>`;

  const allow = $("#rm-allow");
  if (allow) allow.onclick = async () => { const p = await notify.ask(); ctx0.toast(p === "granted" ? "Reminders are on." : "Notifications weren't allowed."); render(); };
  const make = $("#rm-feed-make");
  if (make) make.onclick = async () => {
    make.disabled = true; make.textContent = "Making link…";
    try { await feed.create(); ctx0.toast("Calendar link is on."); }
    catch (e) {
      console.error(e);
      ctx0.toast(e.message === "signed-out" ? "Sign in to sync first." : !navigator.onLine ? "You're offline. Try again when you're connected." : "Couldn't make the link. The feed part of supabase/schema.sql may not have been run yet.");
    }
    render();
  };
  const copy = $("#rm-feed-copy");
  if (copy) copy.onclick = async () => {
    const link = await feed.getLink(); if (!link) return;
    try { await navigator.clipboard.writeText(feed.urlFor(link.token)); ctx0.toast("Link copied."); }
    catch (e) { ctx0.toast("Couldn't copy. Use “Add to calendar” instead."); }
  };
  const off = $("#rm-feed-off");
  if (off) off.onclick = async () => {
    if (!confirm("Turn off your calendar link? Calendars subscribed to it will stop updating.")) return;
    try { await feed.remove(); ctx0.toast("Calendar link is off."); }
    catch (e) { console.error(e); ctx0.toast(e.message === "signed-out" ? "Sign in to sync to turn it off." : "Couldn't turn it off. Try again."); }
    render();
  };
  const clear = $("#rm-clear"); if (clear) clear.onclick = async () => { await store.put(APP, "missed", { list: [] }); render(); };
  root.querySelectorAll("[data-int]").forEach(b => b.onclick = () => save({ intensity: b.dataset.int }));
  root.querySelectorAll("[data-blist]").forEach(s => s.onchange = () => {
    const byList = { ...(settings.byList || {}) };
    if (s.value) byList[s.dataset.blist] = s.value; else delete byList[s.dataset.blist];
    save({ byList });
  });
  root.querySelectorAll("[data-flist]").forEach(c => c.onchange = () => {
    const s = new Set(settings.feedSkip || []);
    if (c.checked) s.delete(c.dataset.flist); else s.add(c.dataset.flist);
    save({ feedSkip: [...s] });
  });
  $("#rm-qf").onchange = e => save({ quietFrom: e.target.value || DEFAULTS.quietFrom });
  $("#rm-qt").onchange = e => save({ quietTo: e.target.value || DEFAULTS.quietTo });
  $("#rm-class").onchange = e => save({ holdInClass: e.target.checked });
  $("#rm-test").onclick = async () => {
    if (notify.permission() === "default") await notify.ask();
    const ok = await notify.show("Test reminder", { body: "This is what a reminder looks like.", tag: "reminders:test", data: { key: "", open: "#reminders" } });
    ctx0.toast(ok ? "Sent. Check your notifications." : "Notifications are off, so reminders show here instead.");
  };
}
function closeSnoozeMenu() { root.querySelectorAll(".rm-snz").forEach(m => m.remove()); }
function openSnoozeMenu(btn, key) {
  const had = btn.parentElement.querySelector(".rm-snz");
  closeSnoozeMenu(); if (had) return;
  const m = document.createElement("div"); m.className = "rm-snz"; m.setAttribute("role", "menu"); m.dataset.key = key;
  m.innerHTML = snoozeTimes().map(s => `<button role="menuitem" data-snz="${s.id}">${s.label}<span>${esc(dueLabel(s.at))}</span></button>`).join("");
  btn.parentElement.appendChild(m);
  m.querySelector("button").focus();
}

async function save(patch) { await store.put(APP, "settings", { ...(await getSettings()), ...patch }); render(); }

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./reminders.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function mount(el, ctx) {
  root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = `
    <div class="ap-bar"><button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button><span class="ap-title">Reminders</span></div>
    <div class="ap-scroll"><div class="ap-body" id="rm-body"></div></div>`;
  el.addEventListener("click", async e => {
    const pick = e.target.closest("[data-snz]");
    if (pick) {
      const t = snoozeTimes().find(s => s.id === pick.dataset.snz);
      if (t) { await snoozeTo(pick.closest(".rm-snz").dataset.key, t.at); ctx0.toast(t.msg); }
      closeSnoozeMenu(); render(); return;
    }
    const b = e.target.closest("[data-act]"); if (!b) { closeSnoozeMenu(); return; }
    const key = b.closest("[data-key]").dataset.key;
    if (b.dataset.act === "done") { await agenda.complete(key); ctx0.toast("Marked done."); }
    else if (b.dataset.act === "snooze") { openSnoozeMenu(b, key); return; }
    else if (b.dataset.act === "open") { const it = (await agenda.list()).find(i => i.key === key); if (it) location.hash = it.open.replace(/^#/, ""); return; }
    render();
  });
  store.onChange(() => { if (ctx.isActive()) { clearTimeout(rt); rt = setTimeout(render, 200); } });
  let wasIn = sync.signedIn();
  sync.onStatus(() => { const now = sync.signedIn(); if (now !== wasIn && ctx.isActive()) render(); wasIn = now; });
  await render();
}
let rt = null;

/** Red bubble: how many things are overdue. */
async function badge() {
  const now = Date.now();
  const n = (await agenda.list()).filter(i => i.due && i.due < now && i.kind !== "ping").length;
  return n || "";
}

export default { id: APP, name: "Reminders", icon: "bell", color: ["#ff6b6e", "#d23c41"], mount, show: render, badge, start };
