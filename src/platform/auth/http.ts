import "server-only";

import { auth } from "./auth";

/**
 * HTTP entry point of Better Auth (/api/auth/*), PLT-15.
 *
 * Every flow of the app runs in server actions that call `auth.api` and
 * add our rules (attempt limits per account, mandatory MFA, password and
 * code to turn MFA off…). Better Auth's own HTTP endpoints would skip
 * those rules, so only the link that arrives by email is reachable;
 * everything else answers 404. This is an allowlist: endpoints added by
 * future Better Auth versions stay closed until reviewed.
 *
 * Not `/verify-email`: it confirmed an email from the link alone. The
 * confirmation link now goes to /confirmar-correo and the email is
 * confirmed when the password is given too (security audit 2).
 */
const ALLOWED: { method: string; path: RegExp }[] = [
  // Password reset link: checks the token and redirects (PLT-07).
  { method: "GET", path: /^\/reset-password\/[A-Za-z0-9_-]{1,128}$/ },
];

const BASE_PATH = "/api/auth";

export function isAllowedAuthRequest(request: Request): boolean {
  const { pathname } = new URL(request.url);
  if (!pathname.startsWith(`${BASE_PATH}/`)) return false;
  const path = pathname.slice(BASE_PATH.length).replace(/\/+$/, "");
  return ALLOWED.some(
    (rule) => rule.method === request.method && rule.path.test(path),
  );
}

export async function handleAuthRequest(request: Request): Promise<Response> {
  if (!isAllowedAuthRequest(request)) {
    return new Response("Not Found", { status: 404 });
  }
  return auth.handler(request);
}
