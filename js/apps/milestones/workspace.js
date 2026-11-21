// Workspace: notes, study guides and practice questions kept with a milestone or one of its steps.
//
// Saved items (app "docs"), one per doc:
//   "d-…": { owner: "milestones:<mid>" or "milestones:<mid>:<step id>", title, kind ("note" | "guide" | "questions"), body (markdown), created, updated }
// Owners use the same format as files, so a doc follows its step the way a file does.
import * as store from "../../store.js";

const APP = "docs";
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const KINDS = { note: "Note", guide: "Study guide", questions: "Practice questions" };

/** Every doc whose owner is `owner` or one of its steps, newest first. */
export async function listDocs(owner) {
  return (await store.list(APP)).filter(r => r.data && r.data.owner)
    .map(r => ({ id: r.id, ...r.data }))
    .filter(d => d.owner === owner || d.owner.startsWith(owner + ":"))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
}
export async function saveDoc(doc) {
  const { id, ...rest } = doc, now = Date.now();
  const key = id || "d-" + uid();
  await store.put(APP, key, { kind: "note", title: "", body: "", ...rest, created: rest.created || now, updated: now });
  return key;
}
export const removeDoc = id => store.remove(APP, id);
export async function moveDocs(fromOwner, toOwner) {
  for (const d of await listDocs(fromOwner)) if (d.owner === fromOwner) await saveDoc({ ...d, owner: toOwner });
}

/* ---------- practice questions ----------
   A questions doc is what the study prompt asks for: numbered questions, then a heading
   "Answers" with the answers numbered the same way. An answer can also sit under its
   question on a line starting "Answer:". Marks from practice are saved on the doc as
   marks: { <question key>: "good" | "shaky" }, keyed by the question's text so edits that
   renumber the list keep them. */
const ANSWERS_HEAD = /^\s*(#{1,6}\s*)?(\*\*)?\s*(answers?|answer key|solutions?)\s*:?\s*(\*\*)?\s*:?\s*$/i;
const INLINE_ANS = /^\s*(\*\*)?\s*(answer|ans|solution)\s*(\*\*)?\s*[:.]\s*(\*\*)?\s*/i;
export const questionKey = text => String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
/** [{ n, key, q (markdown), a (markdown or "") }] in order. */
export function parseQuestions(md) {
  const lines = String(md || "").replace(/\r/g, "").split("\n");
  const at = lines.findIndex(l => ANSWERS_HEAD.test(l));
  const blocks = part => {
    const out = []; let cur = null;
    for (const l of part) {
      const m = l.match(/^\s*(\d+)[.)]\s+(.*)$/);
      if (m) { cur = { n: +m[1], lines: [m[2]] }; out.push(cur); }
      else if (/^\s*#{1,6}\s/.test(l)) cur = null;
      else if (cur) cur.lines.push(l);
    }
    return out;
  };
  const qs = blocks(at < 0 ? lines : lines.slice(0, at)), as = at < 0 ? [] : blocks(lines.slice(at + 1));
  const byN = new Map(as.map(a => [a.n, a]));
  return qs.map((b, i) => {
    let q = b.lines, a = [];
    const k = q.findIndex(l => INLINE_ANS.test(l));
    if (k >= 0) { a = [q[k].replace(INLINE_ANS, ""), ...q.slice(k + 1)]; q = q.slice(0, k); }
    const sec = as.length === qs.length ? as[i] : byN.get(b.n);
    if (!a.length && sec) a = sec.lines;
    const text = q.join("\n").trim();
    return { n: b.n, key: questionKey(text), q: text, a: a.join("\n").trim() };
  });
}
/** Save practice marks without counting it as an edit. */
export async function saveMarks(id, marks) {
  const raw = await store.get(APP, id); if (!raw) return;
  await store.put(APP, id, { ...raw, marks });
}

/* ---------- study prompt ---------- */
/** A ready-made prompt to paste into any AI chat. Nothing is sent anywhere from here. */
export function studyPrompt(m, step, kind) {
  const topic = (step && (step.topic || step.title)) || m.title;
  const days = Math.max(0, Math.ceil((m.due - Date.now()) / 864e5));
  const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
  const what = `${m.title}${m.course ? ` (${m.course})` : ""}`;
  const exam = m.template === "exam";
  const lines = [exam ? `I'm studying for ${what}, which is ${when}.` : `I'm working on ${what}, due ${when}.`];
  if (step && step.rating === "shaky") lines.push(`I rated ${topic} as shaky, so start from the basics.`);
  if (kind === "questions") {
    lines.push(`Write 8 practice questions on ${topic}, from easy to hard, like ones that could show up${exam ? " on the exam" : ""}.`,
      `Put all the answers at the end under a heading "Answers", with a one-line reason for each.`);
  } else {
    lines.push(exam ? `Make me a short study guide on ${topic}: the key ideas, the definitions I need, and one worked example for each.`
      : `Help me with this step: ${topic}. Explain what a good result looks like, the steps to get there, and common mistakes.`);
  }
  lines.push("Use markdown: # headings, - bullets, **bold** for key terms. Keep it tight.");
  return lines.join("\n");
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) {
    const t = document.createElement("textarea"); t.value = text; t.style.position = "fixed"; t.style.opacity = "0";
    document.body.appendChild(t); t.select();
    let ok = false; try { ok = document.execCommand("copy"); } catch (e2) { /* nothing else to try */ }
    t.remove(); return ok;
  }
}

/* ---------- markdown ---------- */
// Escape first, then add a few tags back: headings, bullets, numbered lists, **bold**, `code`, code fences, paragraphs.
const inline = s => s.replace(/`([^`]+)`/g, "<code>$1</code>").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
export function renderMd(src) {
  const lines = esc(src).replace(/\r/g, "").split("\n");
  let out = "", list = null, para = [], fence = null;
  const flushPara = () => { if (para.length) { out += `<p>${inline(para.join(" "))}</p>`; para = []; } };
  const flushList = () => { if (list) { out += `</${list}>`; list = null; } };
  for (const line of lines) {
    if (fence !== null) {
      if (/^\s*```/.test(line)) { out += `<pre><code>${fence.join("\n")}</code></pre>`; fence = null; } else fence.push(line);
      continue;
    }
    if (/^\s*```/.test(line)) { flushPara(); flushList(); fence = []; continue; }
    let mm;
    if ((mm = line.match(/^\s*(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); const n = Math.min(4, mm[1].length + 2); out += `<h${n}>${inline(mm[2])}</h${n}>`; continue; }
    if ((mm = line.match(/^\s*[-*+]\s+(.*)$/))) { flushPara(); if (list !== "ul") { flushList(); out += "<ul>"; list = "ul"; } out += `<li>${inline(mm[1])}</li>`; continue; }
    if ((mm = line.match(/^\s*\d+[.)]\s+(.*)$/))) { flushPara(); if (list !== "ol") { flushList(); out += "<ol>"; list = "ol"; } out += `<li>${inline(mm[1])}</li>`; continue; }
    if (!line.trim()) { flushPara(); flushList(); continue; }
    flushList(); para.push(line.trim());
  }
  if (fence !== null) out += `<pre><code>${fence.join("\n")}</code></pre>`;
  flushPara(); flushList();
  return out;
}

/* ---------- editor sheet ---------- */
/** Open the doc editor over `root`. `doc` is an existing doc or { owner, kind }. */
export function openDocEditor(root, doc, { onSave, onDelete, toast, prompt } = {}) {
  let kind = doc.kind || "note";
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet ms-sheet ws-ed" role="dialog" aria-modal="true" aria-label="${doc.id ? "Edit" : "New"} ${KINDS[kind].toLowerCase()}" autocomplete="off">
    <h2>${doc.id ? "Edit" : "New note"}</h2>
    <label>Title<input class="field" id="ws-t" placeholder="${kind === "guide" ? "Study guide: recursion" : "What this is"}" value="${esc(doc.title || "")}"></label>
    <div class="ms-tpl-l"><span>Kind</span><div class="ms-tpls" id="ws-kinds">${Object.entries(KINDS).map(([k, l]) => `<button type="button" data-k="${k}" aria-pressed="${k === kind}">${l}</button>`).join("")}</div></div>
    ${prompt ? `<p class="note ws-ed-prompt" id="ws-pr" ${kind === "note" ? "hidden" : ""}>Need one? <button type="button" class="link-btn" id="ws-prc">Copy a prompt for ${kind === "questions" ? "practice questions" : "a study guide"}</button>, paste it into your AI, then paste the answer below.</p>` : ""}
    <label>Text<textarea class="field ws-body" id="ws-b" placeholder="Type, or paste what your AI gave you. # headings, - bullets and **bold** work.">${esc(doc.body || "")}</textarea></label>
    <span class="ap-err" id="ws-err"></span>
    <div class="acts">${doc.id ? `<button type="button" class="pill-btn secondary" id="ws-del" style="color:var(--bad)">Delete</button>` : "<span></span>"}
      <span style="display:flex;gap:8px"><button type="button" class="pill-btn secondary" id="ws-cancel">Cancel</button><button class="pill-btn" type="submit">Save</button></span></div>
  </form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), $ = s => f.querySelector(s);
  const close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  $("#ws-cancel").onclick = close;
  $("#ws-kinds").addEventListener("click", e => {
    const b = e.target.closest("[data-k]"); if (!b) return;
    kind = b.dataset.k;
    $("#ws-kinds").querySelectorAll("[data-k]").forEach(x => x.setAttribute("aria-pressed", x === b));
    if ($("#ws-pr")) { $("#ws-pr").hidden = kind === "note"; $("#ws-prc").textContent = `Copy a prompt for ${kind === "questions" ? "practice questions" : "a study guide"}`; }
  });
  $("#ws-prc")?.addEventListener("click", async () => {
    const ok = await copyText(prompt(kind === "questions" ? "questions" : "guide"));
    if (toast) toast(ok ? "Prompt copied" : "Couldn't copy the prompt.");
  });
  $("#ws-del")?.addEventListener("click", e => {
    const wrap = e.target.parentElement;
    wrap.innerHTML = `<span class="confirm">Delete this? <button type="button" class="pill-btn danger" id="ws-del-yes">Delete</button></span>`;
    wrap.querySelector("#ws-del-yes").onclick = async () => { await removeDoc(doc.id); close(); if (toast) toast("Deleted"); if (onDelete) onDelete(doc.id); };
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const body = $("#ws-b").value, firstLine = body.trim().split("\n")[0].replace(/^#+\s*/, "").slice(0, 60);
    const title = $("#ws-t").value.trim() || firstLine;
    if (!title && !body.trim()) { $("#ws-err").textContent = "Write something first."; $("#ws-b").focus(); return; }
    const id = await saveDoc({ ...doc, title: title || KINDS[kind], kind, body });
    close();
    if (toast) toast(doc.id ? "Saved" : `${KINDS[kind]} added`);
    if (onSave) onSave(id);
  };
  setTimeout(() => (doc.id ? $("#ws-b") : $("#ws-t")).focus(), 50);
}
