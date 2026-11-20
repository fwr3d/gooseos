// Your own Milestones templates, and the sheet that makes them.
// Each step has a name, how long it takes, and when it happens, picked on a
// slider from "right away" to "right before it's due". A timeline and a sample
// plan update as you go, so you can see the template before you use it.
//
// Saved items (app "ms-templates"), one per template:
//   "t-…": { name, steps: [{ title, at (0..1, share of the time until it's due), estMin }], created, updated }
// A milestone made from one stores template "u:<id>" and templateName.
import * as store from "../../store.js";
import { svg } from "../../icons.js";
import { dueLabel } from "../deadlines/parse.js";
import { TEMPLATES, placeSteps, DEFAULT_BLOCKED } from "./plan.js";

const APP = "ms-templates";
const D = 864e5;
const ESTS = [15, 30, 45, 60, 90, 120, 180, 240];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDur = m => m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`;
const uid = () => Math.random().toString(36).slice(2, 10);
const clamp = x => Math.max(0, Math.min(1, x));

export async function loadTemplates() {
  return (await store.list(APP)).map(r => ({ id: r.id, ...r.data }))
    .filter(t => t && Array.isArray(t.steps) && t.steps.length)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}
export async function getTemplate(id) { const t = await store.get(APP, id); return t ? { id, ...t } : null; }

/** Words for a slider position. */
function whenText(at) {
  const p = Math.round(at * 100);
  if (p <= 5) return "Right away";
  if (p < 25) return "Early on";
  if (p < 42) return "About a third of the way";
  if (p < 60) return "About halfway";
  if (p < 80) return "Later on";
  if (p < 93) return "Near the end";
  return "Right before it's due";
}

/** Turn a plan's dated steps back into a template (shares of the time between start and due). */
export function stepsFromPlan(m) {
  const sorted = [...m.steps].sort((a, b) => a.date - b.date);
  const start = Math.min(m.created || Infinity, sorted.length ? sorted[0].date - D : Date.now());
  const span = Math.max(1, m.due - start);
  return sorted.map(s => ({ title: s.title, estMin: s.estMin || 45, at: Math.round(clamp((s.date - start) / span) * 20) / 20 }));
}

/**
 * Open the template sheet over `root`.
 *   edit:    a saved template to change
 *   prefill: { name, steps } to start a new one from (a plan you made)
 *   onSave(template) / onDelete(id)
 */
export function openCreator(root, { edit = null, prefill = null, onSave, onDelete, toast } = {}) {
  let name = edit ? edit.name : prefill ? prefill.name || "" : "";
  let steps = (edit ? edit.steps : prefill ? prefill.steps : [
    { title: "", at: 0.1, estMin: 45 },
    { title: "", at: 0.5, estMin: 60 },
    { title: "", at: 0.9, estMin: 30 },
  ]).map(s => ({ ...s, key: uid() }));

  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet ms-sheet ms-tc" role="dialog" aria-modal="true" aria-label="${edit ? "Edit template" : "New template"}" autocomplete="off">
    <h2>${edit ? "Edit template" : "New template"}</h2>
    <label>Name<input class="field" id="tc-name" required placeholder="Lab report" value="${esc(name)}"></label>
    ${edit || prefill ? "" : `<label>Start from<select class="field" id="tc-from"><option value="">Blank</option>${Object.entries(TEMPLATES).filter(([, t]) => t.steps.length).map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join("")}</select></label>`}
    <div class="tc-line" id="tc-line" aria-hidden="true"></div>
    <div class="tc-steps" id="tc-steps"></div>
    <button type="button" class="tc-add" id="tc-add">${svg("plus")}Add a step</button>
    <label>If it were due in 2 weeks<div class="ms-preview" id="tc-preview"></div></label>
    <span class="ap-err" id="tc-err"></span>
    <div class="acts">${edit ? `<button type="button" class="pill-btn secondary" id="tc-del" style="color:var(--bad)">Delete</button>` : "<span></span>"}
      <span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" id="tc-cancel">Cancel</button><button class="pill-btn" type="submit">${edit ? "Save" : "Save template"}</button></span></div>
  </form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), $ = s => f.querySelector(s);
  const close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  $("#tc-cancel").onclick = close;

  const sortSteps = () => { steps.sort((a, b) => a.at - b.at); };

  function drawLine() {
    $("#tc-line").innerHTML = `<span class="tc-track"></span>
      ${steps.map((s, i) => `<span class="tc-dot" style="left:${s.at * 100}%" title="${esc(s.title || `Step ${i + 1}`)}">${i + 1}</span>`).join("")}
      <span class="tc-end l">Start</span><span class="tc-end r">Due</span>`;
  }
  function drawPreview() {
    const box = $("#tc-preview");
    const named = steps.filter(s => s.title.trim());
    if (!named.length) { box.innerHTML = `<div>Name a step to see when it would happen.</div>`; return; }
    const now = Date.now(), due = new Date(now + 14 * D); due.setHours(23, 59, 0, 0);
    box.innerHTML = placeSteps(named.map(s => ({ ...s })).sort((a, b) => a.at - b.at), now, +due, DEFAULT_BLOCKED)
      .map(s => `<div><span>${esc(dueLabel(s.date))}</span>${esc(s.title)}</div>`).join("");
  }
  function drawSteps(focusKey) {
    $("#tc-steps").innerHTML = steps.map((s, i) => `<div class="tc-step" data-key="${s.key}">
      <span class="tc-n">${i + 1}</span>
      <div class="tc-main">
        <div class="tc-top">
          <input class="field tc-title" placeholder="${i === 0 ? "Read the instructions" : "What happens in this step"}" value="${esc(s.title)}" aria-label="Step ${i + 1} name">
          <select class="field tc-est" aria-label="How long step ${i + 1} takes">${[...new Set([...ESTS, s.estMin])].sort((a, b) => a - b).map(v => `<option value="${v}" ${v === s.estMin ? "selected" : ""}>${fmtDur(v)}</option>`).join("")}</select>
        </div>
        <div class="tc-when">
          <input type="range" class="tc-at" min="0" max="100" step="5" value="${Math.round(s.at * 100)}" aria-label="When step ${i + 1} happens">
          <span class="tc-wt">${whenText(s.at)}</span>
        </div>
      </div>
      <button type="button" class="icon-btn tc-rm" aria-label="Remove step ${i + 1}">${svg("x")}</button>
    </div>`).join("");
    drawLine(); drawPreview();
    if (focusKey) f.querySelector(`[data-key="${focusKey}"] .tc-title`)?.focus();
  }
  const stepOf = el => steps.find(s => s.key === el.closest("[data-key]")?.dataset.key);

  $("#tc-steps").addEventListener("input", e => {
    const s = stepOf(e.target); if (!s) return;
    if (e.target.classList.contains("tc-title")) { s.title = e.target.value; drawLine(); drawPreview(); }
    else if (e.target.classList.contains("tc-at")) {
      s.at = +e.target.value / 100;
      e.target.parentElement.querySelector(".tc-wt").textContent = whenText(s.at);
      drawLine(); drawPreview();
    }
  });
  $("#tc-steps").addEventListener("change", e => {
    const s = stepOf(e.target); if (!s) return;
    if (e.target.classList.contains("tc-est")) { s.estMin = +e.target.value; return; }
    if (e.target.classList.contains("tc-at")) { sortSteps(); drawSteps(); f.querySelector(`[data-key="${s.key}"] .tc-at`)?.focus(); }
  });
  $("#tc-steps").addEventListener("click", e => {
    if (!e.target.closest(".tc-rm")) return;
    const s = stepOf(e.target); steps = steps.filter(x => x !== s); drawSteps();
  });
  $("#tc-steps").addEventListener("keydown", e => {
    // Enter in a step name adds the next step, like a checklist
    if (e.key !== "Enter" || !e.target.classList.contains("tc-title")) return;
    e.preventDefault();
    const s = stepOf(e.target), i = steps.indexOf(s), next = steps[i + 1];
    if (next) { f.querySelector(`[data-key="${next.key}"] .tc-title`)?.focus(); return; }
    addStep();
  });
  function addStep() {
    const last = steps[steps.length - 1];
    const s = { title: "", at: last ? Math.min(1, Math.round((last.at + (1 - last.at) / 2) * 20) / 20) : 0.5, estMin: 45, key: uid() };
    steps.push(s); sortSteps(); drawSteps(s.key);
  }
  $("#tc-add").onclick = addStep;
  $("#tc-from")?.addEventListener("change", e => {
    const t = TEMPLATES[e.target.value];
    steps = (t ? t.steps : [{ title: "", at: 0.5, estMin: 45 }]).map(s => ({ ...s, key: uid() }));
    if (t && !$("#tc-name").value.trim()) $("#tc-name").value = `My ${t.label.toLowerCase()}`;
    drawSteps();
  });
  $("#tc-del")?.addEventListener("click", e => {
    const wrap = e.target.parentElement;
    wrap.innerHTML = `<span class="confirm">Delete this template? Plans made from it stay. <button type="button" class="pill-btn danger" id="tc-del-yes">Delete</button></span>`;
    wrap.querySelector("#tc-del-yes").onclick = async () => { await store.remove(APP, edit.id); close(); if (toast) toast(`Deleted “${edit.name}”`); if (onDelete) onDelete(edit.id); };
  });

  f.onsubmit = async e => {
    e.preventDefault();
    const err = $("#tc-err"); err.textContent = "";
    const nm = $("#tc-name").value.trim();
    const clean = steps.filter(s => s.title.trim()).map(s => ({ title: s.title.trim(), at: clamp(s.at), estMin: s.estMin || 45 })).sort((a, b) => a.at - b.at);
    if (!nm) { err.textContent = "Give the template a name."; $("#tc-name").focus(); return; }
    if (!clean.length) { err.textContent = "Name at least one step."; return; }
    const id = edit ? edit.id : "t-" + uid(), now = Date.now();
    const data = { name: nm, steps: clean, created: edit ? edit.created || now : now, updated: now };
    await store.put(APP, id, data);
    close();
    if (toast) toast(edit ? `Saved “${nm}”` : `Template “${nm}” saved`);
    if (onSave) onSave({ id, ...data });
  };

  drawSteps();
  setTimeout(() => (name ? f.querySelector(".tc-title") : $("#tc-name")).focus(), 50);
}
