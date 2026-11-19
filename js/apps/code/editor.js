// A small code editor: a plain textarea with a highlighted copy drawn behind it.
// Line numbers, Tab / Shift+Tab, auto-indent after ":", Ctrl+/ to comment,
// Ctrl+Enter to run. It grows with the code, so the page scrolls, not the box.
const IND = "    ";
const KW = new Set("False None True and as assert async await break case class continue def del elif else except finally for from global if import in is lambda match nonlocal not or pass raise return try while with yield".split(" "));
const BI = new Set("print input len range int float str list dict set tuple bool sum min max abs round sorted reversed enumerate zip map filter open type isinstance any all format repr chr ord divmod pow super object hasattr getattr setattr id hex bin iter next help vars dir display".split(" "));
const TOKEN = /(#[^\n]*)|([rRbBfFuU]{0,2}(?:"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(@[A-Za-z_][\w.]*)|(\b(?:0[xob][\da-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?j?|\.\d[\d_]*(?:[eE][+-]?\d+)?)\b)|([A-Za-z_]\w*)/g;

const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

export function highlight(src) {
  let out = "", i = 0, prev = "";
  for (const m of src.matchAll(TOKEN)) {
    out += esc(src.slice(i, m.index)); i = m.index + m[0].length;
    const t = esc(m[0]);
    if (m[1]) out += `<span class="c">${t}</span>`;
    else if (m[2]) out += `<span class="s">${t}</span>`;
    else if (m[3]) out += `<span class="d">${t}</span>`;
    else if (m[4]) out += `<span class="n">${t}</span>`;
    else if (KW.has(m[5])) { out += `<span class="k">${t}</span>`; prev = m[5]; continue; }
    else if (prev === "def" || prev === "class") out += `<span class="f">${t}</span>`;
    else if (BI.has(m[5]) && src[i] === "(") out += `<span class="b">${t}</span>`;
    else if (m[5] === "self") out += `<span class="k">${t}</span>`;
    else out += t;
    prev = "";
  }
  return out + esc(src.slice(i)) + "\n";
}

/** Build an editor inside el. Returns { get, set, focus, markLine, onChange, onRun }. */
export function createEditor(el, { value = "", onChange = () => {}, onRun = () => {} } = {}) {
  el.classList.add("cd-ed");
  el.innerHTML = `<div class="cd-gut" aria-hidden="true"></div>
    <div class="cd-scroll"><div class="cd-layer">
      <div class="cd-mark" hidden></div>
      <pre class="cd-hl" aria-hidden="true"></pre>
      <textarea class="cd-ta" spellcheck="false" autocapitalize="off" autocomplete="off" autocorrect="off" wrap="off" aria-label="Code"></textarea>
    </div></div>`;
  const gut = el.querySelector(".cd-gut"), hl = el.querySelector(".cd-hl"), ta = el.querySelector(".cd-ta"), mark = el.querySelector(".cd-mark");
  let lines = 0, errLine = 0;

  function paint() {
    const v = ta.value, ls = v.split("\n");
    hl.innerHTML = highlight(v);
    if (ls.length !== lines) {
      lines = ls.length;
      gut.innerHTML = ls.map((_, i) => `<span${i + 1 === errLine ? ' class="err"' : ""}>${i + 1}</span>`).join("");
    }
    const wide = Math.max(...ls.map(l => l.replace(/\t/g, IND).length));
    el.style.setProperty("--cols", wide + 2);
    el.style.setProperty("--rows", Math.max(lines, 1));
  }
  function setMark(n) {
    errLine = n; lines = -1; paint();
    mark.hidden = !n;
    if (n) mark.style.top = `calc(var(--pad) + ${(n - 1)} * var(--lh))`;
  }

  // edits that keep the browser's undo history
  function insert(text, from = ta.selectionStart, to = ta.selectionEnd) {
    ta.setSelectionRange(from, to);
    if (!document.execCommand || !document.execCommand("insertText", false, text)) {
      ta.setRangeText(text, from, to, "end");
      ta.dispatchEvent(new Event("input"));
    }
  }
  function lineStart(pos) { return ta.value.lastIndexOf("\n", pos - 1) + 1; }
  function selectedLines() {
    const s = lineStart(ta.selectionStart);
    let e = ta.value.indexOf("\n", ta.selectionEnd - (ta.selectionEnd > ta.selectionStart && ta.value[ta.selectionEnd - 1] === "\n" ? 1 : 0));
    if (e < 0) e = ta.value.length;
    return { s, e, text: ta.value.slice(s, e) };
  }
  function mapLines(fn) {
    const { s, e, text } = selectedLines();
    const next = text.split("\n").map(fn).join("\n");
    if (next === text) return;
    insert(next, s, e);
    ta.setSelectionRange(s, s + next.length);
  }
  function toggleComment() {
    const { text } = selectedLines();
    const ls = text.split("\n").filter(l => l.trim());
    const all = ls.length && ls.every(l => /^\s*#/.test(l));
    mapLines(l => !l.trim() ? l : all ? l.replace(/^(\s*)# ?/, "$1") : l.replace(/^(\s*)/, "$1# "));
  }

  ta.addEventListener("keydown", e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === "Enter") { e.preventDefault(); onRun(); return; }
    if (mod && e.key === "/") { e.preventDefault(); toggleComment(); return; }
    if (e.key === "Tab" && !mod && !e.altKey) {
      e.preventDefault();
      const multi = ta.value.slice(ta.selectionStart, ta.selectionEnd).includes("\n");
      if (e.shiftKey) mapLines(l => l.startsWith(IND) ? l.slice(4) : l.replace(/^ {1,3}/, ""));
      else if (multi) mapLines(l => l.trim() ? IND + l : l);
      else { const col = ta.selectionStart - lineStart(ta.selectionStart); insert(" ".repeat(4 - (col % 4))); }
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !mod) {
      e.preventDefault();
      const s = lineStart(ta.selectionStart), before = ta.value.slice(s, ta.selectionStart);
      let ind = (/^\s*/.exec(before) || [""])[0];
      const code = before.replace(/#.*$/, "").trimEnd();
      if (code.endsWith(":")) ind += IND;
      else if (/^\s*(return|pass|break|continue|raise)\b/.test(before) && ind.length >= 4) ind = ind.slice(4);
      insert("\n" + ind);
      return;
    }
    if (e.key === "Backspace" && ta.selectionStart === ta.selectionEnd) {
      const s = lineStart(ta.selectionStart), before = ta.value.slice(s, ta.selectionStart);
      if (before.length && /^ +$/.test(before)) {
        e.preventDefault();
        const n = before.length % 4 || 4;
        insert("", ta.selectionStart - n, ta.selectionStart);
      }
    }
  });
  ta.addEventListener("input", () => { if (errLine) setMark(0); paint(); onChange(ta.value); });

  ta.value = value; paint();
  return {
    el, ta,
    get: () => ta.value,
    set(v) { if (v === ta.value) return; ta.value = v; setMark(0); paint(); },
    focus: () => ta.focus({ preventScroll: true }),
    /** Highlight a line (an error); 0 clears it. Moves the cursor there when focus is true. */
    markLine(n, { focus = false } = {}) {
      setMark(n);
      if (n && focus) {
        const ls = ta.value.split("\n"); let pos = 0;
        for (let i = 0; i < n - 1 && i < ls.length; i++) pos += ls[i].length + 1;
        ta.focus({ preventScroll: true }); ta.setSelectionRange(pos, pos + (ls[n - 1] || "").length);
      }
    },
    /** Type text at the cursor (the phone key row). */
    type(text) {
      ta.focus({ preventScroll: true });
      if (text === "\t") { const col = ta.selectionStart - lineStart(ta.selectionStart); insert(" ".repeat(4 - (col % 4))); return; }
      const pairs = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'" };
      if (pairs[text] && ta.selectionStart === ta.selectionEnd) { insert(text + pairs[text]); ta.setSelectionRange(ta.selectionStart - 1, ta.selectionStart - 1); }
      else insert(text);
    },
  };
}
