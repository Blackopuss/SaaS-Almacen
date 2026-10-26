// Accessibility, small screens and error messages of the main flows (PIL-07).
// Needs `npm run dev` (or `next start`) running and the demo account
// (`npm run db:seed`). Usage: npm run verify:a11y
//   UI_BASE_URL   other address (default http://localhost:3000)
//   UI_BROWSER    browser channel (default msedge; "chromium" for the bundled one)
//
// For every screen, in a phone and a desktop: axe-core (WCAG 2.1 A/AA) with
// no serious or critical violations, no horizontal overflow, every keyboard
// stop with a visible focus indicator and touch targets of at least 44 px on
// the phone. For the main forms: sending them empty moves the focus to the
// first error, which says what is wrong and is linked to its field.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

import { chromium } from "playwright";

import { totpCode, totpStep } from "./totp.mjs";

process.loadEnvFile?.(".env.local");
const BASE = process.env.UI_BASE_URL ?? "http://localhost:3000";
const DEMO = {
  email: process.env.DEMO_EMAIL ?? "demo@almacen.test",
  password: process.env.DEMO_PASSWORD ?? "",
  totpSecret: process.env.DEMO_TOTP_SECRET ?? "",
};
if (!DEMO.password || !DEMO.totpSecret) {
  console.error(
    "Falta DEMO_PASSWORD o DEMO_TOTP_SECRET: corre npm run env:setup y npm run db:seed.",
  );
  process.exit(1);
}
const AXE = readFileSync(
  createRequire(import.meta.url).resolve("axe-core/axe.min.js"),
  "utf8",
);

/** Screens of the app, in the order a new person meets them. */
const SCREENS = [
  "/inicio",
  "/inventario",
  "/inventario/nuevo",
  "/movimientos",
  "/movimientos/entrada",
  "/movimientos/salida-rapida",
  "/inventario/importar",
  "/inventario/exportar",
  "/conteos",
  "/compras",
  "/compras/proveedores",
  "/compras/ordenes/nueva",
  "/configuracion",
  "/ubicaciones",
  "/configuracion/equipo",
  "/configuracion/plan",
];
/** Screens before signing in. */
const PUBLIC = ["/ingresar", "/registro", "/recuperar-contrasena"];

/** Forms sent empty: the focus must land on a described, invalid field. */
const FORMS = [
  { path: "/inventario/nuevo", submit: "Guardar producto" },
  { path: "/compras/proveedores/nuevo", submit: "Guardar proveedor" },
  { path: "/ingresar", submit: "Iniciar sesión", signedOut: true },
];

let failures = 0;
const check = (ok, label, detail = "") => {
  if (!ok) failures++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${!ok && detail ? `\n      ${detail}` : ""}`,
  );
};

const browser = await chromium.launch({
  channel: process.env.UI_BROWSER ?? "msedge",
});

async function signedIn(viewport) {
  const context = await browser.newContext({
    viewport,
    isMobile: viewport.width < 600,
    hasTouch: viewport.width < 600,
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/ingresar`, { waitUntil: "networkidle" });
  await page.fill("#email", DEMO.email);
  await page.fill("#password", DEMO.password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await page.waitForURL("**/verificar-codigo**", { timeout: 30000 });
  // A code used seconds ago is refused: take the next step's.
  await page.fill("#code", totpCode(DEMO.totpSecret, totpStep() + 1));
  await page.getByRole("button", { name: "Verificar" }).click();
  await page.waitForURL(/\/(inicio|acepta-terminos)/, { timeout: 60000 });
  return page;
}

/** axe-core on the current page: serious and critical violations. */
async function axe(page) {
  await page.addScriptTag({ content: AXE });
  return page.evaluate(async () => {
    const result = await window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"],
      },
      // The development indicator of Next is not part of the app.
      exclude: [["nextjs-portal"]],
    });
    return result.violations
      .filter((v) => v.impact === "serious" || v.impact === "critical")
      .map(
        (v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target.join(" ")}`,
      );
  });
}

/**
 * Walks the page with Tab: every stop must show a focus indicator (outline
 * or ring) and be on screen. Returns the stops that fail.
 */
async function keyboard(page, stops = 40) {
  await page.evaluate(() => document.activeElement?.blur());
  const bad = [];
  const seen = new Set();
  for (let i = 0; i < stops; i++) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const ring =
        (style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0) ||
        (style.boxShadow && style.boxShadow !== "none");
      const name =
        el.getAttribute("aria-label") ||
        el.textContent?.trim().slice(0, 40) ||
        el.getAttribute("name") ||
        el.tagName.toLowerCase();
      return {
        key: `${el.tagName}|${name}|${Math.round(rect.top)}`,
        name,
        ring: Boolean(ring),
        visible: rect.width > 0 && rect.height > 0,
      };
    });
    if (!stop || seen.has(stop.key)) break;
    seen.add(stop.key);
    if (!stop.ring || !stop.visible) bad.push(stop.name);
  }
  return bad;
}

/** Visible interactive elements smaller than 44 px (phone only). */
async function smallTargets(page) {
  return page.evaluate(() =>
    [
      ...document.querySelectorAll(
        "main a, main button, main input, main select, nav a, nav button",
      ),
    ]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (
          el.closest("p, li, td, dd") &&
          el.tagName === "A" &&
          r.height >= 20
        ) {
          // A link inside a sentence is a text link: WCAG 2.5.8 exception.
          return false;
        }
        if (el.type === "radio" || el.type === "checkbox") return false;
        return r.height < 44;
      })
      .map(
        (el) =>
          el.getAttribute("aria-label") ||
          el.textContent?.trim().slice(0, 30) ||
          el.tagName,
      ),
  );
}

const overflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

try {
  for (const viewport of [
    { name: "móvil", width: 375, height: 812 },
    { name: "escritorio", width: 1280, height: 800 },
  ]) {
    const mobile = viewport.width < 600;

    // Before signing in.
    {
      const context = await browser.newContext({
        viewport,
        isMobile: mobile,
        hasTouch: mobile,
      });
      const page = await context.newPage();
      for (const path of PUBLIC) {
        await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
        const violations = await axe(page);
        check(
          violations.length === 0,
          `${viewport.name}: ${path} sin fallas graves de accesibilidad`,
          violations.join("; "),
        );
        check(
          (await overflow(page)) <= 0,
          `${viewport.name}: ${path} sin desbordamiento`,
        );
        const bad = await keyboard(page);
        check(
          bad.length === 0,
          `${viewport.name}: ${path} foco visible con teclado`,
          bad.join(", "),
        );
      }
      await context.close();
    }

    const page = await signedIn(viewport);
    for (const path of SCREENS) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const violations = await axe(page);
      check(
        violations.length === 0,
        `${viewport.name}: ${path} sin fallas graves de accesibilidad`,
        violations.join("; "),
      );
      check(
        (await overflow(page)) <= 0,
        `${viewport.name}: ${path} sin desbordamiento`,
      );
      const bad = await keyboard(page);
      check(
        bad.length === 0,
        `${viewport.name}: ${path} foco visible con teclado`,
        bad.join(", "),
      );
      if (mobile) {
        const small = await smallTargets(page);
        check(
          small.length === 0,
          `${viewport.name}: ${path} objetivos táctiles ≥ 44 px`,
          small.join(", "),
        );
      }
    }

    // The detail screens of what exists: the first product, order and count.
    for (const [list, pattern] of [
      ["/inventario", /^\/inventario\/[0-9a-f-]{36}$/],
      ["/compras", /^\/compras\/ordenes\/[0-9a-f-]{36}$/],
      ["/conteos", /^\/conteos\/[0-9a-f-]{36}$/],
    ]) {
      await page.goto(`${BASE}${list}`, { waitUntil: "networkidle" });
      const hrefs = await page.$$eval("main a", (links) =>
        links.map((a) => a.getAttribute("href") ?? ""),
      );
      const detail = hrefs.find((href) => pattern.test(href));
      if (!detail) continue;
      await page.goto(`${BASE}${detail}`, { waitUntil: "networkidle" });
      const violations = await axe(page);
      check(
        violations.length === 0,
        `${viewport.name}: detalle de ${list} sin fallas graves de accesibilidad`,
        violations.join("; "),
      );
      check(
        (await overflow(page)) <= 0,
        `${viewport.name}: detalle de ${list} sin desbordamiento`,
      );
      const bad = await keyboard(page);
      check(
        bad.length === 0,
        `${viewport.name}: detalle de ${list} foco visible con teclado`,
        bad.join(", "),
      );
      if (mobile) {
        const small = await smallTargets(page);
        check(
          small.length === 0,
          `${viewport.name}: detalle de ${list} objetivos táctiles ≥ 44 px`,
          small.join(", "),
        );
      }
    }

    // Forms sent empty: the error is said, linked and focused.
    for (const form of FORMS) {
      const target = form.signedOut
        ? await (await browser.newContext({ viewport })).newPage()
        : page;
      await target.goto(`${BASE}${form.path}`, { waitUntil: "networkidle" });
      await target.getByRole("button", { name: form.submit }).click();
      await target.waitForTimeout(1500);
      const focused = await target.evaluate(() => {
        const el = document.activeElement;
        const ids = (el?.getAttribute("aria-describedby") ?? "")
          .split(" ")
          .filter(Boolean);
        const said = ids
          .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ");
        const alert =
          document.querySelector('[role="alert"]')?.textContent?.trim() ?? "";
        return {
          invalid: el?.getAttribute("aria-invalid") === "true",
          said,
          alert,
          // The browser's own check (required): it focuses and announces.
          native:
            el instanceof HTMLInputElement &&
            !el.validity.valid &&
            el.validationMessage.length > 0,
        };
      });
      check(
        (focused.invalid && focused.said.length > 0) ||
          focused.alert.length > 0 ||
          focused.native,
        `${viewport.name}: ${form.path} vacío lleva el foco al error y lo explica`,
        JSON.stringify(focused),
      );
      if (form.signedOut) await target.context().close();
    }
    await page.context().close();
  }
} finally {
  await browser.close();
}

console.log(
  failures === 0 ? "\nTodo pasó." : `\n${failures} comprobaciones fallaron.`,
);
process.exit(failures === 0 ? 0 : 1);
