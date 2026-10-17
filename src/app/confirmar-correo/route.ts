import { NextResponse, type NextRequest } from "next/server";

import { VERIFY_EMAIL_COOKIE, VERIFICATION_HOURS } from "@/platform/auth";

/**
 * Landing of the verification link (security audit 2). It does not
 * confirm anything: it keeps the token in this browser and asks to sign
 * in. The email is confirmed when someone signs in here with the account's
 * password (`signIn`), so having the mailbox is not enough to activate an
 * account whose password a stranger chose.
 */
export function GET(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token") ?? "";
  const response = NextResponse.redirect(
    new URL("/ingresar?confirmar=1", request.url),
    303,
  );
  // The token is in the URL: it must not travel to other sites.
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Cache-Control", "no-store");
  if (/^[A-Za-z0-9._-]{1,2048}$/.test(token)) {
    response.cookies.set(VERIFY_EMAIL_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: VERIFICATION_HOURS * 60 * 60,
    });
  }
  return response;
}
