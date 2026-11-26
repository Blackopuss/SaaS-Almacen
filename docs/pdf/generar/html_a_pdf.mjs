// Convierte el HTML de arquitectura_html.py en PDF con el Chromium de Playwright.
// Uso: node docs/pdf/generar/html_a_pdf.mjs <entrada.html> <salida.pdf>
import { resolve } from "node:path";
import { chromium } from "playwright";

const [input, output] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(`file://${resolve(input)}`);
await page.pdf({
  path: output,
  format: "Letter",
  printBackground: true,
  displayHeaderFooter: true,
  headerTemplate: "<span></span>",
  footerTemplate:
    '<div style="font-size:8px;color:#71717A;width:100%;padding:0 16mm;display:flex;justify-content:space-between;font-family:Arial"><span>SaaS Almacén · Arquitectura y código</span><span>Página <span class="pageNumber"></span> de <span class="totalPages"></span></span></div>',
  margin: { top: "16mm", bottom: "18mm", left: "16mm", right: "16mm" },
});
await browser.close();
