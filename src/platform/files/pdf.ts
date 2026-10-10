/**
 * A small PDF writer (CMP-06A): pages of text, lines and boxes, enough
 * for the documents of the business — a purchase order, later a receipt
 * or a report. No dependency: the format needed here is short, and what
 * goes into a file handed to a supplier is easier to vouch for when every
 * byte is written in this file.
 *
 * - **Fonts:** Helvetica and Helvetica-Bold, two of the fonts every PDF
 *   reader carries, so nothing is embedded. Text is written in the
 *   Windows-1252 encoding (Spanish accents, «», ¿¡, ×); a character it
 *   does not have becomes «?» rather than breaking the file.
 * - **No active content:** the file holds pages, fonts and text. No
 *   scripts, no forms, no links, no embedded files — there is no code
 *   path here that could write them, whatever the text says.
 * - **Text is data:** every string is escaped as a PDF literal, so a
 *   product named «) Tj /F9 99 Tf (» is printed, not obeyed.
 *
 * Units are points (1/72 inch); the origin of a page is its top-left
 * corner, as on a screen — the writer flips it for the PDF.
 */

export type PdfFont = "regular" | "bold";

/** Letter, the paper of Mexican offices. */
export const PDF_PAGE = { width: 612, height: 792 } as const;

// Advance widths of Helvetica, in thousandths of the font size, for the
// characters 32–126 (from the Adobe font metrics of the standard fonts).
const REGULAR = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584,
  584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278,
  278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500,
  500, 334, 260, 334, 584,
];
const BOLD = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278,
  278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584,
  584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611,
  833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333,
  278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278,
  556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556,
  500, 389, 280, 389, 584,
];

/** Accented letters measure what their base letter does. */
const BASE: Record<string, string> = {
  á: "a",
  à: "a",
  ä: "a",
  â: "a",
  ã: "a",
  å: "a",
  é: "e",
  è: "e",
  ë: "e",
  ê: "e",
  í: "ı",
  ì: "ı",
  ï: "ı",
  î: "ı",
  ó: "o",
  ò: "o",
  ö: "o",
  ô: "o",
  õ: "o",
  ú: "u",
  ù: "u",
  ü: "u",
  û: "u",
  ñ: "n",
  ç: "c",
  Á: "A",
  À: "A",
  Ä: "A",
  Â: "A",
  Ã: "A",
  Å: "A",
  É: "E",
  È: "E",
  Ë: "E",
  Ê: "E",
  Í: "I",
  Ì: "I",
  Ï: "I",
  Î: "I",
  Ó: "O",
  Ò: "O",
  Ö: "O",
  Ô: "O",
  Õ: "O",
  Ú: "U",
  Ù: "U",
  Ü: "U",
  Û: "U",
  Ñ: "N",
  Ç: "C",
};

/** Widths of the other characters used in Spanish documents. */
const EXTRA: Record<string, [regular: number, bold: number]> = {
  ı: [278, 278],
  "¿": [611, 611],
  "¡": [333, 333],
  "«": [556, 556],
  "»": [556, 556],
  "·": [278, 278],
  "×": [584, 584],
  "°": [400, 400],
  º: [365, 365],
  ª: [370, 370],
  "—": [1000, 1000],
  "–": [556, 556],
  "…": [1000, 1000],
  "›": [333, 333],
  "‹": [333, 333],
  "“": [333, 500],
  "”": [333, 500],
  "‘": [222, 278],
  "’": [222, 278],
  "•": [350, 350],
  "€": [556, 556],
};

/** Windows-1252 keeps these characters between 0x80 and 0x9F. */
const CP1252: Record<string, number> = {
  "€": 0x80,
  "‚": 0x82,
  ƒ: 0x83,
  "„": 0x84,
  "…": 0x85,
  "†": 0x86,
  "‡": 0x87,
  ˆ: 0x88,
  "‰": 0x89,
  Š: 0x8a,
  "‹": 0x8b,
  Œ: 0x8c,
  Ž: 0x8e,
  "‘": 0x91,
  "’": 0x92,
  "“": 0x93,
  "”": 0x94,
  "•": 0x95,
  "–": 0x96,
  "—": 0x97,
  "˜": 0x98,
  "™": 0x99,
  š: 0x9a,
  "›": 0x9b,
  œ: 0x9c,
  ž: 0x9e,
  Ÿ: 0x9f,
};

/** The byte a character is written as, or null when the font has none. */
function byteOf(character: string): number | null {
  const mapped = CP1252[character];
  if (mapped !== undefined) return mapped;
  const code = character.codePointAt(0)!;
  // Printable Latin-1; control characters are never text.
  if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
    return code;
  }
  return null;
}

/**
 * Text as the document can show it: one line, no control characters,
 * unknown characters as «?». Tabs and line breaks become spaces.
 */
export function pdfText(value: string): string {
  let text = "";
  for (const character of value.normalize("NFC").replace(/\s+/g, " ")) {
    text += byteOf(character) === null ? "?" : character;
  }
  return text;
}

/** Width of a text, in points, at a font size. */
export function textWidth(value: string, size: number, font: PdfFont): number {
  const table = font === "bold" ? BOLD : REGULAR;
  let units = 0;
  for (const original of pdfText(value)) {
    const character = BASE[original] ?? original;
    const code = character.codePointAt(0)!;
    const extra = EXTRA[character];
    units += extra
      ? extra[font === "bold" ? 1 : 0]
      : code >= 32 && code <= 126
        ? table[code - 32]!
        : 556;
  }
  return (units * size) / 1000;
}

/**
 * Breaks a text into lines that fit a width, at spaces; a word longer
 * than the line is cut. Line breaks of the text are kept.
 */
export function wrapText(
  value: string,
  width: number,
  size: number,
  font: PdfFont,
): string[] {
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = "";
    for (const word of pdfText(paragraph).split(" ").filter(Boolean)) {
      let rest = word;
      // A word that does not fit by itself is cut where it must.
      while (textWidth(rest, size, font) > width) {
        let cut = rest.length - 1;
        while (cut > 1 && textWidth(rest.slice(0, cut), size, font) > width) {
          cut--;
        }
        if (line) lines.push(line);
        lines.push(rest.slice(0, cut));
        line = "";
        rest = rest.slice(cut);
      }
      const joined = line ? `${line} ${rest}` : rest;
      if (textWidth(joined, size, font) <= width) {
        line = joined;
      } else {
        lines.push(line);
        line = rest;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** A PDF literal string: the text as bytes, with `\`, `(` and `)` escaped. */
function literal(value: string): string {
  let out = "(";
  for (const character of pdfText(value)) {
    const byte = byteOf(character)!;
    out +=
      byte === 0x5c || byte === 0x28 || byte === 0x29
        ? `\\${String.fromCharCode(byte)}`
        : String.fromCharCode(byte);
  }
  return `${out})`;
}

const number = (value: number) =>
  Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "0";

export type PdfTextOptions = {
  size?: number;
  font?: PdfFont;
  /** `right`: x is where the text ends; `center`: its middle. */
  align?: "left" | "right" | "center";
  /** Gray level: 0 black, 1 white. */
  gray?: number;
};

/** One page being drawn. Coordinates from the top-left corner. */
export class PdfPageWriter {
  private readonly operations: string[] = [];

  /** Writes one line of text; `y` is its baseline. */
  text(x: number, y: number, value: string, options: PdfTextOptions = {}) {
    const size = options.size ?? 10;
    const font = options.font ?? "regular";
    const width = textWidth(value, size, font);
    const left =
      options.align === "right"
        ? x - width
        : options.align === "center"
          ? x - width / 2
          : x;
    this.operations.push(
      `BT ${number(options.gray ?? 0)} g /${font === "bold" ? "F2" : "F1"} ${number(size)} Tf ${number(left)} ${number(PDF_PAGE.height - y)} Td ${literal(value)} Tj ET`,
    );
  }

  /** A straight line. */
  line(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    options: { width?: number; gray?: number } = {},
  ) {
    this.operations.push(
      `${number(options.gray ?? 0)} G ${number(options.width ?? 0.5)} w ${number(x1)} ${number(PDF_PAGE.height - y1)} m ${number(x2)} ${number(PDF_PAGE.height - y2)} l S`,
    );
  }

  /** A filled box. */
  box(x: number, y: number, width: number, height: number, gray: number) {
    this.operations.push(
      `${number(gray)} g ${number(x)} ${number(PDF_PAGE.height - y - height)} ${number(width)} ${number(height)} re f`,
    );
  }

  /** The drawing of the page, as its content stream. */
  content(): string {
    return this.operations.join("\n");
  }
}

/** `D:20261010153000Z`, the date format of PDF. */
function pdfDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/**
 * Puts drawn pages together as a PDF file. The content is not compressed:
 * these documents are a few kilobytes, and a file that can be read with
 * a text editor is easier to check.
 */
export function buildPdf(
  pages: readonly PdfPageWriter[],
  info: { title: string; createdAt?: Date },
): Buffer {
  if (pages.length === 0) throw new Error("A PDF needs a page");
  // Objects: 1 catalog, 2 pages, 3 and 4 fonts, 5 info, then for each
  // page its dictionary and its content.
  const objects: string[] = [];
  const pageIds = pages.map((_, index) => 6 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  objects[3] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[4] =
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  objects[5] = `<< /Title ${literal(info.title)} /Producer (Almacen) /CreationDate (${pdfDate(info.createdAt ?? new Date())}) >>`;
  pages.forEach((page, index) => {
    const id = pageIds[index]!;
    const stream = page.content();
    objects[id] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE.width} ${PDF_PAGE.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${id + 1} 0 R >>`;
    // The stream is bytes: every character of it is one byte (latin1).
    objects[id + 1] =
      `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
  });

  // The second line tells readers the file is binary, as the format asks.
  let file = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = Buffer.byteLength(file, "latin1");
    file += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(file, "latin1");
  file += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) {
    file += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  }
  file += `trailer\n<< /Size ${objects.length} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file, "latin1");
}
