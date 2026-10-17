import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { GET as confirmEmail } from "@/app/confirmar-correo/route";
import proxy from "@/proxy";
import { VERIFY_EMAIL_COOKIE } from "@/platform/auth";

// Behind Caddy the app sees itself as localhost:3000 (it listens there),
// so a redirect built from request.url sent people to their own machine
// (found on the first server). Redirects carry only a path.

const internal = (path: string) =>
  new NextRequest(new URL(path, "https://localhost:3000"));

describe("redirects behind the proxy", () => {
  it("the confirmation link goes back to /ingresar on the same site", async () => {
    const response = confirmEmail(
      internal("/confirmar-correo?token=abc.def-ghi_1"),
    );
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/ingresar?confirmar=1");
    expect(response.cookies.get(VERIFY_EMAIL_COOKIE)?.value).toBe(
      "abc.def-ghi_1",
    );
  });

  it("a protected screen without session goes to /ingresar on the same site", () => {
    const response = proxy(internal("/inventario?pagina=2"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "/ingresar?siguiente=%2Finventario%3Fpagina%3D2",
    );
  });
});
