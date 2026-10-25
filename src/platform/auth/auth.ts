import "server-only";

import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { after } from "next/server";
import { twoFactor } from "better-auth/plugins";

import { log, newId } from "@/lib";
import { recordSecurityEvent } from "@/platform/audit";
import {
  existingAccountEmail,
  passwordChangedEmail,
  passwordResetEmail,
  sendEmail,
  verificationEmail,
} from "@/platform/email";
import { recordLegalAcceptance } from "@/platform/legal";
import { db } from "@/server";

import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  hashPassword,
  verifyPassword,
} from "./password";
import { generateBackupCodes } from "./backup-codes";
import { clearAttempts, clientIp, throttleKeys } from "./throttle";

/** Verification links stay valid for 24 hours and work once. */
export const VERIFICATION_HOURS = 24;

/** Where the verification link lands (it keeps the token, see `signIn`). */
export const VERIFY_EMAIL_PATH = "/confirmar-correo";

/** Cookie that holds the token of a verification link in this browser. */
export const VERIFY_EMAIL_COOKIE = "almacen-confirmar-correo";

/**
 * Emails go out after the response is sent (PLT-16). Otherwise a request
 * for an existing account (which sends an email) would take longer than
 * one for an unknown email, revealing which accounts exist.
 */
function inBackground(task: Promise<unknown>): void {
  try {
    after(task);
  } catch {
    // Outside a request (tests, scripts): let it run on its own.
    void task;
  }
}

/** Authenticator app codes: 6 digits that change every 30 seconds. */
export const TOTP_DIGITS = 6;

/** Password reset links stay valid for 60 minutes and work once (PLT-07). */
export const RESET_PASSWORD_MINUTES = 60;

/**
 * Address the links in emails are built on. When serving in production it
 * must be set — otherwise Better Auth would take it from the request's
 * Host header, which anyone can write — and anything but this machine must
 * be https (security audit). The build only loads the code: not checked.
 */
function checkedBaseUrl(): string | undefined {
  const configured = process.env.BETTER_AUTH_URL;
  if (
    process.env.NODE_ENV !== "production" ||
    process.env.NEXT_PHASE === "phase-production-build"
  ) {
    return configured;
  }
  let url: URL;
  try {
    url = new URL(configured ?? "");
  } catch {
    throw new Error("BETTER_AUTH_URL must be set to the site's address.");
  }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !local) {
    throw new Error("BETTER_AUTH_URL must use https outside this machine.");
  }
  return configured;
}

/**
 * Authentication (BAS-04, PLT-02, PLT-03). Email + password with database
 * sessions; no session until the email is verified. Cookies are HttpOnly,
 * SameSite=Lax and Secure in production; Better Auth rejects requests from
 * untrusted origins (CSRF). Attempt limits: PLT-06. Password recovery:
 * PLT-07. MFA with an authenticator app (TOTP): PLT-08A..PLT-09.
 */
export const auth = betterAuth({
  appName: "Almacén",
  baseURL: checkedBaseUrl(),
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
    onPasswordReset: async ({ user }, request) => {
      await recordSecurityEvent({
        userId: user.id,
        action: "password.reset",
        ipAddress: request ? clientIp(request.headers) : null,
      });
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
    // Not on every sign-in: that mailed a link per attempt with no limit
    // (security audit 2). `signIn` resends through the limited path.
    sendOnSignIn: false,
    // The link proves the mailbox, not who chose the password: anyone can
    // register someone else's email. Starting a session from it would hand
    // the mailbox owner an account whose password a stranger knows (security
    // audit). The owner signs in with the password; if it was not theirs,
    // recovery replaces it and closes every session.
    autoSignInAfterVerification: false,
    expiresIn: VERIFICATION_HOURS * 60 * 60,
    // The link does not confirm by itself (security audit 2): it lands on
    // /confirmar-correo, which keeps the token in this browser, and the
    // email is confirmed only when someone signs in there with the
    // account's password (`signIn`). Whoever has the mailbox but not the
    // password a stranger chose can never activate that account; they
    // recover it instead, which replaces the password.
    sendVerificationEmail: async ({ user, token }) => {
      await sendEmail(
        verificationEmail({
          to: user.email,
          name: user.name,
          url: `${process.env.BETTER_AUTH_URL ?? ""}${VERIFY_EMAIL_PATH}?token=${encodeURIComponent(token)}`,
          hours: VERIFICATION_HOURS,
        }),
      );
    },
  },
  databaseHooks: {
    user: {
      create: {
        // PIL-09: only self sign-up creates users through Better Auth, and
        // it is reachable only from registerUser, which requires the
        // checkbox. Better Auth runs this after its transaction commits; if
        // it fails, the gate in requireSession asks for the acceptance at
        // the first sign-in, so no one uses the app without it.
        after: async (user, context) => {
          if (context?.path !== "/sign-up/email") return;
          try {
            await recordLegalAcceptance(db, user.id, {
              ipAddress: context.headers ? clientIp(context.headers) : null,
              userAgent: context.headers?.get("user-agent") ?? null,
            });
          } catch (error) {
            log.error("legal.acceptance_failed", error);
          }
        },
      },
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
    backgroundTasks: { handler: inBackground },
    // Secure cookies (HTTPS only, __Secure- prefix) outside local development.
    useSecureCookies: process.env.NODE_ENV === "production",
    defaultCookieAttributes: { httpOnly: true, sameSite: "lax", path: "/" },
    // Better Auth skips the origin (CSRF) check when NODE_ENV=test; keep it
    // on everywhere so tests exercise the same protection as production.
    disableOriginCheck: false,
  },
  // Limits for the /api/auth HTTP endpoints (server actions are limited in
  // ./throttle.ts). Always on and stored in MySQL; Better Auth's default is
  // production-only and in memory. Since PLT-15 only the email links are
  // reachable over HTTP (./http.ts); the other rules stay as a second line.
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
  plugins: [
    // MFA (PLT-08A). The secret and backup codes are stored encrypted; a
    // password is required to start enrollment and the app is active only
    // after its first code is confirmed. "Trust this device" is not offered.
    twoFactor({
      issuer: "Almacén",
      totpOptions: { digits: TOTP_DIGITS, period: 30 },
      // Easy-to-type codes; see ./backup-codes.ts (PLT-09).
      backupCodeOptions: { customBackupCodesGenerate: generateBackupCodes },
    }),
    // Must be last: lets server actions set auth cookies.
    nextCookies(),
  ],
});

export type Session = typeof auth.$Infer.Session;
