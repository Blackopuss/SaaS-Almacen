// Company for manual browser checks WITHOUT touching development data:
// creates, in almacen_test, a company with Inventario + Compras and an
// account with the role you ask for (no MFA needed unless administrator).
// The test database is emptied by every `npm test`, so nothing has to be
// cleaned afterwards — important now that several tables are append-only.
//
// Usage (with `npm run dev:test` running on http://localhost:3100):
//   npm run test:company -- "<contraseña de 12+ caracteres>" [warehouse|buyer|viewer|administrator]
// Prints the email to sign in with.
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
process.env.DATABASE_NAME = "almacen_test";

const { newId } = await import("@/lib");
const { db } = await import("@/server/db");
const { hashPassword } = await import("@/platform/auth/password");

const password = process.argv[2];
if (!password || password.length < 12) {
  console.error(
    'Uso: npm run test:company -- "<contraseña de 12+ caracteres>" [rol]',
  );
  process.exit(1);
}
const stamp = Date.now();
const ownerId = newId();
await db.user.create({
  data: {
    id: ownerId,
    name: "Titular de prueba",
    email: `titular.navegador.${stamp}@example.test`,
    emailVerified: true,
  },
});
const organizationId = newId();
await db.organization.create({
  data: {
    id: organizationId,
    name: "Ferretería de navegador",
    ownerUserId: ownerId,
    memberships: { create: { id: newId(), userId: ownerId } },
  },
});
const userId = newId();
const email = `persona.navegador.${stamp}@example.test`;
await db.user.create({
  data: { id: userId, name: "Persona de prueba", email, emailVerified: true },
});
await db.account.create({
  data: {
    id: newId(),
    userId,
    providerId: "credential",
    accountId: userId,
    password: await hashPassword(password),
  },
});
const membershipId = newId();
await db.membership.create({
  data: { id: membershipId, organizationId, userId },
});
await db.membershipRole.create({
  data: {
    id: newId(),
    organizationId,
    membershipId,
    role: process.argv[3] ?? "warehouse",
  },
});
for (const grant of [
  { kind: "MODULE" as const, key: "inventory", value: null },
  { kind: "MODULE" as const, key: "purchasing", value: null },
  { kind: "LIMIT" as const, key: "active_products", value: 100 },
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
console.log(email);
await db.$disconnect();
