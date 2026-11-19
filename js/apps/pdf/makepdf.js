// Makes a PDF out of page images (JPEG), one image per page, each page the
// size you give in points (1/72 inch). Small on purpose: this is all the PDF
// editor needs to hand back a filled-in worksheet.
//
// makePdf([{ jpeg: Uint8Array, px: [w, h], pt: [w, h] }]) -> Blob (application/pdf)

const enc = new TextEncoder();

export function makePdf(pages) {
  const parts = [], offsets = [];
  let size = 0;
  const push = x => { const b = typeof x === "string" ? enc.encode(x) : x; parts.push(b); size += b.length; };
  const obj = (n, body, stream) => {
    offsets[n] = size;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push("stream\n"); push(stream); push("\nendstream\n"); }
    push("endobj\n");
  };

  // object numbers: 1 catalog, 2 page tree, then 3 per page (page, content, image)
  const pageNums = pages.map((_, i) => 3 + i * 3);
  push("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
  obj(1, "<< /Type /Catalog /Pages 2 0 R >>");
  obj(2, `<< /Type /Pages /Count ${pages.length} /Kids [${pageNums.map(n => `${n} 0 R`).join(" ")}] >>`);
  pages.forEach((p, i) => {
    const n = pageNums[i], [w, h] = p.pt.map(v => Math.round(v * 100) / 100);
    const draw = enc.encode(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`);
    obj(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${n + 2} 0 R >> >> /Contents ${n + 1} 0 R >>`);
    obj(n + 1, `<< /Length ${draw.length} >>`, draw);
    obj(n + 2, `<< /Type /XObject /Subtype /Image /Width ${p.px[0]} /Height ${p.px[1]} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>`, p.jpeg);
  });

  const count = 3 + pages.length * 3, xref = size;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`;
  push(table);
  push(`trailer\n<< /Size ${count} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: "application/pdf" });
}
