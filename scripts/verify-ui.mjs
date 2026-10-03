// Browser checks for the design system (BAS-12): keyboard focus, dialog
// focus management, touch targets, horizontal overflow and screenshots.
// Usage: start `npm run dev`, then `npm run verify:ui` (uses installed Edge).
import { existsSync, mkdirSync } from "node:fs";
import { chromium } from "playwright";

import { totpCode, totpStep } from "./totp.mjs";

const BASE = process.env.UI_BASE_URL ?? "http://localhost:3000";

// Protected screens need the local demo account (npm run db:seed).
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const DEMO = {
  email: process.env.DEMO_EMAIL ?? "demo@almacen.test",
  password: process.env.DEMO_PASSWORD ?? "",
  // The demo account is a titular: MFA is on (PLT-08B).
  totpSecret: process.env.DEMO_TOTP_SECRET ?? "",
};
if (!DEMO.password || !DEMO.totpSecret) {
  console.error(
    "Falta DEMO_PASSWORD o DEMO_TOTP_SECRET: corre npm run env:setup y npm run db:seed.",
  );
  process.exit(1);
}

/**
 * Browser context without the Next.js dev indicator: it only exists in
 * development and can sit on top of controls (e.g. the mobile header).
 */
async function newContext(browser, options) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    const style = document.createElement("style");
    style.textContent = "nextjs-portal{display:none!important}";
    document.addEventListener("DOMContentLoaded", () =>
      document.head.appendChild(style),
    );
  });
  return context;
}

async function newPage(browser, options) {
  return (await newContext(browser, options)).newPage();
}

/**
 * A fresh MFA code for the demo account. Each code works once, so every
 * sign-in uses a new 30-second step (the current one or the next, both
 * accepted), waiting when both were already used.
 */
let lastStep = 0;
async function nextDemoCode(page) {
  const step = Math.max(totpStep(), lastStep + 1);
  while (step > totpStep() + 1) await page.waitForTimeout(1000);
  lastStep = step;
  return totpCode(DEMO.totpSecret, step);
}

/** Enters the MFA code on /verificar-codigo; false if it must start over. */
async function enterDemoCode(page, target) {
  await page.waitForURL("**/verificar-codigo**", { timeout: 20000 });
  await page.fill("#code", await nextDemoCode(page));
  await page.getByRole("button", { name: "Verificar" }).click();
  const done = page.waitForURL(`**${target}`, { timeout: 20000 });
  const restart = page.getByRole("link", { name: "Volver a iniciar sesión" });
  await Promise.race([done, restart.waitFor({ timeout: 20000 })]);
  return new URL(page.url()).pathname === target;
}

/** New browser context signed in through the real sign-in form + MFA. */
async function signedInPage(browser, viewport, options = {}) {
  const context = await newContext(browser, { viewport, ...options });
  const page = await context.newPage();
  // A run right after another may hit a code used seconds ago: retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.goto(`${BASE}/ingresar`, { waitUntil: "networkidle" });
    await page.fill("#email", DEMO.email);
    await page.fill("#password", DEMO.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    if (await enterDemoCode(page, "/inventario")) return page;
  }
  throw new Error("No se pudo entrar con la cuenta demo.");
}
const OUT = "qa/screenshots";
mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (ok, label) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

const browser = await chromium.launch({
  channel: process.env.UI_BROWSER ?? "msedge",
});
try {
  for (const viewport of [
    { name: "mobile", width: 375, height: 812 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    const page = await newPage(browser, { viewport });
    await page.goto(`${BASE}/sistema-visual`, { waitUntil: "networkidle" });
    await page.waitForTimeout(400); // let the entry animation finish

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    check(
      overflow <= 0,
      `${viewport.name}: no horizontal scroll (${overflow}px)`,
    );

    if (viewport.name === "mobile") {
      const small = await page.$$eval(
        "main button:not([disabled])",
        (buttons) =>
          buttons
            .map((b) => ({
              text: b.textContent?.trim(),
              ...b.getBoundingClientRect().toJSON(),
            }))
            .filter((r) => r.height < 44 || r.width < 44),
      );
      check(
        small.length === 0,
        `mobile: buttons ≥ 44×44 (${JSON.stringify(small)})`,
      );
    }

    // Keyboard: every focus stop shows a visible indicator.
    const missing = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(250); // let the focus-ring transition finish
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        // Skip the body and Next.js dev overlay (not present in production).
        if (!el || el === document.body || el.tagName === "NEXTJS-PORTAL") {
          return null;
        }
        const s = getComputedStyle(el);
        const outline =
          s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
        const ring =
          s.boxShadow !== "none" &&
          s.boxShadow
            .split(/,(?![^(]*\))/)
            .some((layer) => !/rgba\([^)]*,\s*0\)/.test(layer));
        return {
          label:
            el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.id,
          visible: outline || ring,
        };
      });
      if (info && !info.visible) missing.push(info.label);
    }
    check(
      missing.length === 0,
      `${viewport.name}: visible focus on every stop ${JSON.stringify(missing)}`,
    );

    await page.screenshot({
      path: `${OUT}/sistema-visual-${viewport.name}.png`,
      fullPage: true,
    });

    // Dialog: opens from keyboard, traps focus, Escape returns focus to trigger.
    const trigger = page.getByRole("button", { name: "Agregar entrada" });
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Agregar entrada" });
    await dialog.waitFor();
    let inside = true;
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      inside &&= await dialog.evaluate((d) =>
        d.contains(document.activeElement),
      );
    }
    check(inside, `${viewport.name}: focus stays inside the dialog`);
    await page.screenshot({ path: `${OUT}/dialogo-${viewport.name}.png` });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    check(
      await trigger.evaluate((t) => t === document.activeElement),
      `${viewport.name}: Escape closes the dialog and returns focus`,
    );

    // Toast: confirming shows a polite status message.
    await trigger.click();
    await page.getByRole("button", { name: "Confirmar entrada" }).click();
    const toast = page.getByText("Entrada registrada");
    await toast.waitFor({ timeout: 3000 });
    check(
      await toast.isVisible(),
      `${viewport.name}: confirmation toast is shown`,
    );
    await page.close();
  }

  // Application shell (BAS-13): navigation on mobile and desktop.
  const SECTIONS = [
    "/inventario",
    "/movimientos",
    "/ubicaciones",
    "/conteos",
    "/compras",
    "/configuracion",
  ];
  for (const viewport of [
    { name: "mobile", width: 375, height: 812 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    const page = await signedInPage(browser, viewport);
    const mobile = viewport.name === "mobile";

    await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    check(
      new URL(page.url()).pathname === "/inventario",
      `${viewport.name}: / redirects to /inventario`,
    );

    for (const path of SECTIONS) {
      await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      const current = await page
        .locator(`nav a[aria-current="page"][href="${path}"]`)
        .count();
      const visibleNav =
        mobile && !["/compras", "/configuracion"].includes(path);
      check(
        overflow <= 0 && (!mobile || visibleNav ? current > 0 : true),
        `${viewport.name}: ${path} renders without overflow and marks the active link`,
      );
    }
    await page.goto(`${BASE}/inventario`, { waitUntil: "networkidle" });
    await page.screenshot({ path: `${OUT}/shell-${viewport.name}.png` });

    // Skip link is the first focus stop and moves focus to main content.
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Saltar al contenido" });
    check(await skip.isVisible(), `${viewport.name}: skip link appears on Tab`);
    await page.keyboard.press("Enter");
    check(
      await page.evaluate(() => document.activeElement?.id === "contenido"),
      `${viewport.name}: skip link focuses the main content`,
    );

    // Dark mode: the switch toggles the theme, persists and is reversible.
    const toggle = page
      .getByRole("switch", { name: "Modo oscuro" })
      .filter({ visible: true })
      .first();
    await toggle.focus();
    await page.keyboard.press("Space");
    await page.waitForTimeout(300);
    const darkOn =
      (await toggle.getAttribute("aria-checked")) === "true" &&
      (await page.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      ));
    await page.reload({ waitUntil: "networkidle" });
    const persisted = await page.evaluate(() =>
      document.documentElement.classList.contains("dark"),
    );
    const overflowDark = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    await page.screenshot({ path: `${OUT}/shell-dark-${viewport.name}.png` });
    await page
      .getByRole("switch", { name: "Modo oscuro" })
      .filter({ visible: true })
      .first()
      .click();
    await page.waitForTimeout(300);
    const backToLight = await page.evaluate(
      () => !document.documentElement.classList.contains("dark"),
    );
    check(
      darkOn && persisted && overflowDark <= 0 && backToLight,
      `${viewport.name}: dark-mode switch toggles, persists and reverts`,
    );

    if (mobile) {
      await page.getByRole("button", { name: "Más" }).click();
      const sheet = page.getByRole("dialog", { name: "Más opciones" });
      await sheet.waitFor();
      await page.screenshot({ path: `${OUT}/shell-mas-mobile.png` });
      await sheet.getByRole("link", { name: "Compras" }).click();
      await page.waitForURL("**/compras");
      await sheet.waitFor({ state: "hidden" });
      check(true, "mobile: «Más» opens a sheet and navigates to Compras");
      const targets = await page.$$eval(
        "nav[aria-label='Principal'] a, nav[aria-label='Principal'] button",
        (els) =>
          els
            .map((e) => e.getBoundingClientRect())
            // Only visible targets: the desktop sidebar is hidden on mobile.
            .filter((r) => r.height > 0 && (r.height < 44 || r.width < 44))
            .length,
      );
      check(targets === 0, "mobile: bottom navigation targets ≥ 44px");
    } else {
      await page
        .getByRole("navigation", { name: "Principal" })
        .getByRole("link", { name: "Movimientos" })
        .click();
      await page.waitForURL("**/movimientos");
      check(
        (
          await page.locator('aside a[aria-current="page"]').textContent()
        )?.includes("Movimientos") ?? false,
        "desktop: sidebar navigates and updates the active item",
      );
    }
    await page.close();
  }

  // Sign-in and sign-out (PLT-04).
  {
    const context = await newContext(browser, {
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/movimientos`, { waitUntil: "networkidle" });
    const redirected = new URL(page.url());
    check(
      redirected.pathname === "/ingresar" &&
        redirected.searchParams.get("siguiente") === "/movimientos",
      "signed out: protected screen redirects to /ingresar?siguiente=…",
    );
    await page.fill("#email", DEMO.email);
    await page.fill("#password", "contraseña-incorrecta");
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.getByText("Correo o contraseña incorrectos.").waitFor();
    check(
      (await page.evaluate(() => document.activeElement?.id)) === "password" &&
        (await page.inputValue("#password")) === "",
      "wrong password: neutral error, password cleared and focused",
    );
    await page.screenshot({ path: `${OUT}/ingresar-error-mobile.png` });
    await page.fill("#password", DEMO.password);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();

    // MFA challenge (PLT-08B): no session until the code is confirmed.
    await page.waitForURL("**/verificar-codigo**", { timeout: 20000 });
    const noSessionYet = (await context.cookies()).every(
      (c) => !c.name.includes("session_token"),
    );
    await page.fill("#code", "12345");
    await page.getByRole("button", { name: "Verificar" }).click();
    await page.locator("#code-error").waitFor();
    const codeFocused =
      (await page.evaluate(() => document.activeElement?.id)) === "code";
    await page.screenshot({ path: `${OUT}/verificar-codigo-mobile.png` });
    check(
      noSessionYet && codeFocused,
      "MFA: password alone opens no session; an invalid code is refused in place",
    );
    await page.fill("#code", await nextDemoCode(page));
    await page.getByRole("button", { name: "Verificar" }).click();
    await page.waitForURL("**/movimientos", { timeout: 20000 });
    check(true, "sign-in with MFA returns to the requested screen");
    const cookie = (await context.cookies()).find((c) =>
      c.name.includes("session_token"),
    );
    check(
      cookie?.httpOnly === true && cookie.sameSite === "Lax",
      "session cookie is HttpOnly and SameSite=Lax",
    );
    await page.goto(`${BASE}/ingresar`, { waitUntil: "networkidle" });
    check(
      new URL(page.url()).pathname === "/inventario",
      "signed in: /ingresar goes straight to the app",
    );
    await page.getByRole("button", { name: "Más" }).click();
    await page.getByRole("button", { name: "Cerrar sesión" }).click();
    await page.waitForURL("**/ingresar", { timeout: 20000 });
    await page.goto(`${BASE}/inventario`, { waitUntil: "networkidle" });
    check(
      new URL(page.url()).pathname === "/ingresar",
      "sign-out ends the session (protected screen redirects again)",
    );
    await context.close();
  }

  // Active sessions (PLT-05): close the others, then one device ends
  // another's session and that device is signed out immediately.
  {
    const ANDROID =
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36";
    const a = await signedInPage(browser, { width: 1280, height: 800 });
    await a.goto(`${BASE}/configuracion`, { waitUntil: "networkidle" });
    const closeOthers = a.getByRole("button", { name: "Cerrar las demás" });
    if (await closeOthers.count()) {
      await closeOthers.click();
      await a.getByRole("button", { name: "Cerrar sesiones" }).click();
      await a
        .getByText(/Se cerr(ó|aron)/)
        .first()
        .waitFor();
    }
    const rows = a.locator("section ul > li");
    await a.reload({ waitUntil: "networkidle" });
    check(
      (await rows.count()) === 1,
      "sessions: «Cerrar las demás» leaves only this session",
    );

    const b = await signedInPage(
      browser,
      { width: 375, height: 812 },
      { userAgent: ANDROID },
    );
    await b.goto(`${BASE}/configuracion`, { waitUntil: "networkidle" });
    const mobileOverflow = await b.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    await b.screenshot({ path: `${OUT}/sesiones-mobile.png` });
    await a.reload({ waitUntil: "networkidle" });
    check(
      (await rows.count()) === 2 && mobileOverflow <= 0,
      "sessions: the new device appears; no overflow on mobile",
    );
    await a.screenshot({ path: `${OUT}/sesiones-desktop.png` });
    await a
      .getByRole("button", { name: "Cerrar sesión en Chrome en Android" })
      .click();
    await a.getByText("Sesión cerrada en ese dispositivo.").waitFor();
    await b.goto(`${BASE}/movimientos`, { waitUntil: "networkidle" });
    check(
      new URL(b.url()).pathname === "/ingresar",
      "sessions: the revoked device is signed out immediately",
    );
    await a.context().close();
    await b.context().close();
  }

  // MFA status (PLT-08A/B, PLT-09): the demo titular has MFA on and
  // required; its backup codes are replaced on every run.
  // Enrollment itself is covered by tests/platform/mfa.int.test.ts, since
  // these checks never create accounts.
  {
    const page = await signedInPage(browser, { width: 375, height: 812 });
    await page.goto(`${BASE}/configuracion`, { waitUntil: "networkidle" });
    const panel = page.locator("div", { hasText: "Verificación en dos pasos" });
    check(
      (await page.getByText("Activada", { exact: true }).isVisible()) &&
        (await panel
          .getByText("Es obligatoria para titulares y administradores.")
          .first()
          .isVisible()) &&
        (await page.getByRole("button", { name: "Activar" }).count()) === 0,
      "MFA: Configuración shows it on and required for the titular",
    );
    check(
      (await page.getByRole("button", { name: "Desactivar" }).count()) === 0,
      "MFA: a titular gets no «Desactivar» (PLT-09)",
    );

    // Backup codes (PLT-09): new codes after the password, shown once.
    await page.getByRole("button", { name: "Generar nuevos" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.locator("#codes-password").fill(DEMO.password);
    await dialog.getByRole("button", { name: "Generar códigos" }).click();
    const list = dialog.getByRole("list", { name: "Códigos de recuperación" });
    await list.waitFor();
    const codes = (await list.getByRole("listitem").allTextContents()).map(
      (c) => c.trim(),
    );
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    await page.screenshot({ path: `${OUT}/codigos-recuperacion-mobile.png` });
    check(
      codes.length === 10 &&
        codes.every((c) => /^[a-z2-9]{5}-[a-z2-9]{5}$/.test(c)) &&
        overflow <= 0,
      "MFA: «Generar nuevos» shows 10 backup codes without overflow",
    );
    await dialog.getByRole("button", { name: "Listo" }).click();
    await page.getByText("Te quedan 10 códigos").waitFor();

    // Sign in on another device with a backup code instead of the app.
    const other = await newContext(browser, {
      viewport: { width: 1280, height: 800 },
    });
    const second = await other.newPage();
    await second.goto(`${BASE}/ingresar`, { waitUntil: "networkidle" });
    await second.fill("#email", DEMO.email);
    await second.fill("#password", DEMO.password);
    await second.getByRole("button", { name: "Iniciar sesión" }).click();
    await second.waitForURL("**/verificar-codigo**", { timeout: 20000 });
    await second
      .getByRole("button", { name: /Usa un código de recuperación/ })
      .click();
    await second.fill("#code", codes[0].toUpperCase().replace("-", " "));
    await second.waitForTimeout(1500); // let the door animation finish
    await second.screenshot({ path: `${OUT}/verificar-respaldo-desktop.png` });
    await second.getByRole("button", { name: "Verificar" }).click();
    await second.waitForURL("**/inventario", { timeout: 20000 });
    check(true, "MFA: signing in with a backup code works (typed loosely)");
    await other.close();

    await page.reload({ waitUntil: "networkidle" });
    check(
      await page.getByText("Te quedan 9 códigos").isVisible(),
      "MFA: a used backup code is gone",
    );
    await page.screenshot({
      path: `${OUT}/seguridad-mobile.png`,
      fullPage: true,
    });

    // Company creation (PLT-10): only for accounts without a company.
    await page.goto(`${BASE}/crear-empresa`, { waitUntil: "networkidle" });
    check(
      new URL(page.url()).pathname === "/inventario",
      "company: an account with a company skips /crear-empresa",
    );
    // Active company (PLT-11): shown in «Más» on mobile.
    await page.getByRole("button", { name: "Más" }).click();
    const sheet = page.getByRole("dialog", { name: "Más opciones" });
    check(
      await sheet.getByText("Ferretería Demo").isVisible(),
      "company: the active company is shown in the menu",
    );
    await page.keyboard.press("Escape");
    const anonymous = await newContext(browser, {
      viewport: { width: 375, height: 812 },
    });
    const visitor = await anonymous.newPage();
    await visitor.goto(`${BASE}/crear-empresa`, { waitUntil: "networkidle" });
    check(
      new URL(visitor.url()).pathname === "/ingresar",
      "company: /crear-empresa needs a session",
    );
    await anonymous.close();

    await page.goto(`${BASE}/activa-dos-pasos`, { waitUntil: "networkidle" });
    check(
      new URL(page.url()).pathname === "/inventario",
      "MFA: the mandatory setup screen sends accounts with MFA to the app",
    );
    await page.context().close();
  }

  // Attempt limits (PLT-06): an unknown email from a test IP is blocked
  // after 5 failures with the same message an existing account would get.
  // (Never the demo account or the local IP, so local work is not blocked.)
  {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
    const context = await newContext(browser, {
      viewport: { width: 375, height: 812 },
      extraHTTPHeaders: { "x-forwarded-for": ip },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/ingresar`, { waitUntil: "networkidle" });
    const ghost = `fantasma.${Date.now()}@example.test`;
    for (let i = 0; i < 6; i++) {
      await page.fill("#email", ghost);
      await page.fill("#password", "contraseña-incorrecta");
      await page.getByRole("button", { name: "Iniciar sesión" }).click();
      // Wait until the submission finished (button label returns).
      await page.getByRole("button", { name: "Entrando…" }).waitFor();
      await page.getByRole("button", { name: "Iniciar sesión" }).waitFor();
    }
    const message =
      (await page.locator("main [role=alert]").textContent()) ?? "";
    await page.screenshot({ path: `${OUT}/ingresar-bloqueo-mobile.png` });
    check(
      /Demasiados intentos\. Espera 15 minutos/.test(message),
      "attempt limit: 6th try is blocked with a neutral message",
    );
    await context.close();
  }

  // Password recovery (PLT-07): link from sign-in, neutral answer for an
  // unknown email (test IP), invalid and made-up links. No account changes.
  for (const viewport of [
    { name: "mobile", width: 375, height: 812 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    const ip = `203.0.113.${Math.floor(Math.random() * 200) + 20}`;
    const context = await newContext(browser, {
      viewport,
      extraHTTPHeaders: { "x-forwarded-for": ip },
    });
    const page = await context.newPage();
    await page.goto(`${BASE}/ingresar`, { waitUntil: "networkidle" });
    const forgot = page.getByRole("link", {
      name: "¿Olvidaste tu contraseña?",
    });
    const forgotHeight = (await forgot.boundingBox())?.height ?? 0;
    await forgot.click();
    await page.waitForURL("**/recuperar-contrasena");
    check(
      viewport.name === "desktop" || forgotHeight >= 44,
      `${viewport.name}: «¿Olvidaste tu contraseña?» leads to recovery (≥ 44px on mobile)`,
    );

    await page.fill("#email", `fantasma.${Date.now()}@example.test`);
    await page.getByRole("button", { name: "Enviar enlace" }).click();
    const sent = page.getByRole("status");
    await sent.waitFor();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    );
    await page.screenshot({ path: `${OUT}/recuperar-${viewport.name}.png` });
    check(
      /Si hay una cuenta con ese correo/.test(
        (await sent.textContent()) ?? "",
      ) && overflow <= 0,
      `${viewport.name}: recovery answers neutrally without overflow`,
    );

    await page.goto(`${BASE}/restablecer-contrasena?error=INVALID_TOKEN`, {
      waitUntil: "networkidle",
    });
    check(
      (await page
        .getByRole("heading", { name: "El enlace no es válido" })
        .isVisible()) &&
        (await page
          .getByRole("link", { name: "Pedir un enlace nuevo" })
          .isVisible()),
      `${viewport.name}: an invalid link offers a new one`,
    );

    await page.goto(`${BASE}/restablecer-contrasena?token=inventado`, {
      waitUntil: "networkidle",
    });
    await page.fill("#password", "corta");
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await page.locator("#password-error").waitFor();
    const focused = await page.evaluate(() => document.activeElement?.id);
    const referrer = await page.getAttribute("meta[name=referrer]", "content");
    await page.screenshot({
      path: `${OUT}/restablecer-${viewport.name}.png`,
    });
    check(
      focused === "password" && referrer === "no-referrer",
      `${viewport.name}: reset form shows the password error and hides the token from referrers`,
    );
    await page.fill("#password", "una-contrasena-nueva-y-larga");
    await page.getByRole("button", { name: "Guardar contraseña" }).click();
    await page
      .getByRole("heading", { name: "El enlace no es válido" })
      .waitFor();
    check(true, `${viewport.name}: a made-up token is refused`);
    await context.close();
  }

  // Security headers (PLT-16): no framing, no sniffing, no full referrer.
  {
    const context = await newContext(browser, {});
    const response = await context.request.get(`${BASE}/ingresar`);
    const headers = response.headers();
    check(
      /frame-ancestors 'none'/.test(headers["content-security-policy"] ?? "") &&
        headers["x-frame-options"] === "DENY" &&
        headers["x-content-type-options"] === "nosniff" &&
        headers["referrer-policy"] === "strict-origin-when-cross-origin" &&
        !("x-powered-by" in headers),
      "security headers: no framing, nosniff, referrer policy, no X-Powered-By",
    );
    await context.close();
  }

  // Registration form (PLT-02): invalid submit, inline errors and focus.
  // Only the invalid path runs here so no accounts are created.
  for (const viewport of [
    { name: "mobile", width: 375, height: 812 },
    { name: "desktop", width: 1280, height: 800 },
  ]) {
    const page = await newPage(browser, { viewport });
    await page.goto(`${BASE}/registro`, { waitUntil: "networkidle" });
    await page.fill("#name", "A");
    await page.fill("#email", "no-es-correo");
    await page.fill("#password", "corta");
    await page.getByRole("button", { name: "Crear cuenta" }).click();
    await page.getByText("Escribe tu nombre").waitFor();
    const errors = await page.locator("[id$='-error']").count();
    const focused = await page.evaluate(() => document.activeElement?.id);
    const described = await page.getAttribute("#password", "aria-describedby");
    const kept = await page.inputValue("#email");
    const cleared = (await page.inputValue("#password")) === "";
    check(
      errors === 3 &&
        focused === "name" &&
        described?.includes("password-error") === true &&
        kept === "no-es-correo" &&
        cleared,
      `${viewport.name}: registration shows inline errors and focuses the first`,
    );
    await page.getByRole("button", { name: "Mostrar contraseña" }).click();
    check(
      (await page.getAttribute("#password", "type")) === "text",
      `${viewport.name}: password visibility toggle works`,
    );
    await page.close();
  }
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} UI check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll UI checks passed. Screenshots in ${OUT}/`);
