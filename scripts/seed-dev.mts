// Development data (PLT-04): a verified demo account that owns a demo
// organization, so the app can be used and checked locally.
// Usage: npm run db:seed   (idempotent; refuses to run outside *_dev)
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const database = process.env.DATABASE_NAME ?? "";
if (process.env.NODE_ENV === "production" || !database.endsWith("_dev")) {
  console.error(
    `db:seed solo corre en una base *_dev (actual: "${database}").`,
  );
  process.exit(1);
}

const email = (process.env.DEMO_EMAIL ?? "demo@almacen.test").toLowerCase();
const password = process.env.DEMO_PASSWORD;
if (!password) {
  console.error("Falta DEMO_PASSWORD en .env.local (npm run env:setup).");
  process.exit(1);
}

// Imported after the environment is loaded.
const { newId } = await import("@/lib");
const { hashPassword } = await import("@/platform/auth/password");
const { db } = await import("@/server/db");

const hash = await hashPassword(password);
const now = new Date();

const user = await db.user.upsert({
  where: { email },
  update: { emailVerified: true, name: "Demo Almacén" },
  create: { id: newId(), email, name: "Demo Almacén", emailVerified: true },
});

const credential = await db.account.findFirst({
  where: { userId: user.id, providerId: "credential" },
});
if (credential) {
  await db.account.update({
    where: { id: credential.id },
    data: { password: hash, updatedAt: now },
  });
} else {
  await db.account.create({
    data: {
      id: newId(),
      userId: user.id,
      providerId: "credential",
      accountId: user.id,
      password: hash,
    },
  });
}

const existing = await db.organization.findFirst({
  where: { ownerUserId: user.id, name: "Ferretería Demo" },
});
if (!existing) {
  await db.organization.create({
    data: {
      id: newId(),
      name: "Ferretería Demo",
      ownerUserId: user.id,
      memberships: { create: { id: newId(), userId: user.id } },
    },
  });
}

console.log(
  `Cuenta demo lista: ${email} (contraseña en .env.local → DEMO_PASSWORD)`,
);
await db.$disconnect();
