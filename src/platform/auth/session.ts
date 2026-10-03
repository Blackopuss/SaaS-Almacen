import "server-only";

import { isAPIError } from "better-auth/api";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { z } from "zod";

import { auth } from "./auth";

/**
 * Session access (PLT-04). `getCurrentSession` validates the session against
 * the database (never trust the cookie alone); `requireSession` is the
 * server-side guard for protected screens and actions.
 */
export const getCurrentSession = cache(async () =>
  auth.api.getSession({ headers: await headers() }),
);

export type CurrentUser = { id: string; name: string; email: string };

export async function requireSession(): Promise<{ user: CurrentUser }> {
  const session = await getCurrentSession();
  if (!session) redirect("/ingresar");
  const { id, name, email } = session.user;
  return { user: { id, name, email } };
}

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().max(254),
  password: z.string().max(1024),
});

export type SignInResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unverified" | "unavailable" };

/**
 * Signs in with email and password; Better Auth sets the session cookie.
 * Unknown email and wrong password give the same answer (no enumeration).
 */
export async function signIn(
  input: { email: string; password: string },
  requestHeaders: Headers,
): Promise<SignInResult> {
  const parsed = signInSchema.safeParse(input);
  if (!parsed.success || !parsed.data.email || !parsed.data.password) {
    return { ok: false, reason: "invalid" };
  }
  try {
    await auth.api.signInEmail({ body: parsed.data, headers: requestHeaders });
    return { ok: true };
  } catch (error) {
    if (isAPIError(error)) {
      if (error.body?.code === "EMAIL_NOT_VERIFIED") {
        return { ok: false, reason: "unverified" };
      }
      if (error.status === "UNAUTHORIZED" || error.statusCode === 401) {
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
