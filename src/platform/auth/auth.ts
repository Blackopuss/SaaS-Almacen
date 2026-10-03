import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { newId } from "@/lib";
import { db } from "@/server";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  verifyPassword,
} from "./password";

/**
 * Authentication (BAS-04, PLT-02). Email + password with
 * database sessions. Verification, rate limits, recovery and MFA are
 * completed in PLT-02..PLT-09.
 */
export const auth = betterAuth({
  appName: "Almacén",
  baseURL: process.env.BETTER_AUTH_URL,
  secret: process.env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "mysql", transaction: true }),
  emailAndPassword: {
    enabled: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    // OWASP-recommended scrypt parameters (see ./password.ts).
    password: { hash: hashPassword, verify: verifyPassword },
  },
  advanced: {
    database: { generateId: () => newId() },
  },
  // Never send usage data to third parties.
  telemetry: { enabled: false },
  // Must be last: lets server actions set auth cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
