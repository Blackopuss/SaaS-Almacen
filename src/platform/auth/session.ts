import "server-only";

import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { auth } from "./auth";
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
export const getCurrentSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

export type CurrentUser = { id: string; name: string; email: string };

export async function requireSession(): Promise<{
  user: CurrentUser;
  sessionId: string;
}> {
  const session = await getCurrentSession();
  if (!session) redirect("/ingresar");
  const { id, name, email } = session.user;
  return { user: { id, name, email }, sessionId: session.session.id };
}

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(1024),
});

export type SignInResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unverified" | "unavailable" }
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
    await auth.api.signInEmail({ body: parsed.data, headers: requestHeaders });
    await clearAttempts([throttleKeys.signInAccount(email)]);
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
