import "server-only";

import { isAPIError } from "better-auth/api";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { auth } from "./auth";
import { isMfaRequired } from "./mfa-policy";
import {
  blockedFor,
  clearAttempts,
  clientIp,
  recordAttempt,
  throttleKeys,
  tooManyAttemptsMessage,
} from "./throttle";

/**
 * Session access (PLT-04). `getCurrentSession` validates the session against
 * the database (never trust the cookie alone); `requireSession` is the
 * server-side guard for protected screens and actions.
 */
export const getCurrentSession = cache(async () => {
  // Cookies come from cookies(), not the raw request headers: a server
  // action that rotates the session (e.g. enabling MFA) re-renders with the
  // new cookie, which only cookies() reflects.
  const requestHeaders = new Headers(await headers());
  requestHeaders.set("cookie", (await cookies()).toString());
  return auth.api.getSession({ headers: requestHeaders });
});

export type CurrentUser = { id: string; name: string; email: string };

/** Where accounts that must use MFA set it up before using the app. */
export const MFA_SETUP_PATH = "/activa-dos-pasos";

/**
 * Server-side guard for protected screens and actions. Accounts that must
 * use MFA (PLT-08B) and have not set it up are sent to MFA_SETUP_PATH;
 * only that screen passes `allowMissingMfa`.
 */
export async function requireSession(
  options: { allowMissingMfa?: boolean } = {},
): Promise<{
  user: CurrentUser;
  sessionId: string;
  mfaEnabled: boolean;
}> {
  const session = await getCurrentSession();
  if (!session) redirect("/ingresar");
  const { id, name, email } = session.user;
  const mfaEnabled = Boolean(session.user.twoFactorEnabled);
  if (!mfaEnabled && !options.allowMissingMfa && (await isMfaRequired(id))) {
    redirect(MFA_SETUP_PATH);
  }
  return {
    user: { id, name, email },
    sessionId: session.session.id,
    mfaEnabled,
  };
}

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(1024),
});

export type SignInResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unverified" | "unavailable" }
  /** Password accepted; no session until the MFA code is confirmed. */
  | { ok: false; reason: "mfa" }
  | { ok: false; reason: "throttled"; message: string };

/**
 * Signs in with email and password; Better Auth sets the session cookie.
 * Unknown email and wrong password give the same answer (no enumeration).
 * Repeated failures block the submitted email and the client IP for a while
 * (PLT-06); while blocked, even the right password is refused.
 */
export async function signIn(
  input: { email: string; password: string },
  requestHeaders: Headers,
): Promise<SignInResult> {
  const parsed = signInSchema.safeParse(input);
  const ip = clientIp(requestHeaders);
  const email = parsed.success ? parsed.data.email : "";
  const keys = [throttleKeys.signInIp(ip)];
  if (email) keys.push(throttleKeys.signInAccount(email));

  const wait = await blockedFor(keys);
  if (wait > 0) {
    return {
      ok: false,
      reason: "throttled",
      message: tooManyAttemptsMessage(wait),
    };
  }
  if (!parsed.success || !email || !parsed.data.password) {
    await recordAttempt(keys);
    return { ok: false, reason: "invalid" };
  }

  try {
    const result = await auth.api.signInEmail({
      body: parsed.data,
      headers: requestHeaders,
    });
    await clearAttempts([throttleKeys.signInAccount(email)]);
    // MFA on: Better Auth kept no session and set a short-lived challenge
    // cookie; the code is checked by verifySignInCode (./mfa.ts).
    if ("twoFactorRedirect" in result && result.twoFactorRedirect) {
      return { ok: false, reason: "mfa" };
    }
    return { ok: true };
  } catch (error) {
    if (isAPIError(error)) {
      if (error.body?.code === "EMAIL_NOT_VERIFIED") {
        // Right password: not a guessing attempt.
        await clearAttempts([throttleKeys.signInAccount(email)]);
        return { ok: false, reason: "unverified" };
      }
      if (error.status === "UNAUTHORIZED" || error.statusCode === 401) {
        await recordAttempt(keys);
        return { ok: false, reason: "invalid" };
      }
    }
    console.error("signIn failed", error);
    return { ok: false, reason: "unavailable" };
  }
}

/** Revokes the current session in the database and clears the cookie. */
export async function signOut(): Promise<void> {
  await auth.api.signOut({ headers: await headers() });
}
