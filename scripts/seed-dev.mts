// Development data (PLT-04): a verified demo account that owns a demo
// organization, so the app can be used and checked locally. As a titular it
// must use MFA (PLT-08B): it gets the TOTP secret from DEMO_TOTP_SECRET
// (`npm run demo:codigo` prints the current code).
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

const totpSecret = process.env.DEMO_TOTP_SECRET;
if (!totpSecret) {
  console.error("Falta DEMO_TOTP_SECRET en .env.local (npm run env:setup).");
  process.exit(1);
}

// Imported after the environment is loaded.
const { newId } = await import("@/lib");
const { hashPassword } = await import("@/platform/auth/password");
const { db } = await import("@/server/db");
const { symmetricEncrypt } = await import("better-auth/crypto");
const { generateBackupCodes } = await import("@/platform/auth/backup-codes");
const { base32 } = await import("./totp.mjs");

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

// MFA with the known secret, encrypted like Better Auth does. Backup codes
// are random: generate new ones in Configuración to see them.
const key = process.env.BETTER_AUTH_SECRET ?? "";
const mfa = {
  secret: await symmetricEncrypt({ key, data: totpSecret }),
  backupCodes: await symmetricEncrypt({
    key,
    data: JSON.stringify(generateBackupCodes()),
  }),
  verified: true,
  failedVerificationCount: 0,
  lockedUntil: null,
};
await db.twoFactor.upsert({
  where: { userId: user.id },
  update: mfa,
  create: { id: newId(), userId: user.id, ...mfa },
});
await db.user.update({
  where: { id: user.id },
  data: { twoFactorEnabled: true },
});

// What the demo company may use (MOD-05): Inventario and Compras with the
// 1,000-product tier, so every screen is reachable locally.
const demo = await db.organization.findFirstOrThrow({
  where: { ownerUserId: user.id, name: "Ferretería Demo" },
});
for (const grant of [
  { kind: "MODULE" as const, key: "inventory", value: null },
  { kind: "MODULE" as const, key: "purchasing", value: null },
  { kind: "LIMIT" as const, key: "active_products", value: 1000 },
  { kind: "LIMIT" as const, key: "users", value: 5 },
]) {
  await db.entitlement.upsert({
    where: {
      organizationId_kind_key: {
        organizationId: demo.id,
        kind: grant.kind,
        key: grant.key,
      },
    },
    update: { value: grant.value, validUntil: null },
    create: {
      id: newId(),
      organizationId: demo.id,
      ...grant,
      validFrom: now,
    },
  });
}

console.log(
  `Cuenta demo lista: ${email} (contraseña en .env.local → DEMO_PASSWORD)`,
);
console.log(
  `Verificación en dos pasos: agrega la clave ${base32(totpSecret)} a tu app o usa npm run demo:codigo`,
);
await db.$disconnect();
