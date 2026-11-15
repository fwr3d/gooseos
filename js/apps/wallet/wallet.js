// Wallet: a weekly food budget you log by hand (no bank login), plus a Recap of
// where the money went. Two tabs, same data.
//
// Saved items:
//   app "wallet", id "settings": { foodCents, goingOutCents, weekStart: "mon" | "sun" }
//   app "wallet", any other id:  one purchase { cents, cat, place, at (ms), note }
// Food out, Delivery and Groceries count toward the food budget. Going out has
// its own optional cap. Other counts toward neither.
import * as store from "../../store.js";
import { svg } from "../../icons.js";

const APP = "wallet", D = 864e5;
const CATS = {
  food: { label: "Food out", color: "#f59e0b", food: true },
  delivery: { label: "Delivery", color: "#ef4444", food: true },
  groceries: { label: "Groceries", color: "#22a45d", food: true },
  going: { label: "Going out", color: "#8b5cf6" },
  other: { label: "Other", color: "#64748b" },
};
const KEYWORDS = [
  [/doordash|uber ?eats|grubhub|postmates|delivery/i, "delivery"],
  [/kroger|walmart|target|aldi|meijer|costco|trader|whole foods|grocer|market|sam'?s club/i, "groceries"],
  [/bar|club|ticket|movie|cinema|concert|bowling|uber|lyft|party/i, "going"],
];

const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = c => `$${(Math.abs(c) / 100).toLocaleString(undefined, { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const whole = c => `$${Math.round(Math.abs(c) / 100).toLocaleString()}`;
const toCents = v => { const n = parseFloat(String(v).replace(/[$,\s]/g, "")); return isFinite(n) && n > 0 ? Math.round(n * 100) : 0; };
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
const addDays = (t, n) => { const d = new Date(dayStart(t)); d.setDate(d.getDate() + n); return +d; };
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const wd = (t, style = "short") => new Date(t).toLocaleDateString(undefined, { weekday: style });
const titleCase = s => s === s.toLowerCase() ? s.replace(/\b[a-z]/g, c => c.toUpperCase()) : s;

/* ---------- data ---------- */
async function getSettings() { return await store.get(APP, "settings"); }
async function purchases() {
  return (await store.list(APP)).filter(r => r.id !== "settings" && r.data && r.data.cents)
    .map(r => ({ id: r.id, ...r.data })).sort((a, b) => b.at - a.at);
}
/** Midnight on the first day of the week that holds t. */
function weekOf(t, ws = "mon") {
  const d = dayStart(t), dow = new Date(d).getDay();
  return addDays(d, -(ws === "sun" ? dow : (dow + 6) % 7));
}
function weekStats(list, start, s) {
  const end = addDays(start, 7), items = list.filter(p => p.at >= start && p.at < end);
  const by = Object.fromEntries(Object.keys(CATS).map(k => [k, 0]));
  for (const p of items) by[CATS[p.cat] ? p.cat : "other"] += p.cents;
  const food = by.food + by.delivery + by.groceries;
  return { start, end, items, by, food, going: by.going, total: items.reduce((n, p) => n + p.cents, 0), under: !s || !s.foodCents || food <= s.foodCents };
}
/** Where you are this week. Used by the app, the widget, Today and the home screen. */
async function status(now = Date.now()) {
  const s = await getSettings(); if (!s) return null;
  const list = await purchases(), wk = weekStats(list, weekOf(now, s.weekStart), s);
  const daysLeft = Math.max(1, Math.round((wk.end - dayStart(now)) / D));
  const left = s.foodCents - wk.food, pct = s.foodCents ? Math.round(wk.food / s.foodCents * 100) : 0;
  return { s, list, wk, left, pct, perDay: left > 0 ? left / daysLeft : 0, lastDay: daysLeft === 1 ? "today" : `until ${wd(wk.end - D)}`, tone: pct > 100 ? "bad" : pct >= 75 ? "warn" : "good" };
}
const toneColor = t => t === "bad" ? "var(--bad)" : t === "warn" ? "var(--warn)" : "var(--good)";

/** Your usual places: what you buy often, at the amount you usually pay. */
function usuals(list, now = Date.now()) {
  const groups = new Map();
  for (const p of list) {
    if (!p.place || p.at < now - 75 * D) continue;
    const k = `${p.place.toLowerCase()}|${p.cat}`;
    const g = groups.get(k) || { place: p.place, cat: p.cat, n: 0, score: 0, amounts: new Map(), last: 0 };
    g.n++; g.score += 1 + Math.max(0, 1 - (now - p.at) / (30 * D));
    g.amounts.set(p.cents, (g.amounts.get(p.cents) || 0) + 1);
    if (p.at > g.last) { g.last = p.at; g.place = p.place; g.lastCents = p.cents; }
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.score - a.score).slice(0, 8).map(g => {
    let cents = g.lastCents, best = 0;
    for (const [c, n] of g.amounts) if (n > best || (n === best && c === g.lastCents)) { best = n; cents = c; }
    return { place: g.place, cat: g.cat, cents };
  });
}
function guessCat(place, list) {
  const seen = list.find(p => p.place && p.place.toLowerCase() === place.toLowerCase());
  if (seen) return seen.cat;
  for (const [re, cat] of KEYWORDS) if (re.test(place)) return cat;
  return "food";
}
/** "13 chipotle", "chipotle 12.50", "$8 kroger" */
function parseQuick(text) {
  const m = text.match(/\$?(\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const cents = toCents(m[1].replace(",", "."));
  const place = titleCase(text.replace(m[0], "").replace(/\s+/g, " ").trim());
  return cents ? { cents, place } : null;
}

async function addPurchase(p) {
  const id = "p-" + Date.now().toString(36) + uid();
  await store.put(APP, id, { cents: p.cents, cat: p.cat, place: p.place || "", at: p.at || Date.now(), note: p.note || "" });
  return id;
}

/* ---------- view ---------- */
let ctx0, root, tab = "budget", recapWeek = 0, pickCat = "auto";
const $ = s => root.querySelector(s);
function setRoute() { history.replaceState(null, "", `${location.pathname}${location.search}#wallet${tab === "recap" ? "/recap" : ""}`); }

function undoToast(msg, undo) {
  ctx0.toast(msg, { label: "Undo", run: async () => { hideToast(); await undo(); render(); } });
  const t = document.querySelector(".toast"), mine = t && t.firstChild && t.firstChild.textContent;
  setTimeout(() => { const n = document.querySelector(".toast"); if (n && n.firstChild && n.firstChild.textContent === mine) n.hidden = true; }, 6000);
}
function hideToast() { const t = document.querySelector(".toast"); if (t) t.hidden = true; }

async function render() {
  root.querySelectorAll(".ap-tabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  const st = await status();
  if (!st) return renderSetup();
  if (tab === "recap") renderRecap(st); else renderBudget(st);
}

function renderSetup() {
  $("#wl-body").innerHTML = `
    <form class="ap-card pad wl-setup" id="wl-setup">
      <span class="wl-setup-ic">${svg("wallet")}</span>
      <h2>Set your weekly food budget</h2>
      <p class="ap-hint">Covers eating out, delivery and groceries. Log a purchase in a tap, and see what's left until the week resets.</p>
      ${settingsFields({ foodCents: 0, goingOutCents: 0, weekStart: "mon" })}
      <button class="pill-btn" type="submit">Start</button>
    </form>`;
  $("#wl-setup").onsubmit = e => { e.preventDefault(); saveSettingsForm(e.target); };
}
const settingsFields = s => `
  <label class="wl-f">Weekly food budget<input class="field" name="food" inputmode="decimal" required value="${s.foodCents ? s.foodCents / 100 : ""}" placeholder="$100"></label>
  <label class="wl-f">Going-out cap (optional)<input class="field" name="going" inputmode="decimal" value="${s.goingOutCents ? s.goingOutCents / 100 : ""}" placeholder="No cap"></label>
  <label class="wl-f">Week starts on<select class="field" name="ws"><option value="mon" ${s.weekStart !== "sun" ? "selected" : ""}>Monday</option><option value="sun" ${s.weekStart === "sun" ? "selected" : ""}>Sunday</option></select></label>`;
async function saveSettingsForm(f) {
  const foodCents = toCents(f.food.value);
  if (!foodCents) { f.food.focus(); return false; }
  await store.put(APP, "settings", { foodCents, goingOutCents: toCents(f.going.value), weekStart: f.ws.value });
  render(); return true;
}
function openSettings(s) {
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet" role="dialog" aria-modal="true"><h2>Wallet settings</h2>${settingsFields(s)}
    <div class="acts"><span></span><span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">Save</button></span></div></form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  f.querySelector('[data-act="cancel"]').onclick = close;
  f.onsubmit = async e => { e.preventDefault(); if (await saveSettingsForm(f)) { close(); ctx0.toast("Budget saved"); } };
}

function meter(spent, cap, tone) {
  const pct = cap ? Math.min(100, Math.round(spent / cap * 100)) : 0;
  return `<div class="ap-bar-meter wl-meter"><i style="width:${pct}%;background:${toneColor(tone)}"></i></div>`;
}

function renderBudget(st) {
  const { s, list, wk, left, perDay, lastDay, tone } = st;
  const going = s.goingOutCents ? (() => { const p = wk.going / s.goingOutCents * 100; return { tone: p > 100 ? "bad" : p >= 75 ? "warn" : "good" }; })() : null;
  const chips = usuals(list);
  const days = [];
  for (const p of wk.items) { const d = dayStart(p.at); let g = days.find(x => x.d === d); if (!g) days.push(g = { d, items: [] }); g.items.push(p); }
  $("#wl-body").innerHTML = `
    <section class="ap-card pad wl-hero">
      <span class="wl-k">Food this week</span>
      <div class="wl-big ${left < 0 ? "over" : ""}">${whole(left)}<span>${left < 0 ? "over" : "left"}</span></div>
      ${meter(wk.food, s.foodCents, tone)}
      <div class="wl-sub"><span>${money(wk.food)} of ${whole(s.foodCents)}</span><span>${left > 0 ? (lastDay === "today" ? "last day of the week" : `about ${whole(perDay)}/day ${lastDay}`) : left === 0 ? `right at budget` : `new week starts ${wd(wk.end)}`}</span></div>
      ${going ? `<div class="wl-going"><span class="wl-sub"><span>Going out</span><span>${money(wk.going)} of ${whole(s.goingOutCents)}</span></span>${meter(wk.going, s.goingOutCents, going.tone)}</div>` : ""}
    </section>

    <form class="ap-input wl-quick" id="wl-quick" autocomplete="off">
      ${svg("plus")}<input id="wl-text" placeholder="13 chipotle" aria-label="Amount and place, like 13 chipotle" enterkeyhint="done">
      <button class="pill-btn" type="submit">Add</button>
    </form>
    <div class="wl-cats" role="group" aria-label="Category">
      ${[["auto", "Auto"], ...Object.entries(CATS).map(([k, v]) => [k, v.label])].map(([k, l]) => `<button type="button" data-cat="${k}" aria-pressed="${pickCat === k}">${k !== "auto" ? `<i style="background:${CATS[k].color}"></i>` : ""}${l}</button>`).join("")}
    </div>

    ${chips.length ? `<section class="ap-sec"><h3>Usual</h3><div class="wl-chips">${chips.map((c, i) => `<button class="wl-chip" data-usual="${i}"><i style="background:${(CATS[c.cat] || CATS.other).color}"></i><b>${esc(c.place)}</b><span>${money(c.cents)}</span></button>`).join("")}</div></section>`
      : `<p class="ap-hint wl-tip">Type an amount and a place, like <b>13 chipotle</b>. Places you go often turn into one-tap buttons here.</p>`}

    <section class="ap-sec"><h3>This week<span class="n">${wk.items.length}</span></h3>
      ${days.length ? `<div class="ap-card">${days.map(g => `<div class="wl-day"><span>${new Date(g.d).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span><span>${money(g.items.reduce((n, p) => n + p.cents, 0))}</span></div>
        ${g.items.map(p => `<div class="ap-row wl-row" data-p="${p.id}"><i class="ap-swatch" style="background:${(CATS[p.cat] || CATS.other).color}"></i>
          <span class="grow"><span class="t">${esc(p.place || (CATS[p.cat] || CATS.other).label)}</span><span class="s">${esc((CATS[p.cat] || CATS.other).label)} · ${new Date(p.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</span></span>
          <b class="wl-amt">${money(p.cents)}</b><button class="icon-btn" data-rm="${p.id}" aria-label="Remove">${svg("x")}</button></div>`).join("")}`).join("")}</div>`
      : `<div class="ap-card"><div class="ap-empty"><b>Nothing logged this week</b>Your week runs ${wd(wk.start, "long")} to ${wd(wk.end - D, "long")}.</div></div>`}
    </section>`;

  $("#wl-quick").onsubmit = async e => {
    e.preventDefault();
    const inp = $("#wl-text"), q = parseQuick(inp.value);
    if (!q) { inp.focus(); ctx0.toast("Start with an amount, like 13 chipotle"); return; }
    const cat = pickCat === "auto" ? guessCat(q.place, list) : pickCat;
    const id = await addPurchase({ ...q, cat });
    inp.value = ""; pickCat = "auto";
    await render();
    undoToast(`Added ${money(q.cents)}${q.place ? " · " + q.place : ""}`, () => store.remove(APP, id));
  };
  root.querySelectorAll("[data-cat]").forEach(b => b.onclick = () => {
    pickCat = b.dataset.cat;
    root.querySelectorAll("[data-cat]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    $("#wl-text").focus();
  });
  root.querySelectorAll("[data-usual]").forEach(b => b.onclick = async () => {
    const c = chips[+b.dataset.usual];
    const id = await addPurchase(c);
    await render();
    undoToast(`Added ${money(c.cents)} · ${c.place}`, () => store.remove(APP, id));
  });
  root.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => {
    const p = list.find(x => x.id === b.dataset.rm); if (!p) return;
    await store.remove(APP, p.id); await render();
    const { id, ...data } = p;
    undoToast(`Removed ${money(p.cents)}${p.place ? " · " + p.place : ""}`, () => store.put(APP, id, data));
  });
}

function renderRecap(st) {
  const { s, list } = st, now = Date.now();
  const thisStart = weekOf(now, s.weekStart);
  const start = addDays(thisStart, -7 * recapWeek);
  const wk = weekStats(list, start, s);
  const prev = weekStats(list, addDays(start, -7), s);
  const four = [1, 2, 3, 4].map(n => weekStats(list, addDays(start, -7 * n), s));
  const firstAt = list.length ? list[list.length - 1].at : now;
  const counted = four.filter(w => w.end > firstAt);
  const avg = k => counted.length ? counted.reduce((n, w) => n + (k === "total" ? w.total : w.by[k]), 0) / counted.length : 0;
  const eight = [...Array(8)].map((_, i) => weekStats(list, addDays(start, -7 * (7 - i)), s));
  const maxBar = Math.max(s.foodCents, ...eight.map(w => w.food), 1);
  // weeks in a row under the food budget, counting back from the last finished week
  let streak = 0;
  for (let w = addDays(thisStart, -7); addDays(w, 7) > firstAt; w = addDays(w, -7)) { if (weekStats(list, w, s).under) streak++; else break; }
  const dayTotals = new Map();
  for (const p of wk.items) dayTotals.set(dayStart(p.at), (dayTotals.get(dayStart(p.at)) || 0) + p.cents);
  const big = [...dayTotals].sort((a, b) => b[1] - a[1])[0];
  const places = new Map();
  for (const p of wk.items) { const k = (p.place || CATS[p.cat]?.label || "Other"); const g = places.get(k.toLowerCase()) || { name: k, cents: 0, n: 0 }; g.cents += p.cents; g.n++; places.set(k.toLowerCase(), g); }
  const top = [...places.values()].sort((a, b) => b.cents - a.cents).slice(0, 3);
  const delta = (a, b) => { const d = a - b; return Math.abs(d) < 100 ? `<span class="wl-d same">same</span>` : `<span class="wl-d ${d > 0 ? "up" : "down"}">${d > 0 ? "+" : "−"}${whole(d)}</span>`; };
  const label = recapWeek === 0 ? "This week" : recapWeek === 1 ? "Last week" : `${new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" })} week`;

  $("#wl-body").innerHTML = `
    <div class="wl-weeknav">
      <button class="icon-btn" id="wl-prev" aria-label="Earlier week">${svg("chevronLeft")}</button>
      <span><b>${label}</b><span class="ap-hint">${new Date(start).toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${new Date(wk.end - D).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span></span>
      <button class="icon-btn" id="wl-next" aria-label="Later week" ${recapWeek === 0 ? "disabled" : ""}>${svg("chevronRight")}</button>
    </div>
    <section class="ap-card pad wl-hero">
      <span class="wl-k">Spent</span>
      <div class="wl-big">${money(wk.total)}</div>
      <div class="wl-sub"><span>vs last week ${delta(wk.total, prev.total)}</span><span>4-week avg ${counted.length ? whole(avg("total")) : "—"}</span></div>
      <div class="wl-sub"><span>Food ${money(wk.food)} of ${whole(s.foodCents)}</span><span class="ap-pill ${wk.under ? "good" : "bad"}">${wk.under ? "under budget" : `${whole(wk.food - s.foodCents)} over`}</span></div>
    </section>

    <section class="ap-sec"><h3>By category</h3>
      <div class="ap-card">${Object.entries(CATS).map(([k, c]) => `<div class="ap-row wl-cat-row"><i class="ap-swatch" style="background:${c.color}"></i><span class="grow"><span class="t">${c.label}</span><span class="s">last week ${money(prev.by[k])} · avg ${whole(avg(k))}</span></span>${delta(wk.by[k], prev.by[k])}<b class="wl-amt">${money(wk.by[k])}</b></div>`).join("")}</div>
    </section>

    <section class="ap-sec"><h3>Food, last 8 weeks</h3>
      <div class="ap-card pad"><div class="wl-chart" style="--line:${Math.round(s.foodCents / maxBar * 100)}%">
        ${eight.map((w, i) => `<div class="wl-col ${i === 7 ? "cur" : ""}"><span class="wl-v">${w.food ? whole(w.food) : ""}</span><div class="wl-track"><i style="height:${Math.round(w.food / maxBar * 100)}%;background:${w.under ? "var(--good)" : "var(--bad)"}"></i></div><span class="wl-x">${new Date(w.start).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</span></div>`).join("")}
        <span class="wl-budget-line" aria-hidden="true"></span>
      </div><span class="ap-hint">Dashed line: your ${whole(s.foodCents)} budget</span></div>
    </section>

    <div class="wl-stats">
      <div class="ap-card pad"><span class="wl-k">Biggest day</span><b>${big ? money(big[1]) : "—"}</b><span class="ap-hint">${big ? wd(big[0], "long") : "nothing yet"}</span></div>
      <div class="ap-card pad"><span class="wl-k">Delivery orders</span><b>${wk.items.filter(p => p.cat === "delivery").length}</b><span class="ap-hint">${money(wk.by.delivery)}</span></div>
      <div class="ap-card pad"><span class="wl-k">Under-budget streak</span><b>${streak} wk${streak === 1 ? "" : "s"}</b><span class="ap-hint">finished weeks in a row</span></div>
    </div>

    <section class="ap-sec"><h3>Top places</h3>
      <div class="ap-card">${top.length ? top.map((p, i) => `<div class="ap-row"><span class="wl-rank">${i + 1}</span><span class="grow"><span class="t">${esc(p.name)}</span><span class="s">${p.n} time${p.n === 1 ? "" : "s"}</span></span><b class="wl-amt">${money(p.cents)}</b></div>`).join("") : `<div class="ap-empty">Nothing logged this week.</div>`}</div>
    </section>`;
  $("#wl-prev").onclick = () => { recapWeek++; render(); };
  $("#wl-next").onclick = () => { if (recapWeek > 0) { recapWeek--; render(); } };
}

/* ---------- for the rest of GooseOS ---------- */
async function widget(el) {
  const st = await status();
  if (!st) { el.innerHTML = `<span class="h-k">Wallet</span><span class="h-t">Set a weekly food budget</span>`; return; }
  el.innerHTML = `<span class="h-k">Food this week</span><span class="h-big">${whole(st.left)}</span>
    <span class="h-t">${st.left < 0 ? "over budget" : `left ${st.lastDay}`}</span>
    <span class="h-s">${st.left > 0 ? (st.lastDay === "today" ? "last day of the week" : `about ${whole(st.perDay)}/day`) : `${money(st.wk.food)} of ${whole(st.s.foodCents)}`}</span>
    <span class="h-meter"><i style="width:${Math.min(100, st.pct)}%;background:${toneColor(st.tone)}"></i></span>`;
}
async function summary() {
  const st = await status(); if (!st) return null;
  return { label: "Food this week", value: st.left < 0 ? `${whole(st.left)} over` : `${whole(st.left)} left`,
    sub: st.left > 0 ? (st.lastDay === "today" ? "last day of the week" : `about ${whole(st.perDay)}/day ${st.lastDay}`) : `${money(st.wk.food)} of ${whole(st.s.foodCents)}`,
    pct: Math.min(100, st.pct), tone: st.tone, open: "#wallet" };
}
/** The Sunday 7 PM recap ping, for Reminders. */
async function agenda() {
  const st = await status(); if (!st) return [];
  const sun = addDays(dayStart(Date.now()), (7 - new Date().getDay()) % 7);
  const due = sun + 19 * 3600e3;
  // weeks that start Sunday have just ended by Sunday night, so recap the one before
  const wk = weekStats(st.list, weekOf(addDays(sun, st.s.weekStart === "sun" ? -1 : 0), st.s.weekStart), st.s);
  return [{ key: `wallet:recap-${ymd(sun)}`, title: "Your week in money", kind: "ping", due, done: false, open: "#wallet/recap",
    body: `${money(wk.total)} spent this week. Food: ${money(wk.food)} of ${whole(st.s.foodCents)}.` }];
}

let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./wallet.css", import.meta.url).href;
  document.head.appendChild(link);
}
async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap");
  el.innerHTML = `<div class="ap-bar"><button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button><span class="ap-title">Wallet</span><span class="ap-spacer"></span>
    <div class="ap-tabs" role="group" aria-label="View"><button data-tab="budget">Budget</button><button data-tab="recap">Recap</button></div>
    <button class="icon-btn" id="wl-set" aria-label="Wallet settings">${svg("settings")}</button></div>
    <div class="ap-scroll"><div class="ap-body" id="wl-body"></div></div>`;
  el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; recapWeek = 0; setRoute(); el.querySelector(".ap-scroll").scrollTop = 0; render(); });
  $("#wl-set").onclick = async () => openSettings((await getSettings()) || { foodCents: 0, goingOutCents: 0, weekStart: "mon" });
  store.onChange(ch => { if (ch.source === "remote" && ch.app === APP && ctx.isActive()) render(); });
}
async function show(arg) {
  tab = arg === "recap" ? "recap" : "budget"; recapWeek = 0;
  if (tab === "recap") { const s = await getSettings(); if (s && s.weekStart === "sun" && new Date().getDay() === 0) recapWeek = 1; }
  await render();
  if (tab === "budget") { const i = root.querySelector("#wl-text"); if (i && matchMedia("(min-width:900px)").matches) i.focus(); }
}

export default { id: APP, name: "Wallet", icon: "wallet", color: ["#34d399", "#059669"], mount, show, widget, summary, agenda, complete() {} };
