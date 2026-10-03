import { afterAll, describe, expect, it } from "vitest";

import { isId } from "@/lib";
import { auth } from "@/platform/auth";
import { db } from "@/server";

// BAS-04: email/password registration and database sessions work end to
// end against MySQL with the app's least-privilege user.

const password = "correcto-caballo-bateria-42";
const email = `spike.${Date.now()}@example.test`;

function cookieFrom(response: Response): string {
  const raw = response.headers.getSetCookie();
  const token = raw.find((c) => c.includes("better-auth.session_token="));
  expect(token, "session cookie is set").toBeDefined();
  return token!.split(";")[0]!;
}

afterAll(async () => {
  await db.$disconnect();
});

describe("Better Auth on MySQL", () => {
  let cookie = "";

  it("registers a user with a UUIDv7 id and a hashed password", async () => {
    const response = await auth.api.signUpEmail({
      body: { name: "Prueba Técnica", email, password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    cookie = cookieFrom(response);

    const user = await db.user.findUniqueOrThrow({
      where: { email },
      include: { accounts: true },
    });
    expect(isId(user.id)).toBe(true);
    const credential = user.accounts.find((a) => a.providerId === "credential");
    expect(credential?.password).toBeTruthy();
    expect(credential?.password).not.toContain(password);
  });

  it("resolves the session from the cookie", async () => {
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user.email).toBe(email);
    expect(isId(session!.session.id)).toBe(true);
  });

  it("rejects a duplicate email", async () => {
    await expect(
      auth.api.signUpEmail({ body: { name: "Otra", email, password } }),
    ).rejects.toThrow();
  });

  it("rejects short passwords", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { name: "Corta", email: `short.${email}`, password: "123" },
      }),
    ).rejects.toThrow();
  });

  it("rejects a wrong password", async () => {
    await expect(
      auth.api.signInEmail({ body: { email, password: "incorrecta-123456" } }),
    ).rejects.toThrow();
  });

  it("signs in and out; the revoked session stops working", async () => {
    const response = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const signedIn = cookieFrom(response);

    await auth.api.signOut({ headers: new Headers({ cookie: signedIn }) });
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: signedIn }),
    });
    expect(session).toBeNull();
  });
});
