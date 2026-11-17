// Quick Capture: press Ctrl+Space (or Ctrl+K) anywhere in GooseOS, or tap the
// "Quick add" bar on the home screen, type "cs proj 3 due fri 11:59", press Enter.
// It lands in Deadline Hub, sorted by due date.
import { addFromText, previewHtml } from "./apps/deadlines/deadlines.js";
import { dueLabel } from "./apps/deadlines/parse.js";
import { svg } from "./icons.js";

let el = null, toastFn = () => {};

function build() {
  el = document.createElement("div");
  el.className = "cap-back"; el.hidden = true;
  el.innerHTML = `<form class="cap" role="dialog" aria-modal="true" aria-label="Quick add" autocomplete="off">
      <div class="cap-row">${svg("plus")}<input id="cap-in" placeholder="cs proj 3 fri 11:59 · frat dues fri" aria-label="What's due and when"><kbd>Enter</kbd></div>
      <div class="cap-prev" id="cap-prev"></div>
      <div class="cap-hint">Course or list first, then what, then when: “cs proj 3 fri” or “frat dues fri”. Tag a list anywhere with #, like #personal.</div>
    </form>`;
  document.body.appendChild(el);
  const input = el.querySelector("#cap-in");
  input.addEventListener("input", async () => { el.querySelector("#cap-prev").innerHTML = await previewHtml(input.value); });
  input.addEventListener("keydown", e => { if (e.key === "Escape") { e.preventDefault(); close(); } });
  el.addEventListener("click", e => { if (e.target === el) close(); });
  el.querySelector("form").onsubmit = async e => {
    e.preventDefault();
    const item = await addFromText(input.value);
    if (!item) return;
    close();
    toastFn(`Added “${item.title}”${item.due ? ` · ${dueLabel(item.due)}` : ""}`);
  };
}

export function open() {
  if (!el) build();
  el.hidden = false;
  const input = el.querySelector("#cap-in");
  input.value = ""; el.querySelector("#cap-prev").innerHTML = "";
  requestAnimationFrame(() => input.focus());
}
export function close() { if (el) el.hidden = true; }

export function init({ toast }) {
  toastFn = toast;
  document.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.code === "Space" || k === "k")) {
      e.preventDefault();
      if (el && !el.hidden) close(); else open();
    }
  });
}
