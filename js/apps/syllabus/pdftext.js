// Reads the text out of a PDF on the device (pdf.js, in js/vendor/pdfjs).
// Rebuilds lines from where text sits on the page, so schedule tables stay one row per line.

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import("../../vendor/pdfjs/pdf.min.mjs").then(pdfjs => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL("../../vendor/pdfjs/pdf.worker.min.mjs", import.meta.url).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

export async function pdfToText(file, onProgress = () => {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    onProgress(p, doc.numPages);
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // group text pieces into rows by their y position
    const rows = [];
    for (const it of content.items) {
      if (!it.str || !it.str.trim()) continue;
      const x = it.transform[4], y = it.transform[5], h = Math.abs(it.transform[3]) || 10;
      let row = rows.find(r => Math.abs(r.y - y) < Math.max(2, h * 0.4));
      if (!row) { row = { y, h, parts: [] }; rows.push(row); }
      row.parts.push({ x, w: it.width || 0, s: it.str });
    }
    rows.sort((a, b) => b.y - a.y);
    for (const r of rows) {
      r.parts.sort((a, b) => a.x - b.x);
      let line = "", end = null;
      for (const part of r.parts) {
        if (end != null) {
          const gap = part.x - end;
          line += gap > r.h * 2 ? "   " : gap > r.h * 0.15 ? " " : "";
        }
        line += part.s;
        end = part.x + part.w;
      }
      out.push(line.replace(/\s+$/, ""));
    }
    out.push("");
    page.cleanup();
  }
  try { await task.destroy(); } catch (e) { /* already closed */ }
  return out.join("\n");
}
