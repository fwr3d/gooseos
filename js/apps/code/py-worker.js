// Runs Python (Pyodide) off the main thread, so a slow or stuck program never
// freezes the app. The page kills this worker to stop a run.
//
// In:  { type: "run", files: [{ name, text } | { name, bytes }], main, stdin }
// Out: { type: "status", text }         loading progress
//      { type: "ready", version }       Python is loaded
//      { type: "started" }              packages are in, the program is running now
//      { type: "out", text, err }       printed text (err = stderr)
//      { type: "echo", text }           a line input() read from the Input box
//      { type: "value", text }          the last line's value (repr)
//      { type: "table", table }         a dataframe: { cols, index, rows, num, shape, shown }
//      { type: "image", png }           a chart (base64 PNG)
//      { type: "error", kind, msg, line, file, trace }
//      { type: "done", ms, written: [{ name, bytes }] }
import { loadPyodide } from "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/pyodide.mjs";

const WORK = "/home/pyodide/work";
let py = null, ready = null;

/* ---------- output: batched, so a print loop doesn't flood the page ---------- */
let buf = "", bufErr = false, last = 0;
const dec = new TextDecoder(), decErr = new TextDecoder();
function flush() { if (buf) { postMessage({ type: "out", text: buf, err: bufErr }); buf = ""; } last = performance.now(); }
function write(text, err) {
  if (err !== bufErr) flush();
  bufErr = err; buf += text;
  if (buf.length > 4000 || performance.now() - last > 60) flush();
}
function post(msg) { flush(); postMessage(msg); }

const HARNESS = String.raw`
import sys, os, io, ast, json, base64, builtins, traceback, shutil
from pyodide.code import eval_code_async
import _gooseos

os.environ["MPLBACKEND"] = "module://_gooseos_plot"

_real_input = builtins.input
_user_files = set()

def _input(prompt=""):
    if prompt:
        sys.stdout.write(str(prompt)); sys.stdout.flush()
    line = sys.stdin.readline()
    if not line:
        raise EOFError("input() ran out of lines. Add more to the Input box.")
    line = line.rstrip("\n").rstrip("\r")
    _gooseos.echo(line)
    return line

def _fmt(v):
    if isinstance(v, float):
        if v != v: return "NaN"
        return ("%.6g" % v) if abs(v) < 1e15 else repr(v)
    return str(v)

def _table(obj):
    import pandas as pd
    if isinstance(obj, pd.Series):
        obj = obj.to_frame()
    n, m = obj.shape
    head = obj.head(200)
    num = [bool(pd.api.types.is_numeric_dtype(t)) for t in head.dtypes]
    rows = [[_fmt(v) for v in r] for r in head.itertuples(index=False, name=None)]
    _gooseos.table(json.dumps({
        "cols": [str(c) for c in head.columns], "index": [str(i) for i in head.index],
        "rows": rows, "num": num, "shape": [n, m], "shown": len(rows)}))

def _is_frame(x):
    t = type(x)
    return t.__module__.startswith("pandas") and t.__name__ in ("DataFrame", "Series")

def display(*objs):
    for x in objs:
        if _is_frame(x): _table(x)
        elif x is not None: print(repr(x))

def _show_figs():
    if "matplotlib.pyplot" not in sys.modules: return
    import matplotlib.pyplot as plt
    for num in plt.get_fignums():
        fig = plt.figure(num)
        b = io.BytesIO()
        fig.savefig(b, format="png", dpi=110, bbox_inches="tight")
        _gooseos.image(base64.b64encode(b.getvalue()).decode())
    plt.close("all")

def _report(e):
    tb = traceback.extract_tb(e.__traceback__)
    mine = [f for f in tb if os.path.basename(f.filename) in _user_files and os.path.dirname(f.filename) in ("", ".", "${WORK}")]
    line, file = None, None
    if isinstance(e, SyntaxError) and e.filename and os.path.basename(str(e.filename)) in _user_files:
        line, file = e.lineno, os.path.basename(str(e.filename))
    elif mine:
        line, file = mine[-1].lineno, os.path.basename(mine[-1].filename)
    trace = ""
    if mine:
        trace = "Traceback (most recent call last):\n" + "".join(traceback.format_list(mine))
    trace += "".join(traceback.format_exception_only(type(e), e))
    msg = str(e)
    if isinstance(e, SyntaxError): msg = e.msg
    if isinstance(e, ModuleNotFoundError) and e.name:
        msg = f"No module named '{e.name}'. Not every package works here; the standard library, numpy, pandas and matplotlib do."
    _gooseos.error(type(e).__name__, msg, line or 0, file or "", trace)

async def _run(main, names, stdin_text):
    global _user_files
    _user_files = set(names)
    os.chdir("${WORK}")
    if "${WORK}" not in sys.path: sys.path.insert(0, "${WORK}")
    for k in [k for k, m in list(sys.modules.items()) if getattr(m, "__file__", "") and str(m.__file__).startswith("${WORK}/")]:
        del sys.modules[k]
    sys.stdin = io.StringIO(stdin_text)
    builtins.input = _input
    builtins.display = display
    g = {"__name__": "__main__", "__file__": main, "__builtins__": builtins}
    with open(main, encoding="utf-8") as f:
        src = f.read()
    try:
        r = await eval_code_async(src, g, filename=main)
        sys.stdout.flush()
        _show_figs()
        if r is not None:
            if _is_frame(r): _table(r)
            else: _gooseos.value(repr(r))
    except SystemExit as e:
        sys.stdout.flush()
        if e.code not in (None, 0): print(f"Exited with {e.code}", file=sys.stderr)
    except BaseException as e:
        sys.stdout.flush()
        try: _show_figs()
        except BaseException: pass
        _report(e)
    finally:
        sys.stdout.flush(); sys.stderr.flush()
`;

const PLOT_BACKEND = `
from matplotlib.backend_bases import _Backend
from matplotlib.backends.backend_agg import _BackendAgg

@_Backend.export
class _BackendGoose(_BackendAgg):
    @staticmethod
    def show(*args, **kwargs):
        import sys
        sys.modules["_gooseos_harness"]._show_figs()
`;

async function boot() {
  postMessage({ type: "status", text: "Starting Python…" });
  py = await loadPyodide();
  py.setStdout({ write: b => { write(dec.decode(b, { stream: true }), false); return b.length; } });
  py.setStderr({ write: b => { write(decErr.decode(b, { stream: true }), true); return b.length; } });
  py.registerJsModule("_gooseos", {
    echo: t => post({ type: "echo", text: String(t) }),
    value: t => post({ type: "value", text: String(t) }),
    table: j => post({ type: "table", table: JSON.parse(j) }),
    image: b => post({ type: "image", png: String(b) }),
    error: (kind, msg, line, file, trace) => post({ type: "error", kind, msg, line, file, trace }),
  });
  py.FS.mkdirTree(WORK);
  py.FS.writeFile("/home/pyodide/_gooseos_plot.py", PLOT_BACKEND);
  const mod = py.runPython(`import types, sys\nm = types.ModuleType("_gooseos_harness")\nsys.modules["_gooseos_harness"] = m\nm`);
  py.runPython(HARNESS.replaceAll("${WORK}", WORK), { globals: mod.__dict__ });
  py.runPython(`import sys\nsys.path.insert(0, "/home/pyodide")`);
  postMessage({ type: "ready", version: py.runPython("import sys; '%d.%d' % sys.version_info[:2]") });
}

/* ---------- the folder the program sees ---------- */
function clearDir(dir) {
  for (const n of py.FS.readdir(dir)) {
    if (n === "." || n === "..") continue;
    const p = `${dir}/${n}`;
    if (py.FS.isDir(py.FS.stat(p).mode)) { clearDir(p); py.FS.rmdir(p); } else py.FS.unlink(p);
  }
}
function snapshot(dir, base = "", out = new Map()) {
  for (const n of py.FS.readdir(dir)) {
    if (n === "." || n === ".." || n === "__pycache__") continue;
    const p = `${dir}/${n}`, s = py.FS.stat(p), rel = base ? `${base}/${n}` : n;
    if (py.FS.isDir(s.mode)) snapshot(p, rel, out); else out.set(rel, `${s.size}:${+s.mtime}`);
  }
  return out;
}

async function run({ files, main, stdin }) {
  const t0 = performance.now();
  clearDir(WORK);
  for (const f of files) {
    const p = `${WORK}/${f.name}`, d = p.slice(0, p.lastIndexOf("/"));
    if (d !== WORK) py.FS.mkdirTree(d);
    py.FS.writeFile(p, f.bytes ? new Uint8Array(f.bytes) : f.text);
  }
  const before = snapshot(WORK);
  const code = files.filter(f => f.text != null && /\.py$/.test(f.name)).map(f => f.text).join("\n");
  try {
    await py.loadPackagesFromImports(code, {
      messageCallback: m => { const x = /^Loading (.+)/.exec(m); if (x) postMessage({ type: "status", text: `Loading ${x[1].split(",").slice(0, 3).join(",")}…` }); },
      errorCallback: () => {},
    });
  } catch (e) { /* a missing package shows up as an import error when the program runs */ }
  postMessage({ type: "started" });
  const t1 = performance.now();
  const names = files.filter(f => /\.py$/.test(f.name)).map(f => f.name);
  const harness = py.pyimport("_gooseos_harness");
  try { await harness._run(main, py.toPy(names), stdin || ""); }
  catch (e) { post({ type: "error", kind: "Error", msg: String(e.message || e).split("\n").slice(-2).join(" "), line: 0, file: "", trace: "" }); }
  flush();
  const written = [];
  for (const [rel, sig] of snapshot(WORK)) {
    if (before.get(rel) === sig) continue;
    const data = py.FS.readFile(`${WORK}/${rel}`);
    if (data.length > 50 * 1024 * 1024 || written.length >= 20) continue;
    written.push({ name: rel, bytes: data.buffer });
  }
  postMessage({ type: "done", ms: Math.round(performance.now() - t1), total: Math.round(performance.now() - t0), written }, written.map(w => w.bytes));
}

onmessage = async e => {
  const m = e.data;
  try {
    if (!ready) ready = boot();
    await ready;
    if (m.type === "run") await run(m);
  } catch (err) {
    post({ type: "error", kind: "Error", msg: "Python couldn't start. Check your connection and try again.", line: 0, file: "", trace: String(err && err.message || err) });
    postMessage({ type: "done", ms: 0, written: [], failed: true });
    ready = null;
  }
};
