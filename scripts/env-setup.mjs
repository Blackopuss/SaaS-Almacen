// Adds missing application settings and secrets to .env.local (BAS-04).
// Idempotent; secrets are random and never printed. Usage: npm run env:setup
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";

const ENV_FILE = ".env.local";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const values = {
  BETTER_AUTH_URL: () => "http://localhost:3000",
  BETTER_AUTH_SECRET: () => randomBytes(32).toString("base64url"),
  // Local demo account created by `npm run db:seed` (development only).
  DEMO_EMAIL: () => "demo@almacen.test",
  DEMO_PASSWORD: () => randomBytes(12).toString("base64url"),
  // The demo account owns a company, so it must use MFA (PLT-08B).
  // `npm run demo:codigo` prints its current code.
  DEMO_TOTP_SECRET: () => randomBytes(24).toString("base64url").slice(0, 32),
};

const added = Object.entries(values)
  .filter(([key]) => !process.env[key])
  .map(([key, make]) => [key, make()]);

if (added.length > 0) {
  appendFileSync(
    ENV_FILE,
    "\n" + added.map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
  );
  console.log(`Agregadas a ${ENV_FILE}: ${added.map(([k]) => k).join(", ")}`);
} else {
  console.log(`${ENV_FILE} ya tiene la configuración de la aplicación.`);
}
