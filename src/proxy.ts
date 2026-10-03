import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic auth check (PLT-04): sends people without a session cookie to
 * /ingresar before rendering a protected screen. It only reads the cookie;
 * every protected page and action still validates the session on the server
 * (requireSession), because a cookie alone proves nothing.
 */
const PROTECTED = [
  "/inventario",
  "/movimientos",
  "/ubicaciones",
  "/conteos",
  "/compras",
  "/configuracion",
];

export default function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const isProtected = PROTECTED.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  if (isProtected && !getSessionCookie(request)) {
    const url = new URL("/ingresar", request.url);
    url.searchParams.set("siguiente", `${pathname}${search}`);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/inventario/:path*",
    "/movimientos/:path*",
    "/ubicaciones/:path*",
    "/conteos/:path*",
    "/compras/:path*",
    "/configuracion/:path*",
  ],
};
