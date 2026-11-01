import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

import { contentSecurityPolicy, newNonce } from "@/lib";

/**
 * Optimistic auth check (PLT-04): sends people without a session cookie to
 * /ingresar before rendering a protected screen. It only reads the cookie;
 * every protected page and action still validates the session on the server
 * (requireSession), because a cookie alone proves nothing.
 */
const PROTECTED = [
  "/inicio",
  "/inventario",
  "/movimientos",
  "/ubicaciones",
  "/conteos",
  "/compras",
  "/ventas",
  "/configuracion",
  "/activa-dos-pasos",
  "/acepta-terminos",
  "/crear-empresa",
  "/interno",
  "/api/archivos",
  "/api/importaciones",
  "/api/exportaciones",
  "/api/compras",
  "/api/ventas",
];

/** The site people open: BETTER_AUTH_URL (required in production). */
function publicBase(request: NextRequest): string {
  return process.env.BETTER_AUTH_URL || request.url;
}

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (isProtected && !getSessionCookie(request)) {
    // From the public address: behind Caddy request.url says
    // localhost:3000, and Next refuses a relative Location here.
    const url = new URL("/ingresar", publicBase(request));
    url.searchParams.set("siguiente", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }

  // Script policy with a fresh nonce per request (PLT16-04). Next reads it
  // from the request's CSP header and puts it on its own scripts; the root
  // layout passes it to the theme script.
  const nonce = newNonce();
  const policy = contentSecurityPolicy(nonce, {
    development: process.env.NODE_ENV === "development",
    https:
      request.nextUrl.protocol === "https:" ||
      process.env.BETTER_AUTH_URL?.startsWith("https://") === true,
  });
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("Content-Security-Policy", policy);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  // Every page and route (the CSP needs a nonce per page); protected
  // paths are decided by PROTECTED above. Static build files do not run
  // through it.
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
