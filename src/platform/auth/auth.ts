import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { newId } from "@/lib";
import { db } from "@/server";

/**
 * Authentication (BAS-04 technical spike). Email + password with
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
    minPasswordLength: 12,
    maxPasswordLength: 128,
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
