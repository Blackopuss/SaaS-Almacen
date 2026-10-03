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
const { generateRandomString, symmetricEncrypt } =
  await import("better-auth/crypto");
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
// are random and unknown (PLT-09 adds a way to see new ones).
const key = process.env.BETTER_AUTH_SECRET ?? "";
const mfa = {
  secret: await symmetricEncrypt({ key, data: totpSecret }),
  backupCodes: await symmetricEncrypt({
    key,
    data: JSON.stringify(
      Array.from({ length: 10 }, () => generateRandomString(10, "a-z", "0-9")),
    ),
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

console.log(
  `Cuenta demo lista: ${email} (contraseña en .env.local → DEMO_PASSWORD)`,
);
console.log(
  `Verificación en dos pasos: agrega la clave ${base32(totpSecret)} a tu app o usa npm run demo:codigo`,
);
await db.$disconnect();
