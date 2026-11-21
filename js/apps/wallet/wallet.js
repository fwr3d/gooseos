// Wallet: a monthly allowance you log by hand (no bank login). Every purchase
// comes out of one pot, and Wallet tells you what's safe to spend per day and
// this week. Two tabs, same data: Budget and Recap.
//
// Saved items:
//   app "wallet", id "settings": { monthlyCents, payday (1-28), weekStart: "mon" | "sun",
//                                  startLeftCents?, startAt? }
//     startLeftCents/startAt: "I had this much left at this moment". Used for the
//     month it was typed in, so you can start mid-month. Later months start from monthlyCents.
//   app "wallet", any other id: one purchase { cents, cat, place, at (ms), note }
// A month runs from payday to the day before the next payday, even if the
// deposit lands a few days late. Leftover money does not roll over.
import * as store from "../../store.js";
import { svg, tile } from "../../icons.js";

const APP = "wallet", D = 864e5;
const CATS = {
  groceries: { label: "Groceries", color: "#22a45d" },
  food: { label: "Food out", color: "#f59e0b" },
  delivery: { label: "Delivery", color: "#ef4444" },
  alcohol: { label: "Alcohol", color: "#0ea5e9" },
  weed: { label: "Weed", color: "#65a30d" },
  nicotine: { label: "Nicotine", color: "#a855f7" },
  going: { label: "Going out", color: "#ec4899" },
  other: { label: "Other", color: "#64748b" },
};
const cat = k => CATS[k] || CATS.other;
const KEYWORDS = [
  [/vape|zyn|juul|nic\b|nicotine|pouch|cig|elf ?bar|geek ?bar|lost mary|smoke shop/i, "nicotine"],
  [/dispensary|weed|\bcart\b|pre-?roll|edible|gumm|flower|thc|\bdab\b|\bpen\b/i, "weed"],
  [/liquor|beer|wine|vodka|tequila|whiskey|rum|seltzer|white ?claw|truly|\bsix\b|30 ?rack|abc store/i, "alcohol"],
  [/doordash|uber ?eats|grubhub|postmates|delivery/i, "delivery"],
  [/kroger|walmart|target|aldi|meijer|costco|trader|whole foods|grocer|market|sam'?s club/i, "groceries"],
  [/chipotle|panera|mcdonald|starbucks|jimmy ?john|subway|wendy|taco bell|chick-?fil|burger|pizza|domino|papa john|five guys|qdoba|panda|dunkin|coffee|caf[eé]|wingstop|cane'?s|culver|popeyes|kfc|sonic|arby|noodles|potbelly|jersey mike|sbarro|ihop|waffle|diner|grill|sushi|ramen|pho\b|bagel|donut|smoothie|boba/i, "food"],
  [/\bbar\b|club|ticket|movie|cinema|concert|bowling|party/i, "going"],
];

const uid = () => Math.random().toString(36).slice(2, 9);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const money = c => `${c < 0 ? "−" : ""}$${(Math.abs(c) / 100).toLocaleString(undefined, { minimumFractionDigits: c % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const whole = c => `$${(c >= 0 ? Math.floor(c / 100) : Math.ceil(-c / 100)).toLocaleString()}`;   // never shows more than is there
const daily = c => c < 1000 ? `$${(Math.floor(c) / 100).toFixed(2)}` : whole(c);   // safe-to-spend: cents under $10, rounded down
const toCents = v => { const n = parseFloat(String(v).replace(/[$,\s]/g, "")); return isFinite(n) && n >= 0 ? Math.round(n * 100) : NaN; };
const dayStart = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return +d; };
const addDays = (t, n) => { const d = new Date(dayStart(t)); d.setDate(d.getDate() + n); return +d; };
const daysBetween = (a, b) => Math.round((dayStart(b) - dayStart(a)) / D);
const ymd = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const wd = (t, style = "short") => new Date(t).toLocaleDateString(undefined, { weekday: style });
const md = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
const ord = n => n + ([11, 12, 13].includes(n) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" }[n % 10] || "th"));
const titleCase =s => s === s.toLowerCase() ? s.replace(/\b[a-z]/g, c => c.toUpperCase()) : s;

/* ---------- data ---------- */
async function getSettings() { const s = await store.get(APP, "settings"); return s && s.monthlyCents ? s : null; }
async function purchases() {
  return (await store.list(APP)).filter(r => r.id !== "settings" && r.data && r.data.cents)
    .map(r => ({ id: r.id, ...r.data })).sort((a, b) => b.at - a.at);
}
const spent = (list, from, to) => list.reduce((n, p) => p.at >= from && p.at < to ? n + p.cents : n, 0);

/** Midnight on the first day of the week that holds t. */
function weekOf(t, ws = "mon") {
  const d = dayStart(t), dow = new Date(d).getDay();
  return addDays(d, -(ws === "sun" ? dow : (dow + 6) % 7));
}
/** The allowance month holding t: payday up to (not including) the next payday. */
function periodOf(t, payday = 1) {
  const pd = Math.min(28, Math.max(1, payday | 0)), d = new Date(t);
  let start = new Date(d.getFullYear(), d.getMonth(), pd);
  if (dayStart(t) < +start) start = new Date(d.getFullYear(), d.getMonth() - 1, pd);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, pd);
  return { start: +start, end: +end, days: daysBetween(start, end) };
}
const periodName = (p, payday) => payday === 1
  ? new Date(p.start).toLocaleDateString(undefined, { month: "long" })
  : `${md(p.start)} – ${md(p.end - D)}`;
/** What a month started with: the typed "left right now" for the month you set up in, else the allowance. */
function baseOf(s, per) {
  if (s.startAt && s.startAt >= per.start && s.startAt < per.end) return { from: s.startAt, cents: s.startLeftCents || 0, partial: true };
  return { from: per.start, cents: s.monthlyCents, partial: false };
}
/** Did you track this month at all? (Months before you set Wallet up don't count.) */
const tracked = (s, per) => !s.startAt || per.end > s.startAt;

/** Where you are right now. Used by the app, the widget, Today and Reminders. */
async function status(now = Date.now()) {
  const s = await getSettings(); if (!s) return null;
  const list = await purchases();
  const per = periodOf(now, s.payday), base = baseOf(s, per);
  const left = base.cents - spent(list, base.from, per.end);
  const daysLeft = Math.max(1, daysBetween(now, per.end));
  const perDay = Math.max(0, left) / daysLeft;
  // this week's share: what was left when the week (or your tracking) began, split over the days left then
  const wStart = weekOf(now, s.weekStart), b = Math.max(wStart, base.from);
  const weekSpent = spent(list, b, per.end);
  const leftAtB = left + weekSpent, daysAtB = Math.max(1, daysBetween(b, per.end));
  // a full week's worth at the pace you had when the week began, never more than was left
  const weekShare = Math.min(Math.max(0, leftAtB), Math.max(0, leftAtB) / daysAtB * 7);
  const weekEnd = Math.min(addDays(wStart, 7), per.end);
  const showWeek = daysBetween(b, weekEnd) >= 3;   // a 1-2 day stub of a week (just set up, or month ending) gets no week bar
  const weekTone = weekSpent > weekShare ? "bad" : weekSpent > weekShare * 0.75 ? "warn" : "good";
  const pace = s.monthlyCents / per.days;
  const tone = left < 0 ? "bad" : perDay < pace * 0.8 ? "warn" : "good";   // month pace only
  return { s, list, per, base, left, daysLeft, perDay, weekSpent, weekShare, weekEnd, showWeek, weekTone, tone };
}
const toneColor = t => t === "bad" ? "var(--bad)" : t === "warn" ? "var(--warn)" : "var(--good)";

/** Your usual places: what you buy often, at the amount you usually pay. */
function usuals(list, now = Date.now()) {
  const groups = new Map();
  for (const p of list) {
    if (!p.place || p.at < now - 75 * D) continue;
    const k = `${p.place.toLowerCase()}|${p.cat}`;
    const g = groups.get(k) || { place: p.place, cat: p.cat, score: 0, amounts: new Map(), last: 0 };
    g.score += 1 + Math.max(0, 1 - (now - p.at) / (30 * D));
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
  for (const [re, c] of KEYWORDS) if (re.test(place)) return c;
  return "other";
}
const WEEKDAYS = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
/** A past day said in words: "yesterday", "fri", "last fri", "2 days ago". Returns { at, words } or null. */
function parseWhen(text, now = Date.now()) {
  const noonOf = t => dayStart(t) + 12 * 3600e3;   // past days get noon: the exact time doesn't matter
  let m;
  if ((m = text.match(/\b(yesterday|yday|ytd)\b/i))) return { at: noonOf(addDays(now, -1)), words: m[0] };
  if ((m = text.match(/\b(\d)\s+days?\s+ago\b/i))) return { at: noonOf(addDays(now, -+m[1])), words: m[0] };
  // bare "sun" is too often a name (Sun King), so it needs "sunday" or "last sun"
  if ((m = text.match(/\b(?:last\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i))
    && !(/^sun$/i.test(m[0]))) {
    let back = (new Date(now).getDay() - WEEKDAYS[m[1].toLowerCase()] + 7) % 7;
    if (back === 0 && /^last/i.test(m[0])) back = 7;   // "fri" on a Friday = today, "last fri" = a week ago
    return { at: back === 0 ? now : noonOf(addDays(now, -back)), words: m[0] };
  }
  return null;
}
/** "13 chipotle", "chipotle 12.50", "$8 kroger", "12 chipotle yesterday" */
function parseQuick(text, now = Date.now()) {
  const when = parseWhen(text, now);
  const rest = when ? text.replace(when.words, " ") : text;
  const m = rest.match(/\$?(\d+(?:[.,]\d{1,2})?)/);
  if (!m) return null;
  const cents = toCents(m[1].replace(",", "."));
  const place = titleCase(rest.replace(m[0], "").replace(/\s+/g, " ").trim());
  return cents > 0 ? { cents, place, ...(when && when.at !== now ? { at: when.at } : {}) } : null;
}
async function addPurchase(p) {
  const id = "p-" + Date.now().toString(36) + uid();
  await store.put(APP, id, { cents: p.cents, cat: p.cat, place: p.place || "", at: p.at || Date.now(), note: p.note || "" });
  return id;
}

/* ---------- view ---------- */
let ctx0, root, tab = "budget", recapMonth = 0, pickCat = "auto";
const $ = s => root.querySelector(s);
function setRoute() { history.replaceState(null, "", `${location.pathname}${location.search}#wallet${tab === "recap" ? "/recap" : ""}`); }

function undoToast(msg, undo) {
  ctx0.toast(msg, { label: "Undo", run: async () => { hideToast(); await undo(); render(); } });
  const t = document.querySelector(".toast"), mine = t && t.firstChild && t.firstChild.textContent;
  setTimeout(() => { const n = document.querySelector(".toast"); if (n && n.firstChild && n.firstChild.textContent === mine) n.hidden = true; }, 6000);
}
function hideToast() { const t = document.querySelector(".toast"); if (t) t.hidden = true; }

import { latest } from "../../latest.js";
const render = latest(renderNow);
async function renderNow() {
  root.querySelectorAll(".ap-tabs button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.tab === tab)));
  const st = await status();
  if (!st) return renderSetup();
  if (tab === "recap") renderRecap(st); else renderBudget(st);
}

const settingsFields = (s, setup) => `
  <label class="wl-f">Monthly allowance<input class="field" name="monthly" inputmode="decimal" required value="${s.monthlyCents ? s.monthlyCents / 100 : ""}" placeholder="$400"></label>
  <div class="wl-two">
    <label class="wl-f">Payday (day of month)<select class="field" name="payday">${[...Array(28)].map((_, i) => `<option value="${i + 1}" ${(s.payday || 1) === i + 1 ? "selected" : ""}>${ord(i + 1)}</option>`).join("")}</select></label>
    <label class="wl-f">Week starts<select class="field" name="ws"><option value="mon" ${s.weekStart !== "sun" ? "selected" : ""}>Monday</option><option value="sun" ${s.weekStart === "sun" ? "selected" : ""}>Sunday</option></select></label>
  </div>
  <label class="wl-f">${setup ? "How much of this month's money do you have left right now?" : "Correct what's left right now <span class=\"wl-opt\">(optional)</span>"}
    <input class="field" name="left" inputmode="decimal" ${setup ? "required" : ""} placeholder="${setup ? "$212" : "Leave empty to keep the math as is"}"></label>`;

function renderSetup() {
  $("#wl-body").innerHTML = `
    <form class="ap-card pad wl-setup" id="wl-setup">
      <span class="wl-setup-ic">${svg("wallet")}</span>
      <h2>Set up your monthly money</h2>
      <p class="wl-note">Everything you buy comes out of one monthly pot. Wallet works out what's safe to spend each day and this week.</p>
      ${settingsFields({ monthlyCents: 0, payday: 1, weekStart: "mon" }, true)}
      <p class="wl-note">Bank a few days late? That's fine. The month still counts from payday.</p>
      <button class="pill-btn" type="submit">Start</button>
    </form>`;
  $("#wl-setup").onsubmit = e => { e.preventDefault(); saveSettingsForm(e.target); };
}
async function saveSettingsForm(f) {
  const monthlyCents = toCents(f.monthly.value);
  if (!(monthlyCents > 0)) { f.monthly.focus(); return false; }
  const prev = (await store.get(APP, "settings")) || {};
  const next = { monthlyCents, payday: +f.payday.value || 1, weekStart: f.ws.value, startLeftCents: prev.startLeftCents, startAt: prev.startAt };
  if (f.left.value.trim() !== "") {
    const l = toCents(f.left.value); if (isNaN(l)) { f.left.focus(); return false; }
    next.startLeftCents = l; next.startAt = Date.now();
  } else if (!prev.monthlyCents) { f.left.focus(); return false; }
  delete next.foodCents;
  await store.put(APP, "settings", next);
  render(); return true;
}
function openSettings(s) {
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet" role="dialog" aria-modal="true"><h2>Wallet settings</h2>${settingsFields(s, false)}
    <div class="acts"><span></span><span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">Save</button></span></div></form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  f.querySelector('[data-act="cancel"]').onclick = close;
  f.onsubmit = async e => { e.preventDefault(); if (await saveSettingsForm(f)) { close(); ctx0.toast("Saved"); } };
}

function meter(used, cap, tone, cls = "") {
  const pct = cap > 0 ? Math.min(100, Math.round(used / cap * 100)) : used > 0 ? 100 : 0;
  return `<div class="ap-bar-meter wl-meter ${cls}"><i style="width:${pct}%;background:${toneColor(tone)}"></i></div>`;
}

function renderBudget(st) {
  const { s, list, per, base, left, daysLeft, perDay, weekSpent, weekShare, weekEnd, tone } = st;
  const chips = usuals(list);
  const weekLeft = weekShare - weekSpent;
  const shown = list.filter(p => p.at >= weekOf(Date.now(), s.weekStart));
  const days = [];
  for (const p of shown) { const d = dayStart(p.at); let g = days.find(x => x.d === d); if (!g) days.push(g = { d, items: [] }); g.items.push(p); }
  const lastWeekDay = wd(weekEnd - D);
  $("#wl-body").innerHTML = `
    <section class="ap-card pad wl-hero">
      <span class="wl-k">Safe to spend</span>
      <div class="wl-big ${left < 0 ? "over" : ""}">${left < 0 ? `${whole(left)}<span>over for the month</span>` : `${daily(perDay)}<span>/day</span>`}</div>
      ${st.showWeek ? `${meter(weekSpent, weekShare, st.weekTone)}
      <div class="wl-sub"><span>This week ${money(weekSpent)} of ${whole(weekShare)}</span><span>${weekLeft >= 0 ? `${whole(weekLeft)} left${daysBetween(Date.now(), weekEnd) > 1 ? ` through ${lastWeekDay}` : " today"}` : `${whole(weekLeft)} over this week`}</span></div>`
      : `<div class="wl-sub"><span>Weekly budget starts ${wd(weekEnd, "long")}</span><span>about ${whole(Math.min(Math.max(0, left), perDay * 7))}/week</span></div>`}
      <div class="wl-month">
        <div class="wl-sub"><span><b>${left < 0 ? `${whole(left)} over` : `${whole(left)} left`}</b> of ${whole(base.partial ? base.cents : s.monthlyCents)}${base.partial ? " (since you started)" : ""}</span><span>${daysLeft} day${daysLeft === 1 ? "" : "s"} left in ${periodName(per, s.payday)}</span></div>
        ${meter(base.cents - left, base.cents, tone, "thin")}
      </div>
    </section>

    <form class="ap-input wl-quick" id="wl-quick" autocomplete="off">
      ${svg("plus")}<input id="wl-text" placeholder="45 kroger" aria-label="Amount and place, like 45 kroger" enterkeyhint="done">
      <button class="pill-btn" type="submit">Add</button>
    </form>
    <div class="wl-cats" role="group" aria-label="Category">
      ${[["auto", "Auto"], ...Object.entries(CATS).map(([k, v]) => [k, v.label])].map(([k, l]) => `<button type="button" data-cat="${k}" aria-pressed="${pickCat === k}">${k !== "auto" ? `<i style="background:${CATS[k].color}"></i>` : ""}${l}</button>`).join("")}
    </div>

    ${chips.length ? `<section class="ap-sec"><h3>Usual</h3><div class="wl-chips">${chips.map((c, i) => `<button class="wl-chip" data-usual="${i}"><i style="background:${cat(c.cat).color}"></i><b>${esc(c.place)}</b><span>${money(c.cents)}</span></button>`).join("")}</div></section>`
      : `<p class="wl-note wl-tip">Type an amount and a place, like <b>45 kroger</b>. Pick a category above, or leave it on Auto. Places you buy from often turn into one-tap buttons here.</p>`}

    <section class="ap-sec"><h3>This week<span class="n">${shown.length}</span></h3>
      ${days.length ? `<div class="ap-card">${days.map(g => `<div class="wl-day"><span>${new Date(g.d).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</span><span>${money(g.items.reduce((n, p) => n + p.cents, 0))}</span></div>
        ${g.items.map(p => `<div class="ap-row wl-row" data-p="${p.id}"><i class="ap-swatch" style="background:${cat(p.cat).color}"></i>
          <button class="grow wl-edit" data-edit="${p.id}" aria-label="Edit ${esc(p.place || cat(p.cat).label)}"><span class="t">${esc(p.place || cat(p.cat).label)}</span><span class="s">${esc(cat(p.cat).label)} · ${new Date(p.at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}${p.note ? ` · ${esc(p.note)}` : ""}${p.at < base.from ? " · before you started" : ""}</span></button>
          <b class="wl-amt">${money(p.cents)}</b><button class="icon-btn" data-rm="${p.id}" aria-label="Remove">${svg("x")}</button></div>`).join("")}`).join("")}</div>`
      : `<div class="ap-card"><div class="ap-empty"><b>Nothing logged this week</b>Your week runs ${wd(weekOf(Date.now(), s.weekStart), "long")} to ${wd(addDays(weekOf(Date.now(), s.weekStart), 6), "long")}.</div></div>`}
    </section>`;

  $("#wl-quick").onsubmit = async e => {
    e.preventDefault();
    const inp = $("#wl-text"), q = parseQuick(inp.value);
    if (!q) { inp.focus(); ctx0.toast("Start with an amount, like 45 kroger"); return; }
    const c = pickCat === "auto" ? guessCat(q.place, list) : pickCat;
    const id = await addPurchase({ ...q, cat: c });
    inp.value = ""; pickCat = "auto";
    await render();
    $("#wl-text").focus();
    const when = q.at ? ` on ${wd(q.at, "long")}` : "";
    undoToast(`Added ${money(q.cents)}${q.place ? " · " + q.place : ""}${when} (${cat(c).label})`, () => store.remove(APP, id));
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
  root.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => { const p = list.find(x => x.id === b.dataset.edit); if (p) editPurchase(p); });
  root.querySelectorAll("[data-rm]").forEach(b => b.onclick = async () => {
    const p = list.find(x => x.id === b.dataset.rm); if (!p) return;
    await store.remove(APP, p.id); await render();
    const { id, ...data } = p;
    undoToast(`Removed ${money(p.cents)}${p.place ? " · " + p.place : ""}`, () => store.put(APP, id, data));
  });
}

/** Fix a purchase: amount, place, category, day, note. */
function editPurchase(p) {
  const back = document.createElement("div"); back.className = "ap-back";
  const localDT = t => { const d = new Date(t), z = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
  back.innerHTML = `<form class="ap-sheet wl-sheet" role="dialog" aria-modal="true" autocomplete="off"><h2>Edit purchase</h2>
    <div class="wl-two">
      <label class="wl-f">Amount<input class="field" name="amt" inputmode="decimal" required value="${(p.cents / 100).toFixed(2)}"></label>
      <label class="wl-f">Category<select class="field" name="cat">${Object.entries(CATS).map(([k, v]) => `<option value="${k}" ${p.cat === k ? "selected" : ""}>${v.label}</option>`).join("")}</select></label>
    </div>
    <label class="wl-f">Place<input class="field" name="place" value="${esc(p.place)}" placeholder="Kroger"></label>
    <label class="wl-f">When<input class="field" type="datetime-local" name="at" required value="${localDT(p.at)}"></label>
    <label class="wl-f">Note <span class="wl-opt">(optional)</span><input class="field" name="note" value="${esc(p.note)}" placeholder="Split with roommate"></label>
    <div class="acts"><button type="button" class="pill-btn danger" data-act="del">Delete</button>
      <span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn" type="submit">Save</button></span></div></form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  f.querySelector('[data-act="cancel"]').onclick = close;
  const { id, ...data } = p;
  f.querySelector('[data-act="del"]').onclick = async () => {
    close(); await store.remove(APP, id); await render();
    undoToast(`Removed ${money(p.cents)}${p.place ? " · " + p.place : ""}`, () => store.put(APP, id, data));
  };
  f.onsubmit = async e => {
    e.preventDefault();
    const cents = toCents(f.amt.value), at = new Date(f.at.value).getTime();
    if (!(cents > 0)) return f.amt.focus();
    if (!isFinite(at)) return f.at.focus();
    await store.put(APP, id, { ...data, cents, cat: f.cat.value, place: f.place.value.trim(), at, note: f.note.value.trim() });
    close(); render(); ctx0.toast("Saved");
  };
  setTimeout(() => f.amt.select(), 50);
}

/** How a whole month went. */
function monthStats(s, list, per) {
  const base = baseOf(s, per), items = list.filter(p => p.at >= per.start && p.at < per.end);
  const counted = items.filter(p => p.at >= base.from);
  const by = {};
  for (const p of items) by[CATS[p.cat] ? p.cat : "other"] = (by[CATS[p.cat] ? p.cat : "other"] || 0) + p.cents;
  const total = items.reduce((n, p) => n + p.cents, 0);
  return { per, base, items, by, total, left: base.cents - counted.reduce((n, p) => n + p.cents, 0) };
}

function renderRecap(st) {
  const { s, list } = st, now = Date.now();
  let per = periodOf(now, s.payday);
  for (let i = 0; i < recapMonth; i++) per = periodOf(per.start - D, s.payday);
  const m = monthStats(s, list, per), cur = recapMonth === 0;
  const prevPer = periodOf(per.start - D, s.payday);
  const prev = tracked(s, prevPer) ? monthStats(s, list, prevPer) : null;
  const canBack = tracked(s, prevPer) || list.some(p => p.at < per.start);
  const name = periodName(per, s.payday);
  const elapsed = Math.max(1, Math.min(per.days, daysBetween(per.start, now) + 1));
  const cats = Object.entries(m.by).sort((a, b) => b[1] - a[1]);
  // last 8 weeks of spending against an even weekly share of the allowance
  const thisWeek = weekOf(now, s.weekStart);
  const weeks = [...Array(8)].map((_, i) => { const a = addDays(thisWeek, -7 * (7 - i)); return { start: a, total: spent(list, a, addDays(a, 7)) }; });
  const share = s.monthlyCents * 7 / 30.44;
  const maxBar = Math.max(share, ...weeks.map(w => w.total), 1);
  const dayTotals = new Map();
  for (const p of m.items) dayTotals.set(dayStart(p.at), (dayTotals.get(dayStart(p.at)) || 0) + p.cents);
  const big = [...dayTotals].sort((a, b) => b[1] - a[1])[0];
  const places = new Map();
  for (const p of m.items) { const k = p.place || cat(p.cat).label; const g = places.get(k.toLowerCase()) || { name: k, cents: 0, n: 0 }; g.cents += p.cents; g.n++; places.set(k.toLowerCase(), g); }
  const top = [...places.values()].sort((a, b) => b.cents - a.cents).slice(0, 3);
  const ended = x => x.left >= 0 ? `${whole(x.left)} left` : `${whole(x.left)} over`;

  $("#wl-body").innerHTML = `
    <div class="wl-weeknav">
      <button class="icon-btn" id="wl-prev" aria-label="Earlier month" ${canBack ? "" : "disabled"}>${svg("chevronLeft")}</button>
      <span><b>${name}</b><span class="wl-note">${md(per.start)} – ${md(per.end - D)}</span></span>
      <button class="icon-btn" id="wl-next" aria-label="Later month" ${cur ? "disabled" : ""}>${svg("chevronRight")}</button>
    </div>
    ${cur && prev ? `<div class="ap-card pad wl-ended">${svg("calendar")}<span>Ended ${esc(periodName(prevPer, s.payday))} with <b class="${prev.left >= 0 ? "good" : "bad"}">${ended(prev)}</b>. It doesn't carry over.</span></div>` : ""}
    <section class="ap-card pad wl-hero">
      <span class="wl-k">Spent in ${esc(name)}</span>
      <div class="wl-big">${money(m.total)}</div>
      <div class="wl-sub"><span>${cur ? `${ended(m)} · ${st.daysLeft} day${st.daysLeft === 1 ? "" : "s"} to go` : `Ended with ${ended(m)}`}</span><span>${whole(m.total / (cur ? elapsed : per.days))}/day average</span></div>
      ${m.base.partial ? `<div class="wl-note">Counting from ${md(m.base.from)}, when you had ${whole(m.base.cents)} left.</div>` : ""}
    </section>

    <section class="ap-sec"><h3>Where it went</h3>
      <div class="ap-card">${cats.length ? cats.map(([k, c]) => `<div class="ap-row wl-cat-row"><i class="ap-swatch" style="background:${cat(k).color}"></i><span class="grow"><span class="t">${cat(k).label}</span>
        <span class="wl-catbar"><i style="width:${Math.round(c / m.total * 100)}%;background:${cat(k).color}"></i></span></span>
        <span class="wl-pct">${Math.round(c / m.total * 100)}%</span><b class="wl-amt">${money(c)}</b></div>`).join("") : `<div class="ap-empty">Nothing logged this month yet.</div>`}</div>
    </section>

    <section class="ap-sec"><h3>Last 8 weeks</h3>
      <div class="ap-card pad"><div class="wl-chart" style="--line:${Math.round(share / maxBar * 100)}%">
        ${weeks.map((w, i) => `<div class="wl-col ${i === 7 ? "cur" : ""}"><span class="wl-v">${w.total ? whole(w.total) : ""}</span><div class="wl-track"><i style="height:${Math.round(w.total / maxBar * 100)}%;background:${w.total > share ? "var(--bad)" : "var(--good)"}"></i></div><span class="wl-x">${new Date(w.start).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })}</span></div>`).join("")}
        <span class="wl-budget-line" aria-hidden="true"></span>
      </div><span class="wl-note">Dashed line: an even week of your ${whole(s.monthlyCents)} (${whole(share)})</span></div>
    </section>

    <div class="wl-stats">
      <div class="ap-card pad"><span class="wl-k">Biggest day</span><b>${big ? money(big[1]) : "—"}</b><span class="wl-note">${big ? `${wd(big[0], "long")}, ${md(big[0])}` : "nothing yet"}</span></div>
      <div class="ap-card pad"><span class="wl-k">Purchases</span><b>${m.items.length}</b><span class="wl-note">${m.items.length ? `${money(Math.round(m.total / m.items.length))} on average` : "this month"}</span></div>
    </div>

    <section class="ap-sec"><h3>Top places</h3>
      <div class="ap-card">${top.length ? top.map((p, i) => `<div class="ap-row"><span class="wl-rank">${i + 1}</span><span class="grow"><span class="t">${esc(p.name)}</span><span class="s">${p.n} time${p.n === 1 ? "" : "s"}</span></span><b class="wl-amt">${money(p.cents)}</b></div>`).join("") : `<div class="ap-empty">Nothing logged this month yet.</div>`}</div>
    </section>
    ${cur && new Date().getDay() === 0 ? `<a class="ap-card ap-row wl-next" href="#reset"><span class="tile-ic" style="${tile("green")}">${svg("listChecks")}</span><span class="grow"><span class="t">Now plan the week</span><span class="s">Weekly Reset: what's due, what's behind, your top 3.</span></span>${svg("chevronRight")}</a>` : ""}`;
  $("#wl-prev").onclick = () => { if (canBack) { recapMonth++; render(); } };
  $("#wl-next").onclick = () => { if (recapMonth > 0) { recapMonth--; render(); } };
}

/* ---------- for the rest of GooseOS ---------- */
async function widget(el) {
  const st = await status();
  if (!st) { el.innerHTML = `<span class="h-k">Wallet</span><span class="h-t">Set up your monthly money</span>`; return; }
  const [used, cap, tone] = st.showWeek ? [st.weekSpent, st.weekShare, st.weekTone] : [st.base.cents - st.left, st.base.cents, st.tone];
  el.innerHTML = `<span class="h-k">Safe to spend</span><span class="h-big">${st.left < 0 ? whole(st.left) : daily(st.perDay)}<small>${st.left < 0 ? " over" : "/day"}</small></span>
    <span class="h-t">${st.left < 0 ? "over for the month" : `${whole(st.left)} left this month`}</span>
    <span class="h-s">${st.showWeek ? `This week ${whole(st.weekSpent)} of ${whole(st.weekShare)}` : `${st.daysLeft} days left in ${periodName(st.per, st.s.payday)}`}</span>
    <span class="h-meter"><i style="width:${cap > 0 ? Math.min(100, Math.max(0, Math.round(used / cap * 100))) : 100}%;background:${toneColor(tone)}"></i></span>`;
}
async function summary() {
  const st = await status(); if (!st) return null;
  return { label: "Safe to spend", value: st.left < 0 ? `${whole(st.left)} over` : `${daily(st.perDay)}/day`,
    sub: st.left < 0 ? `over for ${periodName(st.per, st.s.payday)}` : `${whole(st.left)} left this month · ${st.daysLeft} days`,
    pct: st.base.cents > 0 ? Math.min(100, Math.max(0, Math.round((st.base.cents - st.left) / st.base.cents * 100))) : 100, tone: st.tone, open: "#wallet" };
}
/** The Sunday 7 PM recap ping, for Reminders. */
async function agenda() {
  const st = await status(); if (!st) return [];
  const sun = addDays(dayStart(Date.now()), (7 - new Date().getDay()) % 7);
  const wk = weekOf(addDays(sun, st.s.weekStart === "sun" ? -1 : 0), st.s.weekStart);
  const week = spent(st.list, wk, addDays(wk, 7));
  return [{ key: `wallet:recap-${ymd(sun)}`, title: "Your week in money", kind: "ping", due: sun + 19 * 3600e3, done: false, open: "#wallet/recap",
    body: `${money(week)} spent this week. ${st.left < 0 ? `${whole(st.left)} over for the month.` : `${whole(st.left)} left for the month, about ${daily(st.perDay)}/day.`}` }];
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
  el.querySelectorAll("[data-tab]").forEach(b => b.onclick = () => { tab = b.dataset.tab; recapMonth = 0; setRoute(); el.querySelector(".ap-scroll").scrollTop = 0; render(); });
  $("#wl-set").onclick = async () => openSettings((await store.get(APP, "settings")) || { monthlyCents: 0, payday: 1, weekStart: "mon" });
  store.onChange(ch => { if (ch.source === "remote" && ch.app === APP && ctx.isActive()) render(); });
}
async function show(arg) {
  tab = arg === "recap" ? "recap" : "budget"; recapMonth = 0;
  await render();
  if (tab === "budget") { const i = root.querySelector("#wl-text"); if (i && matchMedia("(min-width:900px)").matches) i.focus(); }
}

// exported for tests
export { periodOf, status, parseQuick, guessCat };
export default { id: APP, name: "Wallet", icon: "wallet", tint: "green", mount, show, widget, summary, agenda, complete() {} };
