// Practice: go through a questions doc one question at a time. Show the answer,
// then mark it Got it or Shaky. Marks are saved on the doc (see workspace.js).
//   openPractice(doc, { toast, onMark(question, mark), onClose })
import { svg } from "../../icons.js";
import { openViewer } from "../../viewer.js";
import { parseQuestions, saveMarks, renderMd } from "./workspace.js";

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/** How a doc's questions stand: { n, good, shaky }. */
export function marksOf(doc) {
  const qs = parseQuestions(doc.body), marks = doc.marks || {};
  return { n: qs.length, good: qs.filter(q => marks[q.key] === "good").length, shaky: qs.filter(q => marks[q.key] === "shaky").length };
}

export function openPractice(doc, { toast, onMark, onClose } = {}) {
  const all = parseQuestions(doc.body);
  if (!all.length) { if (toast) toast("No numbered questions in this doc yet."); return; }
  const marks = { ...(doc.marks || {}) };
  let deck = all, i = 0, shown = false, body = null;

  const draw = () => {
    if (i >= deck.length) return drawEnd();
    const q = deck[i], mark = marks[q.key];
    body.innerHTML = `<div class="pq">
      <div class="pq-top"><span>Question ${i + 1} of ${deck.length}</span>
        ${mark ? `<span class="ms-tag ${mark === "good" ? "green" : "warm"}">last time: ${mark === "good" ? "got it" : "shaky"}</span>` : ""}</div>
      <div class="ap-bar-meter pq-meter"><i style="width:${Math.round(i / deck.length * 100)}%"></i></div>
      <article class="pq-card ws-md">${renderMd(q.q) || `<p>${esc(q.q)}</p>`}</article>
      ${shown ? `<div class="pq-ans"><span class="ms-lab">Answer</span><div class="ws-md">${q.a ? renderMd(q.a) : `<p class="ws-muted">No answer written for this one. Check it yourself.</p>`}</div></div>
        <div class="pq-acts"><button class="pill-btn secondary" data-pq="shaky">Shaky</button><button class="pill-btn" data-pq="good">${svg("check")}Got it</button></div>`
      : `<div class="pq-acts"><button class="pill-btn secondary" data-pq="skip">Skip</button><button class="pill-btn" data-pq="show">Show answer</button></div>`}
      <p class="pq-keys">Space shows the answer · 1 got it · 2 shaky</p>
    </div>`;
  };
  const drawEnd = () => {
    const got = deck.filter(q => marks[q.key] === "good").length, shaky = deck.filter(q => marks[q.key] === "shaky");
    body.innerHTML = `<div class="pq pq-end">
      <h2>Done</h2>
      <p class="pq-sum"><b>${got}</b> got it · <b>${shaky.length}</b> shaky${deck.length - got - shaky.length ? ` · ${deck.length - got - shaky.length} skipped` : ""}</p>
      ${shaky.length ? `<ol class="pq-shaky">${shaky.map(q => `<li>${esc(q.q.split("\n")[0])}</li>`).join("")}</ol>` : ""}
      <div class="pq-acts">${shaky.length ? `<button class="pill-btn secondary" data-pq="again-shaky">Practice the shaky ones</button>` : ""}
        <button class="pill-btn secondary" data-pq="restart">Start over</button><button class="pill-btn" data-pq="close">Done</button></div>
    </div>`;
  };
  let busy = false;
  const act = async k => {
    if (busy) return;
    const q = deck[i];
    if (k === "show") { shown = true; draw(); body.querySelector('[data-pq="good"]')?.focus(); }
    else if (k === "skip") { i++; shown = false; draw(); }
    else if ((k === "good" || k === "shaky") && q && shown) {
      busy = true;
      try {
        marks[q.key] = k;
        await saveMarks(doc.id, marks).catch(() => toast && toast("Couldn't save that mark."));
        doc.marks = { ...marks };
        if (onMark) await onMark(q, k);
      } finally { busy = false; }
      i++; shown = false; draw();
    }
    else if (k === "again-shaky") { deck = deck.filter(x => marks[x.key] === "shaky"); i = 0; shown = false; draw(); }
    else if (k === "restart") { deck = all; i = 0; shown = false; draw(); }
    else if (k === "close") view.close();
  };
  const onKey = e => {
    if (!body || e.target.closest?.("input,textarea")) return;
    if (e.key === " " && !shown && i < deck.length) { e.preventDefault(); act("show"); }
    else if (e.key === "1" && shown) act("good");
    else if (e.key === "2" && shown) act("shaky");
  };
  const view = openViewer({
    title: doc.title || "Practice questions", sub: `Practice · ${all.length} question${all.length === 1 ? "" : "s"}`,
    onClose: () => { document.removeEventListener("keydown", onKey); if (onClose) onClose(); },
    render(el) {
      body = el;
      el.addEventListener("click", e => { const k = e.target.closest("[data-pq]")?.dataset.pq; if (k) act(k); });
      document.addEventListener("keydown", onKey);
      draw();
    },
  });
}
