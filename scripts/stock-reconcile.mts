// Reconciliation task (INV-34): compares the balance of every product in
// every location with its movement history, company by company, and
// reports where they differ. It only reads. Exit code 1 when there is any
// difference, so a scheduler or a monitor can alert on it.
//
// Usage:
//   npm run stock:reconcile                 (database of .env.local)
//   DATABASE_NAME=almacen_test npm run stock:reconcile
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const { db } = await import("@/server/db");
const { reconcileCompany } = await import("@/modules/inventory/reconciliation");

let companies = 0;
let pairs = 0;
let differences = 0;
let after: string | undefined;
try {
  // Companies in pages, so the task does not grow with the customer list.
  for (;;) {
    const page: { id: string; name: string }[] = await db.organization.findMany(
      {
        orderBy: { id: "asc" },
        take: 200,
        ...(after ? { cursor: { id: after }, skip: 1 } : {}),
        select: { id: true, name: true },
      },
    );
    if (page.length === 0) break;
    after = page[page.length - 1]!.id;
    for (const organization of page) {
      const report = await reconcileCompany(organization.id);
      companies++;
      pairs += report.pairs;
      differences += report.drift.length;
      for (const row of report.drift) {
        console.log(
          `DIFERENCIA  empresa=${organization.id} (${organization.name})  ` +
            `producto=${row.sku} (${row.productName})  ubicación=${row.locationName}  ` +
            `saldo=${row.balance}  historial=${row.fromMovements}  diferencia=${row.difference}`,
        );
      }
    }
  }
} finally {
  await db.$disconnect();
}

console.log(
  `Reconciliación: ${companies} empresa(s), ${pairs} saldo(s) revisados, ${differences} diferencia(s).`,
);
if (differences > 0) {
  console.log(
    "Hay saldos que no coinciden con su historial. No se corrigió nada: investiga cada caso antes de ajustar.",
  );
  process.exit(1);
}
