// Load test (PIL-06): three companies with 100, 1,000 and 10,000 products,
// their stock and some history, read by 20 people at once. Reports p50/p95
// per screen; the goal is p95 < 500 ms on the common reads.
//
// Runs only against almacen_test (emptied by every `npm test`), with the
// production build serving it:
//   npm run build
//   DATABASE_NAME=almacen_test BETTER_AUTH_URL=http://localhost:3100 \
//     MAIL_DRIVER=memory FILE_STORAGE_DIR=<tmp> npx next start -p 3100
//   npm run load:test            (LOAD_BASE_URL, LOAD_USERS, LOAD_REQUESTS)
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { availableParallelism, totalmem } from "node:os";
import { pathToFileURL } from "node:url";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.DATABASE_NAME = "almacen_test";

// Server code outside Next.js: `server-only` resolves to an empty module,
// as in the worker and the tests.
const serverOnly = pathToFileURL("scripts/server-only-stub.mjs").href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return { url: serverOnly, shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});

const { newId } = await import("@/lib");
const { db } = await import("@/server/db");
const { ensureDefaultLocation } =
  await import("@/platform/locations/bootstrap");
const { hashPassword } = await import("@/platform/auth/password");
const { LEGAL_DOCUMENTS, LEGAL_DOCUMENT_IDS } =
  await import("@/platform/legal/documents");
const { registerEntry, registerExit, registerInitialBalance } =
  await import("@/modules/inventory");
const { chromium } = await import("playwright");

const BASE = process.env.LOAD_BASE_URL ?? "http://localhost:3100";
const USERS = Number(process.env.LOAD_USERS ?? 20);
const REQUESTS = Number(process.env.LOAD_REQUESTS ?? 40);
const SIZES = (process.env.LOAD_SIZES ?? "100,1000,10000")
  .split(",")
  .map(Number);
// LOAD_REUSE=1 reads the companies of a previous run instead of creating them.
const REUSE = process.env.LOAD_REUSE === "1";
/**
 * Three ways of reading, each with its own question:
 * - solo: one person, one read after another — what a screen costs.
 * - real: USERS people, each pausing 1–4 s between reads like at a
 *   counter — the PIL-06 goal is measured here.
 * - stress: USERS people with no pause — how much one server can take.
 */
const MODES = (process.env.LOAD_MODES ?? "solo,real,stress").split(",") as (
  "solo" | "real" | "stress"
)[];
const GOAL_MS = 500;
const PASSWORD = `carga-${newId()}`;
const stamp = Date.now();

const WORDS = ["Tornillo", "Clavo", "Pija", "Taquete", "Cable", "Brocha"];
const SIZES_TEXT = ["1/4", "3/8", "1/2", "2 in", "10 mm", "#8"];
const nameOf = (n: number) =>
  `${WORDS[n % WORDS.length]} ${SIZES_TEXT[n % SIZES_TEXT.length]} modelo ${n}`;

type Company = {
  size: number;
  organizationId: string;
  email: string;
  productIds: string[];
};

/** The company of a previous run, with a new password for its reader. */
async function reuse(size: number): Promise<Company | null> {
  const reader = await db.user.findFirst({
    where: { email: { startsWith: `almacen.carga.${size}.` } },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      memberships: { select: { organizationId: true } },
    },
  });
  const organizationId = reader?.memberships[0]?.organizationId;
  if (!reader || !organizationId) return null;
  await db.account.updateMany({
    where: { userId: reader.id, providerId: "credential" },
    data: { password: await hashPassword(PASSWORD) },
  });
  const products = await db.product.findMany({
    where: { organizationId },
    select: { id: true },
  });
  return {
    size,
    organizationId,
    email: reader.email,
    productIds: products.map((p) => p.id),
  };
}

/** A company with Inventario, a titular and a person of Almacén. */
async function seed(size: number): Promise<Company> {
  const ownerId = newId();
  const organizationId = newId();
  await db.user.create({
    data: {
      id: ownerId,
      name: `Titular carga ${size}`,
      email: `titular.carga.${size}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  await db.$transaction(async (tx) => {
    await tx.organization.create({
      data: {
        id: organizationId,
        name: `Ferretería de ${size.toLocaleString("es-MX")} productos`,
        ownerUserId: ownerId,
        memberships: { create: { id: newId(), userId: ownerId } },
      },
    });
    await ensureDefaultLocation(tx, organizationId);
  });
  for (const grant of [
    { kind: "MODULE" as const, key: "inventory", value: null },
    { kind: "LIMIT" as const, key: "active_products", value: size },
    { kind: "LIMIT" as const, key: "users", value: 5 },
  ]) {
    await db.entitlement.create({
      data: {
        id: newId(),
        organizationId,
        ...grant,
        validFrom: new Date(Date.now() - 60_000),
      },
    });
  }

  // The person who reads: Almacén needs no MFA.
  const userId = newId();
  const email = `almacen.carga.${size}.${stamp}@example.test`;
  await db.user.create({
    data: { id: userId, name: "Almacén de carga", email, emailVerified: true },
  });
  await db.account.create({
    data: {
      id: newId(),
      userId,
      providerId: "credential",
      accountId: userId,
      password: await hashPassword(PASSWORD),
    },
  });
  await db.legalAcceptance.createMany({
    data: LEGAL_DOCUMENT_IDS.map((document) => ({
      id: newId(),
      userId,
      document,
      version: LEGAL_DOCUMENTS[document].version,
    })),
  });
  const membershipId = newId();
  await db.membership.create({
    data: { id: membershipId, organizationId, userId },
  });
  await db.membershipRole.create({
    data: { id: newId(), organizationId, membershipId, role: "warehouse" },
  });

  // Products in bulk (the catalog does not depend on how they were made);
  // stock and history through the real services, so balances reconcile.
  const categories = Array.from({ length: 12 }, (_, i) => ({
    id: newId(),
    organizationId,
    name: `Categoría ${i + 1}`,
  }));
  await db.productCategory.createMany({ data: categories });
  const productIds: string[] = [];
  for (let start = 0; start < size; start += 1_000) {
    const rows = [];
    for (let n = start; n < Math.min(start + 1_000, size); n++) {
      const id = newId();
      productIds.push(id);
      rows.push({
        id,
        organizationId,
        sku: `C${size}-${String(n).padStart(5, "0")}`,
        name: nameOf(n),
        barcode: `750${String(size).padStart(5, "0")}${String(n).padStart(5, "0")}`,
        categoryId: categories[n % categories.length]!.id,
      });
    }
    await db.product.createMany({ data: rows });
  }
  const actor = { organizationId, userId: ownerId };
  const must = async (result: Promise<{ ok: boolean }>) => {
    const done = await result;
    if (!done.ok) throw new Error(JSON.stringify(done));
  };
  let n = 0;
  for (const productId of productIds) {
    await must(
      registerInitialBalance(actor, {
        productId,
        quantity: String(50 + (n % 200)),
      }),
    );
    if (n % 5 === 0) {
      await must(registerEntry(actor, { productId, quantity: "12" }));
    }
    if (n % 10 === 0) {
      await must(registerExit(actor, { productId, quantity: "3" }));
    }
    n++;
  }
  return { size, organizationId, email, productIds };
}

/** Signs in through the real form and returns the session cookie header. */
async function signIn(email: string): Promise<string> {
  const browser = await chromium.launch({
    channel: process.env.UI_BROWSER ?? "chromium",
  });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(`${BASE}/ingresar`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", PASSWORD);
    await page.getByRole("button", { name: "Iniciar sesión" }).click();
    await page.waitForURL("**/inicio", { timeout: 60_000 });
    const cookies = await context.cookies();
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } finally {
    await browser.close();
  }
}

const pick = <T,>(list: T[]) => list[Math.floor(Math.random() * list.length)]!;

/** The common reads of a day of work, with what varies in each. */
function screens(company: Company) {
  const pages = Math.max(1, Math.ceil(company.size / 25));
  return {
    Inicio: () => "/inicio",
    Inventario: () => "/inventario",
    "Inventario, página": () =>
      `/inventario?pagina=${1 + Math.floor(Math.random() * pages)}`,
    "Inventario, búsqueda": () =>
      `/inventario?q=${encodeURIComponent(`${pick(WORDS)} ${pick(SIZES_TEXT)}`)}`,
    "Ficha de producto": () => `/inventario/${pick(company.productIds)}`,
    Movimientos: () => "/movimientos",
    "Movimientos de un producto": () =>
      `/movimientos?producto=${pick(company.productIds)}`,
  };
}

const percentile = (sorted: number[], p: number) =>
  sorted[
    Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)
  ] ?? 0;

async function load(
  company: Company,
  cookie: string,
  mode: "solo" | "real" | "stress",
) {
  const users = mode === "solo" ? 1 : USERS;
  const pause = () =>
    mode === "real"
      ? new Promise((done) => setTimeout(done, 1_000 + Math.random() * 3_000))
      : null;
  const kinds = screens(company);
  const names = Object.keys(kinds) as (keyof typeof kinds)[];
  const times = new Map<string, number[]>(names.map((name) => [name, []]));
  let errors = 0;
  // Warm up: the first render of each screen compiles nothing in
  // production, but fills caches like a real morning would.
  for (const name of names) {
    await fetch(`${BASE}${kinds[name]()}`, { headers: { cookie } });
  }
  const started = performance.now();
  await Promise.all(
    Array.from({ length: users }, async () => {
      for (let i = 0; i < REQUESTS; i++) {
        await pause();
        const name = pick(names);
        const t0 = performance.now();
        const response = await fetch(`${BASE}${kinds[name]()}`, {
          headers: { cookie },
          redirect: "manual",
        });
        await response.arrayBuffer();
        times.get(name)!.push(performance.now() - t0);
        if (response.status !== 200) errors++;
      }
    }),
  );
  const seconds = (performance.now() - started) / 1000;
  const rows = names.map((name) => {
    const sorted = [...times.get(name)!].sort((a, b) => a - b);
    return {
      screen: name,
      requests: sorted.length,
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      max: Math.round(sorted.at(-1) ?? 0),
    };
  });
  return { rows, errors, perSecond: (users * REQUESTS) / seconds };
}

console.log(
  `Servidor ${BASE} · ${USERS} personas a la vez · ${REQUESTS} lecturas cada una · ` +
    `${availableParallelism()} núcleos · ${Math.round(totalmem() / 2 ** 30)} GB de memoria`,
);
let failed = false;
try {
  for (const size of SIZES) {
    const t0 = performance.now();
    const company = (REUSE && (await reuse(size))) || (await seed(size));
    console.log(
      `\n${size.toLocaleString("es-MX")} productos (datos listos en ${Math.round((performance.now() - t0) / 1000)} s)`,
    );
    const cookie = await signIn(company.email);
    for (const mode of MODES) {
      const { rows, errors, perSecond } = await load(company, cookie, mode);
      console.log(
        `\n  ${
          mode === "solo"
            ? "Una persona"
            : mode === "real"
              ? `${USERS} personas con pausas de 1–4 s`
              : `${USERS} personas sin pausa (esfuerzo)`
        }`,
      );
      console.log(
        "Pantalla".padEnd(30) +
          "lecturas".padStart(9) +
          "p50 ms".padStart(8) +
          "p95 ms".padStart(8) +
          "máx ms".padStart(8),
      );
      for (const row of rows) {
        // The goal is for people working (solo and real); stress only says
        // how far one server goes.
        const over = row.p95 >= GOAL_MS && mode !== "stress";
        if (over) failed = true;
        console.log(
          row.screen.padEnd(30) +
            String(row.requests).padStart(9) +
            String(row.p50).padStart(8) +
            String(row.p95).padStart(8) +
            String(row.max).padStart(8) +
            (over ? "  ← sobre la meta" : ""),
        );
      }
      console.log(
        `${Math.round(perSecond)} lecturas por segundo · ${errors} respuestas que no fueron 200`,
      );
      if (errors > 0) failed = true;
    }
  }
} finally {
  await db.$disconnect();
}
console.log(
  failed
    ? `\nAlguna pantalla pasó de ${GOAL_MS} ms en p95 o respondió con error.`
    : `\nTodas las pantallas por debajo de ${GOAL_MS} ms en p95.`,
);
process.exit(failed ? 1 : 0);
