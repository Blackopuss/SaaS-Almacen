// Browser checks for the design system (BAS-12): keyboard focus, dialog
// focus management, touch targets, horizontal overflow and screenshots.
// Usage: start `npm run dev`, then `npm run verify:ui` (uses installed Edge).
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = process.env.UI_BASE_URL ?? "http://localhost:3000";
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
    const page = await browser.newPage({ viewport });
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
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} UI check(s) failed.`);
  process.exit(1);
}
console.log(`\nAll UI checks passed. Screenshots in ${OUT}/`);
