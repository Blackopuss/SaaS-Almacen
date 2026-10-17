// Prints the current MFA code of the local demo account (PLT-08B).
// Usage: npm run demo:codigo   (development only; reads .env.local)
import { existsSync } from "node:fs";

import { base32, totpCode } from "./totp.mjs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const secret = process.env.DEMO_TOTP_SECRET;
if (!secret) {
  console.error(
    "Falta DEMO_TOTP_SECRET: corre npm run env:setup y npm run db:seed.",
  );
  process.exit(1);
}

const left = 30 - (Math.floor(Date.now() / 1000) % 30);
console.log(
  `Código de la cuenta demo: ${totpCode(secret)} (vence en ${left} s)`,
);
console.log(`Clave para tu app de autenticación: ${base32(secret)}`);
