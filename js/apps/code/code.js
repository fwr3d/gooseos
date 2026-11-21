// Code: write and run Python. Each program has its .py files, any data files
// you add (CSV and so on), an Input box that feeds input(), and an output panel
// that shows printed text, dataframes as tables and matplotlib charts.
//
// Saved items:
//   app "code", id "p-…": { files: [{ name, text }], active (file name), input, created, updated }
//                         files[0] names the program (its tab)
//   data files: js/files.js, scope "code", owner "code:<program id>"
// Files a run writes (like summary.csv) stay on the page as "new" until you keep them.
import * as store from "../../store.js";
import * as files from "../../files.js";
import { svg } from "../../icons.js";
import * as runner from "./runner.js";
import { createEditor } from "./editor.js";

const APP = "code", MAX_OUT = 200000;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const owner = id => `code:${id}`;
const isPy = n => /\.py$/i.test(n);
const isCsv = n => /\.(csv|tsv)$/i.test(n);
const typeOf = n => isCsv(n) ? "text/csv" : /\.json$/i.test(n) ? "application/json" : /\.(txt|md)$/i.test(n) ? "text/plain" : /\.png$/i.test(n) ? "image/png" : "application/octet-stream";

/* ---------- examples ---------- */
const SCORES = ["name,section,score", ...[
  ["Ava", "L01", 88], ["Ben", "L01", 79], ["Cam", "L01", 91], ["Dee", "L01", 79], ["Eli", "L01", 84],
  ["Fay", "L02", 72], ["Gus", "L02", 81], ["Hal", "L02", 85], ["Ivy", "L02", 76], ["Jo", "L02", 80.5],
  ["Kai", "L03", 95], ["Lu", "L03", 89], ["Max", "L03", 93], ["Noa", "L03", 88], ["Oz", "L03", 92],
  ["Pia", "L04", 70], ["Quin", "L04", 68], ["Rae", "L04", 77], ["Sol", "L04", 74], ["Tam", "L04", 74],
].map(r => r.join(","))].join("\n") + "\n";

const EXAMPLES = [
  { key: "blank", label: "Blank", name: "program.py", text: "", input: "" },
  { key: "hello", label: "Hello", name: "hello.py", input: "Goose",
    text: `name = input("What's your name? ")\nprint(f"Hi {name}!")\n\nfor i in range(1, 4):\n    print(i, "Python is running")\n` },
  { key: "avg", label: "Reading input", name: "grade_avg.py", input: "3\n88\n94\n91",
    text: `# average a list of scores\ndef average(scores):\n    return sum(scores) / len(scores)\n\nn = int(input("How many? "))\nscores = [float(input()) for _ in range(n)]\nprint(f"Average: {average(scores):.1f}")\nif average(scores) >= 90:\n    print("That's an A")\n` },
  { key: "csv", label: "CSV with pandas", name: "stats_hw.py", input: "", data: { "scores.csv": SCORES },
    text: `import pandas as pd\nimport matplotlib.pyplot as plt\n\ndf = pd.read_csv("scores.csv")\navg = df.groupby("section")["score"].mean().reset_index()\navg.to_csv("summary.csv", index=False)\navg.plot.bar(x="section", y="score", legend=False); plt.show()\navg\n` },
];

/* ---------- state ---------- */
let root = null, ctx0 = null, ed = null;
let progs = [], cur = null, data = [];          // data: kept files of the open program
const fresh = new Map();                         // program id -> Map(name -> { bytes, type })
let outChars = 0, outCut = false, runT0 = 0, tick = null, saveT = null, runId = 0, printed = "";
const $ = s => root.querySelector(s);

async function loadProgs() {
  progs = (await store.list(APP)).filter(r => r.data && r.id.startsWith("p-") && r.data.files && r.data.files.length)
    .map(r => ({ id: r.id, ...r.data })).sort((a, b) => (a.created || 0) - (b.created || 0));
}
async function loadData() { data = cur ? await files.list({ scope: "code", owner: owner(cur.id) }).catch(() => []) : []; }
const freshOf = id => { if (!fresh.has(id)) fresh.set(id, new Map()); return fresh.get(id); };
const activeFile = () => cur && (cur.files.find(f => f.name === cur.active) || cur.files[0]);

function save(now = false) {
  if (!cur) return;
  clearTimeout(saveT);
  const p = cur, go = () => { const { id, ...d } = p; d.updated = Date.now(); return store.put(APP, id, d); };
  if (now) return go();
  saveT = setTimeout(go, 500);
}
function setRoute() { history.replaceState(null, "", `${location.pathname}${location.search}#code${cur ? "/" + encodeURIComponent(cur.id) : ""}`); }

async function create(ex, name) {
  const id = "p-" + uid(), now = Date.now();
  const p = { files: [{ name: name || ex.name, text: ex.text }], active: name || ex.name, input: ex.input || "", created: now, updated: now };
  await store.put(APP, id, p);
  for (const [n, text] of Object.entries(ex.data || {})) {
    await files.add(new File([text], n, { type: typeOf(n) }), { scope: "code", owner: owner(id) }).catch(() => {});
  }
  await loadProgs();
  return progs.find(x => x.id === id);
}

/* ---------- views ---------- */
async function render() {
  await loadProgs();
  if (cur) cur = progs.find(p => p.id === cur.id) || null;
  const body = $("#cd-body");
  if (!progs.length || !cur) {
    if (progs.length && !cur) { cur = progs[progs.length - 1]; return render(); }
    ed = null;
    body.innerHTML = `<div class="ap-card pad cd-intro">
      <div class="cd-ic">${svg("code")}</div>
      <h2>Write and run Python</h2>
      <p class="cd-note">Runs right here, even offline after the first time. numpy, pandas and matplotlib work, and you can add CSV files for your code to read.</p>
      <div class="cd-exs">${EXAMPLES.map(x => `<button class="pill-btn ${x.key === "csv" ? "" : "secondary"}" data-ex="${x.key}" type="button">${esc(x.label)}</button>`).join("")}</div>
    </div>`;
    body.querySelectorAll("[data-ex]").forEach(b => b.onclick = async () => { cur = await create(EXAMPLES.find(x => x.key === b.dataset.ex)); setRoute(); render(); });
    $("#cd-menu").hidden = true; paintStatus();
    return;
  }
  $("#cd-menu").hidden = false;
  await loadData();
  if (!body.querySelector(".cd-win")) {
    body.innerHTML = `<div class="cd-win">
      <div class="cd-top">
        <div class="cd-tabs" id="cd-tabs" role="tablist" aria-label="Programs"></div>
        <span class="ap-spacer"></span>
        <button class="icon-btn cd-stop" id="cd-stop" aria-label="Stop" title="Stop">${svg("square")}</button>
        <button class="pill-btn secondary cd-testb" id="cd-tests" title="Tests: check the output for given input">${svg("listChecks")}<span>Tests</span><small id="cd-tn"></small></button>
        <button class="pill-btn cd-run" id="cd-run" title="Run (Ctrl+Enter)">${svg("play")}<span>Run</span></button>
      </div>
      <div class="cd-main">
        <aside class="cd-files" id="cd-files" aria-label="Files"></aside>
        <div class="cd-edcol"><div id="cd-ed"></div>
          <div class="cd-keys" id="cd-keys">${["\t", ":", "(", ")", "[", "]", '"', "=", "#", "_"].map(k => `<button type="button" data-k="${esc(k)}">${k === "\t" ? "Tab" : esc(k)}</button>`).join("")}</div>
        </div>
      </div>
      <div class="cd-lo">
        <section class="cd-pane cd-in"><h4><span>Input</span><span class="cd-dim">one line per input()</span></h4>
          <textarea class="cd-input" id="cd-input" rows="4" spellcheck="false" autocapitalize="off" autocorrect="off" placeholder="Lines your program reads"></textarea></section>
        <section class="cd-pane cd-outp"><h4><span>Output</span><span class="cd-dim" id="cd-time"></span></h4>
          <div class="cd-out" id="cd-out" aria-live="polite"><p class="cd-dim cd-hint">Press Run to see what your program prints.</p></div></section>
      </div>
    </div>`;
    ed = createEditor($("#cd-ed"), {
      onChange: v => { const f = activeFile(); if (f) { f.text = v; save(); } },
      onRun: runNow,
    });
    $("#cd-run").onclick = runNow;
    $("#cd-tests").onclick = () => testsSheet();
    $("#cd-stop").onclick = () => runner.stop("stopped");
    $("#cd-input").oninput = e => { cur.input = e.target.value; save(); };
    $("#cd-keys").addEventListener("pointerdown", e => { const b = e.target.closest("[data-k]"); if (!b) return; e.preventDefault(); ed.type(b.dataset.k); });
    wireDrop($(".cd-win"));
  }
  paintTabs(); paintFiles();
  const f = activeFile();
  if (document.activeElement !== ed.ta) ed.set(f.text);
  if (document.activeElement !== $("#cd-input")) $("#cd-input").value = cur.input || "";
  paintRun(); paintStatus();
  runner.warm();
}

function paintTabs() {
  $("#cd-tabs").innerHTML = progs.map(p => `<button class="cd-tab ${p.id === cur.id ? "on" : ""}" role="tab" aria-selected="${p.id === cur.id}" data-prog="${p.id}">${esc(p.files[0].name)}${p.id === cur.id ? `<span class="cd-tab-x" data-del role="button" aria-label="Delete program" title="Delete program">${svg("x")}</span>` : ""}</button>`).join("")
    + `<button class="cd-tab add" id="cd-new" aria-label="New program">${svg("plus")}</button>`;
  $("#cd-tabs").querySelectorAll("[data-prog]").forEach(b => b.onclick = e => e.target.closest("[data-del]") ? delProg() : openProg(b.dataset.prog));
  $("#cd-new").onclick = newProgSheet;
  const on = $("#cd-tabs .on"); if (on) on.scrollIntoView({ block: "nearest", inline: "nearest" });
}
async function openProg(id) {
  if (cur && cur.id === id) return;
  if (runner.running()) runner.stop("stopped");
  await save(true);
  cur = progs.find(p => p.id === id); setRoute();
  clearOut(); render();
}

function paintFiles() {
  const nf = freshOf(cur.id), act = activeFile().name;
  const keptNames = new Set(data.map(d => d.name));
  $("#cd-files").innerHTML = `<h4><span>Files</span><button class="icon-btn cd-up" id="cd-up" aria-label="Add a file" title="Add a file">${svg("upload")}</button></h4>
    <div class="cd-flist">
    ${cur.files.map(f => `<div class="cd-f ${f.name === act ? "on" : ""}"><button class="cd-fn" data-py="${esc(f.name)}">${svg("fileText")}<span>${esc(f.name)}</span></button>${cur.files.length > 1 || f !== cur.files[0] ? `<button class="cd-fm" data-pymenu="${esc(f.name)}" aria-label="More for ${esc(f.name)}">${svg("ellipsis")}</button>` : ""}</div>`).join("")}
    ${data.map(d => `<div class="cd-f"><button class="cd-fn" data-file="${d.id}">${svg(isCsv(d.name) ? "table" : "file")}<span>${esc(d.name)}</span><small>${nf.has(d.name) ? "changed" : files.sizeText(d.size)}</small></button><button class="cd-fm" data-fmenu="${d.id}" aria-label="More for ${esc(d.name)}">${svg("ellipsis")}</button></div>`).join("")}
    ${[...nf.keys()].filter(n => !keptNames.has(n)).map(n => `<div class="cd-f"><button class="cd-fn" data-new="${esc(n)}">${svg(isCsv(n) ? "table" : "file")}<span>${esc(n)}</span><small class="cd-new">new</small></button><button class="cd-fm" data-newmenu="${esc(n)}" aria-label="More for ${esc(n)}">${svg("ellipsis")}</button></div>`).join("")}
    </div>
    <button class="link-btn cd-addpy" id="cd-addpy">${svg("plus")}New .py file</button>
    <p class="cd-drop">Drop a .csv here</p>`;
  const fl = $("#cd-files");
  $("#cd-up").onclick = () => $("#cd-pick").click();
  $("#cd-addpy").onclick = () => nameSheet({ title: "New .py file", value: "helper.py", go: async n => { cur.files.push({ name: n, text: "" }); cur.active = n; await save(true); render(); } });
  fl.querySelectorAll("[data-py]").forEach(b => b.onclick = () => { cur.active = b.dataset.py; ed.set(activeFile().text); ed.markLine(0); save(); paintFiles(); });
  fl.querySelectorAll("[data-pymenu]").forEach(b => b.onclick = () => pyMenu(b.dataset.pymenu));
  fl.querySelectorAll("[data-file]").forEach(b => b.onclick = () => previewKept(b.dataset.file));
  fl.querySelectorAll("[data-fmenu]").forEach(b => b.onclick = () => dataMenu(b.dataset.fmenu));
  fl.querySelectorAll("[data-new]").forEach(b => b.onclick = () => { const x = nf.get(b.dataset.new); preview(b.dataset.new, new Blob([x.bytes])); });
  fl.querySelectorAll("[data-newmenu]").forEach(b => b.onclick = () => newMenu(b.dataset.newmenu));
}

function paintRun() {
  const on = runner.running(), n = (cur && cur.tests || []).length;
  $("#cd-tn").textContent = n ? String(n) : "";
  $("#cd-run").classList.toggle("busy", on);
  $("#cd-stop").disabled = !on;
}
function paintStatus() {
  const el = $("#cd-status"); if (!el) return;
  const s = runner.status();
  let t;
  if (runner.running() && s.state === "ready") t = `Running… ${Math.floor((Date.now() - runT0) / 1000)}s`;
  else if (s.state === "loading") t = lastStatus || "Starting Python…";
  else if (s.state === "ready") t = `Python ${s.version} · ready`;
  else t = "Python";
  el.textContent = t;
}
let lastStatus = "";
runner.onStatus(s => { lastStatus = s.text; if (root) paintStatus(); });

/* ---------- running ---------- */
function clearOut(hint = true) {
  outChars = 0; outCut = false;
  const o = $("#cd-out"); if (!o) return;
  o.innerHTML = hint ? `<p class="cd-dim cd-hint">Press Run to see what your program prints.</p>` : "";
  $("#cd-time").textContent = "";
}
function outEl() { return $("#cd-out"); }
function addBlock(el) { const o = outEl(); o.querySelector(".cd-hint")?.remove(); o.appendChild(el); o.scrollTop = o.scrollHeight; return el; }
// a table and a chart next to each other share a row (table on the left)
function addMedia(el) {
  const last = outEl().lastElementChild, isT = el.classList.contains("cd-tbl");
  if (last && !last.classList.contains("cd-pair") && last.classList.contains(isT ? "cd-img" : "cd-tbl")) {
    const pair = document.createElement("div"); pair.className = "cd-pair";
    last.replaceWith(pair);
    if (isT) pair.append(el, last); else pair.append(last, el);
    return el;
  }
  return addBlock(el);
}
function textBlock(err) {
  const o = outEl(), last = o.lastElementChild;
  if (last && last.classList.contains("cd-txt") && last.classList.contains("err") === !!err) return last;
  const p = document.createElement("pre"); p.className = "cd-txt" + (err ? " err" : ""); return addBlock(p);
}
function addText(text, err, cls) {
  if (outCut) return;
  outChars += text.length;
  if (outChars > MAX_OUT) { outCut = true; note("Output cut off here. That's a lot of printing."); return; }
  const b = textBlock(err);
  if (cls) { const s = document.createElement("span"); s.className = cls; s.textContent = text; b.appendChild(s); }
  else b.appendChild(document.createTextNode(text));
  outEl().scrollTop = outEl().scrollHeight;
}
function note(t, cls = "") { const p = document.createElement("p"); p.className = "cd-note2 " + cls; p.textContent = t; addBlock(p); }

function tableEl(t, title) {
  const w = document.createElement("div"); w.className = "cd-tbl";
  const head = `<tr><th></th>${t.cols.map((c, i) => `<th class="${t.num[i] ? "num" : ""}">${esc(c)}</th>`).join("")}</tr>`;
  const rows = t.rows.map((r, j) => `<tr><td class="ix">${esc(t.index[j])}</td>${r.map((v, i) => `<td class="${t.num[i] ? "num" : ""}">${esc(v)}</td>`).join("")}</tr>`).join("");
  const [n, m] = t.shape;
  w.innerHTML = `${title ? `<div class="cd-tbl-t">${esc(title)}</div>` : ""}<div class="cd-tbl-s"><table>${head}${rows}</table></div>
    <div class="cd-tbl-f">${n} row${n === 1 ? "" : "s"} × ${m} column${m === 1 ? "" : "s"}${t.shown < n ? ` · first ${t.shown} shown` : ""}</div>`;
  return w;
}

async function gatherFiles() {
  const list = cur.files.map(f => ({ name: f.name, text: f.text }));
  const missing = [];
  for (const d of data) {
    try { list.push({ name: d.name, bytes: await (await files.blob(d.id)).arrayBuffer() }); }
    catch (e) { missing.push(d.name); }
  }
  for (const [n, x] of freshOf(cur.id)) {
    const i = list.findIndex(f => f.name === n); const item = { name: n, bytes: x.bytes.slice(0) };
    if (i >= 0) list[i] = item; else list.push(item);
  }
  return { list, missing };
}

async function runNow() {
  if (!cur) return;
  const prog = cur, f = activeFile();
  await save(true);
  clearOut(false); ed.markLine(0);
  const { list, missing } = await gatherFiles();
  for (const n of missing) note(`${n} isn't on this device yet, so your program can't read it.`, "warn");
  const id = ++runId;
  // pressing Run again mid-run restarts Python, so the old run's cleanup must not touch this one
  const restart = runner.running();
  runT0 = Date.now();
  clearInterval(tick); tick = setInterval(paintStatus, 1000);
  const loading = document.createElement("p"); loading.className = "cd-dim cd-loading";
  loading.textContent = runner.status().state === "ready" && !restart ? "" : "Starting Python… the first run takes a few seconds.";
  if (loading.textContent) addBlock(loading);
  printed = ""; let failed = false;
  const p = runner.run({ files: list, main: f.name, stdin: prog.input || "" }, ev => {
    if (cur !== prog || id !== runId) return;
    if (ev.type === "out" && !ev.err) printed += ev.text;
    if (ev.type === "error") failed = true;
    if (ev.type === "done") ev.ok = !failed;
    if (ev.type === "status") { if (!loading.isConnected && !outEl().children.length) addBlock(loading); loading.textContent = ev.text; return; }
    if (ev.type === "started") { loading.remove(); runT0 = Date.now(); paintStatus(); return; }
    loading.remove();
    if (ev.type === "out") addText(ev.text, ev.err);
    else if (ev.type === "echo") addText(ev.text + "\n", false, "cd-echo");
    else if (ev.type === "value") { const b = document.createElement("pre"); b.className = "cd-txt cd-val"; b.textContent = ev.text; addBlock(b); }
    else if (ev.type === "table") addMedia(tableEl(ev.table));
    else if (ev.type === "image") { const im = document.createElement("img"); im.className = "cd-img"; im.alt = "Chart from your program"; im.src = "data:image/png;base64," + ev.png; addMedia(im); }
    else if (ev.type === "error") showError(ev, f.name);
    else if (ev.type === "done") finished(prog, ev);
  });
  paintRun(); paintStatus();
  const how = await p;
  if (id !== runId) return;   // a newer run took over
  clearInterval(tick); paintRun(); paintStatus();
  if (cur !== prog) return;
  loading.remove();
  if (how === "timeout") { note("Stopped after a minute. Is there a loop that never ends?", "warn"); $("#cd-time").textContent = "stopped"; }
  else if (how === "stopped") { note("Stopped."); $("#cd-time").textContent = "stopped"; }
}

// What an error usually means, in plain words. The first pattern that matches wins.
const q = s => `"${s}"`;
const a = s => (/^[aeiou]/i.test(s) ? "an " : "a ") + s;
const HELP = [
  [/NameError/, /name '(.+?)' is not defined/, m => `Python doesn't know ${q(m[1])}. Check the spelling and capitals, and make sure it's set (or imported) before this line.`],
  [/UnboundLocalError/, /'(.+?)'/, m => `${q(m[1])} is used inside the function before it gets a value there. To change an outside variable, pass it in or return the new value.`],
  [/TypeError/, /can only concatenate str \(not "(.+?)"\) to str/, m => `You're joining text with ${a(m[1])}. Wrap it in str(), or use an f-string like f"Total: {x}".`],
  [/TypeError/, /unsupported operand type\(s\) for (.+?): '(.+?)' and '(.+?)'/, m => `${q(m[1])} doesn't work between ${a(m[2])} and ${a(m[3])}.${/str/.test(m[2] + m[3]) ? " input() always gives text, so convert it with int() or float() first." : ""}`],
  [/TypeError/, /'(.+?)' object is not subscriptable/, m => `You used [ ] on ${a(m[1])}, which can't be indexed. Only things like lists, strings and dicts can.`],
  [/TypeError/, /'(.+?)' object is not callable/, m => `You used ( ) on ${a(m[1])} as if it were a function. Did a variable reuse a function's name (like list or sum)?`],
  [/TypeError/, /'(.+?)' object is not iterable/, m => `A for loop (or list()) needs something with items, but got ${a(m[1])}. For counting, use range(n).`],
  [/TypeError/, /missing (\d+) required positional argument/, m => `The function needs ${m[1]} more value${m[1] === "1" ? "" : "s"} than you gave it. Compare the call with its def line.`],
  [/TypeError/, /takes (\d+) positional arguments? but (\d+) (?:was|were) given/, m => `The function takes ${m[1]} value${m[1] === "1" ? "" : "s"} but got ${m[2]}.${+m[2] === +m[1] + 1 ? " Methods inside a class need self as their first parameter." : ""}`],
  [/ValueError/, /invalid literal for int\(\) with base 10: '(.*?)'/, m => m[1] === "" ? "int() got an empty line. Is the Input box missing a line?" : /^-?\d+\.\d*$/.test(m[1]) ? `int() can't read ${q(m[1])} because it has a decimal point. Use float() instead.` : `int() can't turn ${q(m[1])} into a whole number. Check the Input box or what you're converting.`],
  [/ValueError/, /could not convert string to float: '(.*?)'/, m => `float() can't turn ${q(m[1])} into a number.`],
  [/ValueError/, /too many values to unpack|not enough values to unpack/, () => "The number of names on the left doesn't match how many values are on the right."],
  [/IndexError/, /list index out of range/, () => "That position is past the end of the list. Positions start at 0, so the last one is len(list) - 1."],
  [/IndexError/, /string index out of range/, () => "That position is past the end of the text. Positions start at 0, so the last one is len(s) - 1."],
  [/KeyError/, /^'?(.+?)'?$/, m => `There's no key ${q(m[1])}. Check the spelling and capitals. With pandas, check the column names with df.columns.`],
  [/ZeroDivisionError/, /./, () => "Something was divided by zero. Check the value before dividing, for example if count > 0."],
  [/RecursionError/, /./, () => "A function kept calling itself and never stopped. Make sure there's a base case that returns without calling again."],
  [/IndentationError|TabError/, /expected an indented block/, () => "The line after one ending in : needs to be indented (4 spaces)."],
  [/IndentationError|TabError/, /unindent does not match|unexpected indent|inconsistent/, () => "The spaces at the start of this line don't line up with the lines around it."],
  [/SyntaxError/, /expected ':'/, () => "This line needs a : at the end (if, for, while, def and class lines all do)."],
  [/SyntaxError/, /'(.)' was never closed/, m => `A ${q(m[1])} is opened here but never closed.`],
  [/SyntaxError/, /unterminated string/, () => "A string is missing its closing quote."],
  [/SyntaxError/, /invalid syntax\. Maybe you meant '==' or ':='/, () => "Use == to compare. A single = stores a value."],
  [/SyntaxError/, /Missing parentheses in call to 'print'/, () => "In Python 3, print needs parentheses: print(\"hi\")."],
  [/AttributeError/, /'(.+?)' object has no attribute '(.+?)'/, m => `${a(m[1]).replace(/^a/, "A")} doesn't have ${q(m[2])}. Check the spelling, or whether the value is the type you think it is.${m[1] === "NoneType" ? " Something returned None here. Did a function forget to return?" : ""}`],
  [/FileNotFoundError/, /'(.+?)'/, m => `There's no file named ${q(m[1])}. Add it in the Files panel; the name has to match exactly, capitals too.`],
];
function explain(kind, msg) {
  for (const [k, re, f] of HELP) { if (!k.test(kind)) continue; const m = re.exec(msg || ""); if (m) return f(m); }
  return "";
}

function showError(ev, ran) {
  const b = document.createElement("div"); b.className = "cd-err";
  const where = ev.line ? `Line ${ev.line}${ev.file && ev.file !== ran ? ` of ${ev.file}` : ""}: ` : "";
  const help = explain(ev.kind, ev.msg);
  b.innerHTML = `<div class="cd-err-m">${esc(where)}<b>${esc(ev.kind)}</b>: ${esc(ev.msg)}</div>${help ? `<p class="cd-err-h">${esc(help)}</p>` : ""}${ev.trace ? `<details><summary>Full error</summary><pre>${esc(ev.trace)}</pre></details>` : ""}`;
  addBlock(b);
  if (ev.line) {
    if (ev.file && ev.file !== activeFile().name && cur.files.some(x => x.name === ev.file)) { cur.active = ev.file; ed.set(activeFile().text); paintFiles(); }
    ed.markLine(ev.line);
    b.querySelector(".cd-err-m").style.cursor = "pointer";
    b.querySelector(".cd-err-m").onclick = () => ed.markLine(ev.line, { focus: true });
  }
  $("#cd-time").textContent = "error";
}

function finished(prog, ev) {
  if (!$("#cd-time").textContent) $("#cd-time").textContent = `ran in ${ev.ms < 10000 ? (ev.ms / 1000).toFixed(2) : Math.round(ev.ms / 1000)}s`;
  if (!outEl().children.length) note("Your program didn't print anything.", "dim");
  const nf = freshOf(prog.id), py = new Set(prog.files.map(f => f.name));
  const written = (ev.written || []).filter(w => !py.has(w.name));
  for (const w of written) nf.set(w.name, { bytes: w.bytes, type: typeOf(w.name) });
  if (written.length) {
    const b = document.createElement("div"); b.className = "cd-wrote";
    b.innerHTML = `<span class="cd-dim">Your program saved</span>${written.map(w => `<button class="link-btn" data-dl="${esc(w.name)}">${svg("download")}${esc(w.name)}</button>`).join("")}`;
    b.querySelectorAll("[data-dl]").forEach(x => x.onclick = () => saveBlob(x.dataset.dl, new Blob([nf.get(x.dataset.dl).bytes], { type: typeOf(x.dataset.dl) })));
    addBlock(b);
    paintFiles();
  }
  // a run that printed the right thing can become a test in one tap
  if (ev.ok && printed.trim() && !outCut) {
    const input = prog.input || "", expected = printed;
    const b = document.createElement("div"); b.className = "cd-wrote";
    b.innerHTML = `<button class="link-btn" type="button">${svg("listChecks")}Save this run as a test</button>`;
    b.querySelector("button").onclick = async () => {
      prog.tests = [...(prog.tests || []), { input, expected }];
      if (cur === prog) { await save(true); paintRun(); }
      b.innerHTML = `<span class="cd-dim">Saved as test ${prog.tests.length}.</span>`;
    };
    addBlock(b);
  }
}

/* ---------- tests ---------- */
// A test is { input, expected }: run with that Input, compare what it prints.
// Spaces at line ends and blank lines at the very end don't count.
const norm = s => String(s || "").replace(/\r/g, "").split("\n").map(l => l.trimEnd()).join("\n").replace(/\n+$/, "");

function testsSheet() {
  if (!cur) return;
  let list = (cur.tests || []).map(t => ({ ...t }));
  if (!list.length) list.push({ input: cur.input || "", expected: "" });
  const { f, close } = sheet(`<h2>Tests</h2>
    <p class="note">Each test runs your program with its input and checks the printed output. Spaces at the end of lines don't count.</p>
    <div class="cd-tcases" id="cd-tcases"></div>
    <button type="button" class="link-btn cd-tadd" id="cd-tadd">${svg("plus")}Add a test</button>
    <div class="acts"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button type="button" class="pill-btn secondary" id="cd-tsave">Save</button><button class="pill-btn">Run tests</button></div>`);
  const box = f.querySelector("#cd-tcases");
  const paint = () => {
    box.innerHTML = list.map((t, i) => `<div class="cd-tcase">
      <div class="cd-tch"><b>Test ${i + 1}</b><button type="button" class="icon-btn" data-del="${i}" aria-label="Delete test ${i + 1}">${svg("x")}</button></div>
      <div class="cd-tcg"><label>Input<textarea class="field cd-input" rows="3" data-in="${i}" wrap="off" spellcheck="false" autocapitalize="off" placeholder="One line per input()">${esc(t.input)}</textarea></label>
      <label>Expected output<textarea class="field cd-input" rows="3" data-ex="${i}" wrap="off" spellcheck="false" autocapitalize="off" placeholder="What it should print">${esc(t.expected)}</textarea></label></div></div>`).join("")
      || `<p class="cd-dim">No tests yet.</p>`;
    box.querySelectorAll("[data-in]").forEach(a => a.oninput = () => { list[+a.dataset.in].input = a.value; });
    box.querySelectorAll("[data-ex]").forEach(a => a.oninput = () => { list[+a.dataset.ex].expected = a.value; });
    box.querySelectorAll("[data-del]").forEach(b => b.onclick = () => { list.splice(+b.dataset.del, 1); paint(); });
  };
  paint();
  f.querySelector("#cd-tadd").onclick = () => { list.push({ input: "", expected: "" }); paint(); box.lastElementChild?.querySelector("textarea")?.focus(); };
  const keep = async () => { cur.tests = list.filter(t => t.input.trim() || t.expected.trim()); await save(true); paintRun(); };
  f.querySelector("#cd-tsave").onclick = async () => { await keep(); close(); ctx0.toast(cur.tests.length ? `Saved ${cur.tests.length} test${cur.tests.length === 1 ? "" : "s"}` : "No tests saved"); };
  f.onsubmit = async e => {
    e.preventDefault(); await keep();
    if (!cur.tests.length) { ctx0.toast("Add the output a test should expect"); return; }
    close(); runTests();
  };
}

function caseEl(i, t, got, err, how) {
  const b = document.createElement("div"); b.className = "cd-case fail";
  const title = `<div class="cd-case-h">${svg("x")}<b>Test ${i + 1}</b>`;
  const inp = t.input.trim() ? `<span class="cd-dim">input: ${esc(t.input.trim().split("\n").join(" ⏎ ").slice(0, 80))}</span>` : "";
  if (err) {
    const help = explain(err.kind, err.msg);
    b.innerHTML = `${title}<span>crashed</span>${inp}</div><div class="cd-err-m">${err.line ? `Line ${err.line}: ` : ""}<b>${esc(err.kind)}</b>: ${esc(err.msg)}</div>${help ? `<p class="cd-err-h">${esc(help)}</p>` : ""}`;
    return b;
  }
  if (how === "timeout") { b.innerHTML = `${title}<span>took over a minute</span>${inp}</div>`; return b; }
  const want = norm(t.expected).split("\n"), have = norm(got).split("\n");
  let k = 0; while (k < want.length && k < have.length && want[k] === have[k]) k++;
  const col = (lines, label) => `<div><div class="cd-dim">${label}</div><pre class="cd-txt">${lines.slice(0, 60).map((l, j) => j === k ? `<mark>${esc(l) || " "}</mark>` : esc(l)).join("\n")}${lines.length > 60 ? "\n…" : ""}</pre></div>`;
  const why = k >= have.length ? `stops early at line ${k + 1}` : k >= want.length ? `prints extra lines from line ${k + 1}` : `line ${k + 1} is different`;
  b.innerHTML = `${title}<span>${why}</span>${inp}</div><div class="cd-diff">${col(want, "Expected")}${col(have, "Got")}</div>`;
  return b;
}

async function runTests() {
  if (!cur || !(cur.tests || []).length) return;
  const prog = cur, f = activeFile(), tests = prog.tests, id = ++runId;
  await save(true);
  clearOut(false); ed.markLine(0);
  const { list, missing } = await gatherFiles();
  for (const n of missing) note(`${n} isn't on this device yet, so your program can't read it.`, "warn");
  runT0 = Date.now();
  clearInterval(tick); tick = setInterval(paintStatus, 1000);
  const head = document.createElement("p"); head.className = "cd-tsum"; addBlock(head);
  let pass = 0, ran = 0;
  for (let i = 0; i < tests.length; i++) {
    const t = tests[i]; let got = "", err = null;
    head.textContent = `Running test ${i + 1} of ${tests.length}…`;
    const p = runner.run({ files: list, main: f.name, stdin: t.input || "" }, ev => {
      if (id !== runId) return;
      if (ev.type === "status") head.textContent = `Test ${i + 1} of ${tests.length}: ${ev.text}`;
      else if (ev.type === "out" && !ev.err) got += ev.text;
      else if (ev.type === "error" && !err) err = ev;
    });
    paintRun();
    const how = await p;
    if (id !== runId || cur !== prog) return;
    if (how === "stopped") { note("Stopped."); break; }
    ran++;
    if (!err && how === "done" && norm(got) === norm(t.expected)) {
      pass++;
      const b = document.createElement("div"); b.className = "cd-case pass";
      b.innerHTML = `<div class="cd-case-h">${svg("check")}<b>Test ${i + 1}</b><span>passed</span></div>`;
      addBlock(b);
    } else addBlock(caseEl(i, t, got, err, how));
  }
  clearInterval(tick); paintRun(); paintStatus();
  head.textContent = pass === tests.length ? `All ${tests.length} test${tests.length === 1 ? "" : "s"} passed` : `${pass} of ${tests.length} tests passed`;
  head.classList.add(pass === tests.length ? "good" : "bad");
  $("#cd-time").textContent = ran < tests.length ? "stopped" : `${pass}/${tests.length} passed`;
}

/* ---------- files ---------- */
function saveBlob(name, blob) {
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name.split("/").pop(); a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 20000);
}
function parseCsv(text, sep) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length && rows.length <= 51; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell.replace(/\r$/, "")); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}
async function preview(name, blob) {
  clearOut(false);
  $("#cd-time").textContent = name;
  if (isCsv(name)) {
    const text = await blob.text(), lines = text.split("\n").filter(l => l.trim()).length;
    const rows = parseCsv(text, /\.tsv$/i.test(name) ? "\t" : ",");
    const [head, ...body] = rows; if (!head) { note("This file is empty."); return; }
    const shown = body.slice(0, 50);
    const num = head.map((_, i) => shown.length > 0 && shown.every(r => r[i] === undefined || r[i] === "" || isFinite(+r[i])));
    addBlock(tableEl({ cols: head, index: shown.map((_, i) => String(i)), rows: shown.map(r => head.map((_, i) => r[i] ?? "")), num, shape: [Math.max(0, lines - 1), head.length], shown: shown.length }, name));
    note(`Read it in your code with pd.read_csv("${name}")`, "dim");
  } else if (/^image\//.test(blob.type) || /\.(png|jpe?g|gif)$/i.test(name)) {
    const im = document.createElement("img"); im.className = "cd-img"; im.alt = name; im.src = URL.createObjectURL(blob); addBlock(im);
  } else if (blob.size < 400000) {
    const b = document.createElement("pre"); b.className = "cd-txt"; b.textContent = await blob.text(); addBlock(b);
  } else note(`${name} is ${files.sizeText(blob.size)}. Open it with open("${name}") in your code.`);
}
async function previewKept(id) {
  const d = data.find(x => x.id === id); if (!d) return;
  const nf = freshOf(cur.id).get(d.name);
  try { preview(d.name, nf ? new Blob([nf.bytes]) : await files.blob(id)); }
  catch (e) { ctx0.toast(files.errorText(e)); }
}

async function keepFile(name, bytes) {
  const old = data.filter(d => d.name === name);
  await files.add(new File([bytes], name, { type: typeOf(name) }), { scope: "code", owner: owner(cur.id) });
  for (const d of old) await files.remove(d.id);
  freshOf(cur.id).delete(name);
  await loadData(); paintFiles();
}
async function addPicked(list) {
  let n = 0;
  for (const file of list) {
    if (isPy(file.name) && file.size < 1024 * 1024) {
      const text = await file.text(), have = cur.files.find(f => f.name === file.name);
      if (have) have.text = text; else cur.files.push({ name: file.name, text });
      cur.active = file.name; await save(true); n++; continue;
    }
    try { await keepFile(file.name, await file.arrayBuffer()); n++; }
    catch (e) { ctx0.toast(files.errorText(e)); }
  }
  if (n) { ctx0.toast(n === 1 ? `Added ${list[0].name}` : `Added ${n} files`); render(); }
}
function wireDrop(el) {
  el.addEventListener("dragover", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); el.classList.add("drag"); } });
  el.addEventListener("dragleave", e => { if (!el.contains(e.relatedTarget)) el.classList.remove("drag"); });
  el.addEventListener("drop", e => { el.classList.remove("drag"); if (e.dataTransfer.files.length) { e.preventDefault(); addPicked([...e.dataTransfer.files]); } });
}

/* ---------- sheets ---------- */
function sheet(html) {
  const back = document.createElement("div"); back.className = "ap-back";
  back.innerHTML = `<form class="ap-sheet cd-sheet" role="dialog" aria-modal="true" autocomplete="off">${html}</form>`;
  root.appendChild(back);
  const f = back.querySelector("form"), close = () => back.remove();
  back.addEventListener("click", e => { if (e.target === back) close(); });
  f.querySelectorAll('[data-act="cancel"]').forEach(c => c.onclick = close);
  return { f, close };
}
function cleanName(v) {
  let n = String(v || "").trim().replace(/[\\:*?"<>|]/g, "").replace(/\s+/g, "_");
  if (n && !isPy(n)) n += ".py";
  return n;
}
function nameSheet({ title, value, go, taken = cur ? cur.files.map(f => f.name) : [] }) {
  const { f, close } = sheet(`<h2>${esc(title)}</h2>
    <label>Name<input class="field" name="n" value="${esc(value)}" required spellcheck="false" autocapitalize="off"></label>
    <div class="acts"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn">Save</button></div>`);
  const inp = f.n; inp.focus(); inp.setSelectionRange(0, Math.max(0, value.lastIndexOf(".")));
  f.onsubmit = async e => {
    e.preventDefault();
    const n = cleanName(inp.value);
    if (!n || n === ".py") { ctx0.toast("Give it a name"); return; }
    if (n !== value && taken.includes(n)) { ctx0.toast(`There's already a ${n}`); return; }
    close(); await go(n);
  };
}
function newProgSheet() {
  const { f, close } = sheet(`<h2>New program</h2>
    <div class="cd-pick">${EXAMPLES.map((x, i) => `<label class="cd-opt"><input type="radio" name="ex" value="${x.key}" ${i === 0 ? "checked" : ""}><span>${esc(x.label)}</span></label>`).join("")}</div>
    <label>Name<input class="field" name="n" value="program.py" spellcheck="false" autocapitalize="off"></label>
    <div class="acts"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn">Create</button></div>`);
  f.querySelectorAll('[name="ex"]').forEach(r => r.onchange = () => { f.n.value = EXAMPLES.find(x => x.key === r.value).name; });
  f.onsubmit = async e => {
    e.preventDefault();
    const ex = EXAMPLES.find(x => x.key === f.ex.value), n = cleanName(f.n.value) || ex.name;
    close(); await save(true);
    if (runner.running()) runner.stop("stopped");
    cur = await create(ex, n); setRoute(); clearOut(); render();
  };
}
function menuSheet(title, items) {
  const { f, close } = sheet(`<h2>${esc(title)}</h2><div class="cd-menu">${items.map((it, i) => `<button type="button" class="cd-mi ${it.danger ? "danger" : ""}" data-i="${i}">${svg(it.icon)}<span>${esc(it.label)}</span></button>`).join("")}</div>
    <div class="acts"><button type="button" class="pill-btn secondary" data-act="cancel">Close</button></div>`);
  f.querySelectorAll("[data-i]").forEach(b => b.onclick = () => { close(); items[+b.dataset.i].run(); });
  f.onsubmit = e => e.preventDefault();
}
function confirmSheet(title, text, label, go) {
  const { f, close } = sheet(`<h2>${esc(title)}</h2><p class="note">${esc(text)}</p>
    <div class="acts"><button type="button" class="pill-btn secondary" data-act="cancel">Cancel</button><button class="pill-btn danger">${esc(label)}</button></div>`);
  f.onsubmit = async e => { e.preventDefault(); close(); await go(); };
}
function delProg() {
  if (!cur) return;
  const main = cur.files[0];
  confirmSheet(`Delete ${main.name}?`, `This deletes its code${data.length ? ` and ${data.length} data file${data.length === 1 ? "" : "s"}` : ""} on all your devices. It can't be undone.`, "Delete", async () => {
    if (runner.running()) runner.stop("stopped");
    const id = cur.id;
    for (const d of data) await files.remove(d.id).catch(() => {});
    await store.remove(APP, id); fresh.delete(id);
    cur = null; clearOut(); await loadProgs(); cur = progs[progs.length - 1] || null; setRoute(); render();
  });
}
function progMenu() {
  if (!cur) return;
  const main = cur.files[0];
  menuSheet(main.name, [
    { icon: "pencil", label: "Rename", run: () => nameSheet({ title: "Rename program", value: main.name, go: async n => { if (cur.active === main.name) cur.active = n; main.name = n; await save(true); render(); } }) },
    { icon: "copy", label: "Duplicate", run: async () => {
      await save(true);
      const id = "p-" + uid(), now = Date.now(), base = main.name.replace(/\.py$/i, "");
      await store.put(APP, id, { files: cur.files.map((f, i) => ({ name: i ? f.name : `${base}_copy.py`, text: f.text })), active: cur.active === main.name ? `${base}_copy.py` : cur.active, input: cur.input || "", tests: (cur.tests || []).map(t => ({ ...t })), created: now, updated: now });
      cur = { id }; setRoute(); clearOut(); render();
    } },
    { icon: "x", label: "Delete program", danger: true, run: delProg },
  ]);
}
function pyMenu(name) {
  const f = cur.files.find(x => x.name === name); if (!f) return;
  const items = [{ icon: "pencil", label: "Rename", run: () => nameSheet({ title: "Rename file", value: name, go: async n => { if (cur.active === name) cur.active = n; f.name = n; await save(true); render(); } }) },
    { icon: "download", label: "Download", run: () => saveBlob(name, new Blob([f.text], { type: "text/x-python" })) }];
  if (f !== cur.files[0]) items.push({ icon: "x", label: "Delete file", danger: true, run: () => confirmSheet(`Delete ${name}?`, "This can't be undone.", "Delete", async () => {
    cur.files = cur.files.filter(x => x !== f); if (cur.active === name) cur.active = cur.files[0].name; await save(true); render();
  }) });
  menuSheet(name, items);
}
function dataMenu(id) {
  const d = data.find(x => x.id === id); if (!d) return;
  const nf = freshOf(cur.id).get(d.name);
  const items = [];
  if (nf) items.push({ icon: "check", label: "Keep the new version", run: () => keepFile(d.name, nf.bytes) });
  items.push({ icon: "download", label: "Download", run: () => nf ? saveBlob(d.name, new Blob([nf.bytes])) : files.download(id).catch(e => ctx0.toast(files.errorText(e))) });
  items.push({ icon: "x", label: "Delete file", danger: true, run: () => confirmSheet(`Delete ${d.name}?`, "It's deleted on all your devices. This can't be undone.", "Delete", async () => { await files.remove(id); freshOf(cur.id).delete(d.name); await loadData(); paintFiles(); }) });
  menuSheet(d.name, items);
}
function newMenu(name) {
  const x = freshOf(cur.id).get(name); if (!x) return;
  menuSheet(name, [
    { icon: "check", label: "Keep it with this program", run: () => keepFile(name, x.bytes).then(() => ctx0.toast(`Kept ${name}`)).catch(e => ctx0.toast(files.errorText(e))) },
    { icon: "download", label: "Download", run: () => saveBlob(name, new Blob([x.bytes], { type: x.type })) },
    { icon: "x", label: "Discard", run: () => { freshOf(cur.id).delete(name); paintFiles(); } },
  ]);
}

/* ---------- app ---------- */
let cssLoaded = false;
function loadCss() {
  if (cssLoaded) return; cssLoaded = true;
  const link = document.createElement("link"); link.rel = "stylesheet"; link.href = new URL("./code.css", import.meta.url).href;
  document.head.appendChild(link);
}
async function mount(el, ctx) {
  ctx0 = ctx; root = el; loadCss();
  el.classList.add("ap", "cd");
  el.innerHTML = `<div class="ap-bar"><button class="ap-home" data-home aria-label="Home">${svg("chevronLeft")}Home</button>
    <span class="ap-title">Code</span><span class="ap-spacer"></span>
    <span class="cd-status" id="cd-status"></span>
    <button class="icon-btn" id="cd-menu" aria-label="Program options" hidden>${svg("ellipsis")}</button></div>
    <div class="ap-scroll"><div class="ap-body cd-body" id="cd-body"></div></div>
    <input type="file" id="cd-pick" multiple hidden>`;
  $("#cd-menu").onclick = progMenu;
  $("#cd-pick").onchange = e => { const l = [...e.target.files]; e.target.value = ""; if (l.length) addPicked(l); };
  store.onChange(ch => {
    if (!ctx.isActive() || ch.source !== "remote") return;
    if (ch.app === APP) render();
    else if (ch.app === "files" && cur) loadData().then(paintFiles);
  });
  window.addEventListener("beforeunload", () => { if (saveT) save(true); });
}
async function show(arg) {
  const id = arg ? decodeURIComponent(arg) : null;
  if (id && (!cur || cur.id !== id)) { await save(true); cur = { id }; clearOut(); }
  await render();
}

export default { id: APP, name: "Code", icon: "code", tint: "pink", mount, show };
