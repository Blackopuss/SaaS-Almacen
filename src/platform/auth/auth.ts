import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";

import { newId } from "@/lib";
import {
  existingAccountEmail,
  passwordChangedEmail,
  passwordResetEmail,
  sendEmail,
  verificationEmail,
} from "@/platform/email";
import { db } from "@/server";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  verifyPassword,
} from "./password";
import { clearAttempts, throttleKeys } from "./throttle";

/** Verification links stay valid for 24 hours and work once. */
export const VERIFICATION_HOURS = 24;

/** Password reset links stay valid for 60 minutes and work once (PLT-07). */
export const RESET_PASSWORD_MINUTES = 60;

/**
 * Authentication (BAS-04, PLT-02, PLT-03). Email + password with database
 * sessions; no session until the email is verified. Cookies are HttpOnly,
 * SameSite=Lax and Secure in production; Better Auth rejects requests from
 * untrusted origins (CSRF). Attempt limits: PLT-06. Password recovery:
 * PLT-07. MFA: PLT-08..PLT-09.
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
    // No session until the email is confirmed (PLT-03).
    requireEmailVerification: true,
    // Signing up with an existing email looks exactly like a new sign-up
    // (no account enumeration); the real owner is told by email.
    onExistingUserSignUp: async ({ user }) => {
      await sendEmail(
        existingAccountEmail({
          to: user.email,
          name: user.name,
          signInUrl: `${process.env.BETTER_AUTH_URL ?? ""}/ingresar`,
        }),
      );
    },
    // Password recovery (PLT-07): single-use link that expires.
    resetPasswordTokenExpiresIn: RESET_PASSWORD_MINUTES * 60,
    sendResetPassword: async ({ user, url }) => {
      await sendEmail(
        passwordResetEmail({
          to: user.email,
          name: user.name,
          url,
          minutes: RESET_PASSWORD_MINUTES,
        }),
      );
    },
    // A reset closes every session of the account (including stolen ones).
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => {
      // The link proved control of the mailbox: lift the sign-in block and
      // confirm the email, so the person can enter right away.
      await clearAttempts([throttleKeys.signInAccount(user.email)]);
      if (!user.emailVerified) {
        await db.user.update({
          where: { id: user.id },
          data: { emailVerified: true },
        });
      }
      await sendEmail(
        passwordChangedEmail({
          to: user.email,
          name: user.name,
          recoverUrl: `${process.env.BETTER_AUTH_URL ?? ""}/recuperar-contrasena`,
        }),
      );
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    sendOnSignIn: true,
    autoSignInAfterVerification: true,
    expiresIn: VERIFICATION_HOURS * 60 * 60,
    sendVerificationEmail: async ({ user, url }) => {
      await sendEmail(
        verificationEmail({
          to: user.email,
          name: user.name,
          url,
          hours: VERIFICATION_HOURS,
        }),
      );
    },
  },
  session: {
    // Sessions last 7 days and are extended once a day while in use.
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    // Every request validates the session in the database, so revoking a
    // session takes effect immediately (PLT-05). Do not enable the cache.
    cookieCache: { enabled: false },
  },
  advanced: {
    database: { generateId: () => newId() },
    // Secure cookies (HTTPS only, __Secure- prefix) outside local development.
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    // Better Auth skips the origin (CSRF) check when NODE_ENV=test; keep it
    // on everywhere so tests exercise the same protection as production.
    disableOriginCheck: false,
  },
  // Limits for the /api/auth HTTP endpoints (server actions are limited in
  // ./throttle.ts). Always on and stored in MySQL; Better Auth's default is
  // production-only and in memory.
  rateLimit: {
    enabled: true,
    storage: "database",
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 15 * 60, max: 20 },
      "/sign-up/email": { window: 60 * 60, max: 10 },
      "/send-verification-email": { window: 15 * 60, max: 10 },
      "/request-password-reset": { window: 15 * 60, max: 10 },
      "/reset-password": { window: 15 * 60, max: 10 },
      "/reset-password/*": { window: 15 * 60, max: 20 },
    },
  },
  // Never send usage data to third parties.
  telemetry: { enabled: false },
  // Must be last: lets server actions set auth cookies.
  plugins: [nextCookies()],
});

export type Session = typeof auth.$Infer.Session;
