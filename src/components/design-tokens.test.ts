import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// WCAG 2.2 contrast checks for the design tokens in globals.css (BAS-12).
const css = readFileSync(
  path.join(process.cwd(), "src/app/globals.css"),
  "utf8",
);

function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`Missing ${selector} block`);
  const block = css.slice(start, css.indexOf("}", start));
  const result: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(
    /--([\w-]+):\s*(#[0-9a-f]{6});/gi,
  )) {
    result[name!] = value!.toLowerCase();
  }
  return result;
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const [r, g, b] = channels.map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  ) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
    number,
    number,
  ];
  return (hi + 0.05) / (lo + 0.05);
}

// [foreground, background, minimum ratio]
const TEXT = 4.5;
const UI = 3; // focus rings, input borders, icons (WCAG 1.4.11)
const pairs: [string, string, number][] = [
  ["foreground", "background", TEXT],
  ["card-foreground", "card", TEXT],
  ["popover-foreground", "popover", TEXT],
  ["muted-foreground", "background", TEXT],
  ["muted-foreground", "muted", TEXT],
  ["muted-foreground", "card", TEXT],
  ["secondary-foreground", "secondary", TEXT],
  ["accent-foreground", "accent", TEXT],
  ["primary-foreground", "primary", TEXT],
  ["primary-foreground", "primary-hover", TEXT],
  ["primary", "background", TEXT], // links
  ["primary", "card", TEXT],
  ["destructive-foreground", "destructive", TEXT],
  ["destructive", "card", TEXT], // field error messages
  ["success-foreground", "success", TEXT],
  ["success", "card", TEXT],
  ["warning-foreground", "warning", TEXT],
  ["warning", "card", TEXT],
  ["ring", "background", UI],
  ["ring", "card", UI],
  ["input", "card", UI],
  ["input", "background", UI],
];

for (const theme of [":root", ".dark"]) {
  describe(`contrast in ${theme}`, () => {
    const t = tokens(theme);
    it.each(pairs)("%s on %s ≥ %d:1", (fg, bg, min) => {
      expect(t[fg], `missing --${fg}`).toBeDefined();
      expect(t[bg], `missing --${bg}`).toBeDefined();
      expect(contrast(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(min);
    });
  });
}
