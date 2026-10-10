import { describe, expect, it } from "vitest";

import {
  PDF_PAGE,
  PdfPageWriter,
  buildPdf,
  pdfText,
  textWidth,
  wrapText,
} from "./pdf";

// CMP-06A: the PDF writer. A file every reader opens, with text that is
// always data.

/** Objects of a PDF by number, found through its cross-reference table. */
function objectsOf(file: Buffer) {
  const text = file.toString("latin1");
  const start = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(text)![1]);
  const table = text.slice(start);
  const size = Number(/^xref\n0 (\d+)\n/.exec(table)![1]);
  const entries = table
    .split("\n")
    .slice(2, 2 + size)
    .map((line) => Number(line.slice(0, 10)));
  return entries.map((offset, id) =>
    id === 0 ? null : text.slice(offset, text.indexOf("endobj", offset)),
  );
}

describe("buildPdf", () => {
  it("writes a file whose table points at each of its objects", () => {
    const page = new PdfPageWriter();
    page.text(48, 60, "Orden de compra", { font: "bold", size: 16 });
    page.line(48, 70, 564, 70);
    page.box(48, 80, 100, 12, 0.9);
    const file = buildPdf([page, new PdfPageWriter()], {
      title: "OC-0001",
      createdAt: new Date("2026-10-10T15:30:00.000Z"),
    });
    const text = file.toString("latin1");
    expect(text.startsWith("%PDF-1.4\n")).toBe(true);
    expect(text.endsWith("%%EOF\n")).toBe(true);

    const objects = objectsOf(file);
    // Catalog, pages, two fonts, info, and two pages with their content.
    expect(objects).toHaveLength(10);
    objects.forEach((object, id) => {
      if (id > 0)
        expect(object, `object ${id}`).toMatch(new RegExp(`^${id} 0 obj\n`));
    });
    expect(objects[1]).toContain("/Type /Catalog");
    expect(objects[2]).toContain("/Kids [6 0 R 8 0 R] /Count 2");
    expect(objects[3]).toContain(
      "/BaseFont /Helvetica /Encoding /WinAnsiEncoding",
    );
    expect(objects[4]).toContain("/BaseFont /Helvetica-Bold");
    expect(objects[5]).toContain("/Title (OC-0001)");
    expect(objects[5]).toContain("(D:20261010153000Z)");
    expect(objects[6]).toContain(
      `/MediaBox [0 0 ${PDF_PAGE.width} ${PDF_PAGE.height}]`,
    );
    // The declared length of a stream is its real length in bytes.
    const stream = /<< \/Length (\d+) >>\nstream\n([\s\S]*)\nendstream/.exec(
      objects[7]!,
    )!;
    expect(Buffer.byteLength(stream[2]!, "latin1")).toBe(Number(stream[1]));
    expect(stream[2]).toContain("/F2 16 Tf 48 732 Td (Orden de compra) Tj");
    expect(() => buildPdf([], { title: "x" })).toThrow();
  });

  it("holds nothing that runs: no scripts, actions, forms or embedded files", () => {
    const page = new PdfPageWriter();
    page.text(
      10,
      10,
      "/JavaScript (app.alert(1)) /OpenAction << /S /Launch >>",
    );
    const text = buildPdf([page], { title: "/AA /JS" }).toString("latin1");
    // Whatever the text says, it stays inside a literal string…
    expect(text).toContain(
      "(/JavaScript \\(app.alert\\(1\\)\\) /OpenAction << /S /Launch >>) Tj",
    );
    // …and no object of the file is anything but structure, fonts and text.
    const names = new Set(
      objectsOf(buildPdf([page], { title: "x" }))
        .filter(Boolean)
        .flatMap((object) =>
          [
            ...object!
              .replace(/\([\s\S]*?[^\\]\)/g, "()")
              .matchAll(/\/[A-Za-z0-9-]+/g),
          ].map((match) => match[0]),
        ),
    );
    for (const active of [
      "/JavaScript",
      "/JS",
      "/OpenAction",
      "/AA",
      "/Launch",
      "/URI",
      "/EmbeddedFile",
      "/AcroForm",
      "/Annots",
    ]) {
      expect(names.has(active), active).toBe(false);
    }
  });
});

describe("text", () => {
  it("is escaped as a literal: parentheses and backslashes cannot end it", () => {
    const page = new PdfPageWriter();
    page.text(0, 0, "Caja (grande) \\ ) Tj /F1 99 Tf (", { size: 9 });
    expect(page.content()).toContain(
      "(Caja \\(grande\\) \\\\ \\) Tj /F1 99 Tf \\() Tj ET",
    );
  });

  it("keeps Spanish as it is and replaces what the font does not have", () => {
    expect(pdfText("Ñandú «año» ¿sí? 3 × 100 — ok…")).toBe(
      "Ñandú «año» ¿sí? 3 × 100 — ok…",
    );
    expect(pdfText("línea\nuno\tdos\r\nfin")).toBe("línea uno dos fin");
    expect(pdfText("表 emoji 😀 fin")).toBe("? emoji ? fin");
    // Written as one byte each, in Windows-1252.
    const page = new PdfPageWriter();
    page.text(0, 0, "ñ×—");
    const bytes = Buffer.from(page.content(), "latin1");
    const open = bytes.indexOf(0x28);
    expect([...bytes.subarray(open + 1, open + 4)]).toEqual([0xf1, 0xd7, 0x97]);
  });

  it("measures with the metrics of Helvetica", () => {
    // H 722 + o 556 + l 222 + a 556 = 2056 thousandths.
    // In bold: 722 + 611 + 278 + 556 = 2167.
    expect(textWidth("Hola", 10, "regular")).toBeCloseTo(20.56, 5);
    expect(textWidth("Hola", 10, "bold")).toBeCloseTo(21.67, 5);
    expect(textWidth("1234567890", 10, "regular")).toBeCloseTo(55.6, 5);
    // An accent does not widen the letter.
    expect(textWidth("ñáÉ", 12, "regular")).toBe(
      textWidth("naE", 12, "regular"),
    );
    expect(textWidth("", 10, "regular")).toBe(0);
  });

  it("aligns to the right and to the centre by that measure", () => {
    const page = new PdfPageWriter();
    page.text(564, 100, "1234567890", { align: "right" });
    page.text(306, 100, "1234567890", { align: "center" });
    expect(page.content()).toContain("508.4 692 Td");
    expect(page.content()).toContain("278.2 692 Td");
  });

  it("wraps at spaces, keeps line breaks and cuts a word that cannot fit", () => {
    expect(wrapText("uno dos tres cuatro", 40, 10, "regular")).toEqual([
      "uno dos",
      "tres",
      "cuatro",
    ]);
    expect(wrapText("primera\nsegunda línea", 500, 10, "regular")).toEqual([
      "primera",
      "segunda línea",
    ]);
    const cut = wrapText("x".repeat(40), 50, 10, "regular");
    expect(cut.length).toBeGreaterThan(1);
    expect(cut.join("")).toBe("x".repeat(40));
    for (const line of cut) {
      expect(textWidth(line, 10, "regular")).toBeLessThanOrEqual(50);
    }
    expect(wrapText("", 100, 10, "regular")).toEqual([""]);
  });
});
