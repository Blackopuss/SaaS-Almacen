import { afterAll, describe, expect, it } from "vitest";

import { isId } from "@/lib";
import { auth } from "@/platform/auth";
import { memoryOutboxFor } from "@/platform/email";
import { db } from "@/server";

// BAS-04 + PLT-03: email/password accounts and database sessions against
// MySQL; no session until the email is verified.

const password = "correcto-caballo-bateria-42";
const email = `spike.${Date.now()}@example.test`;

function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((c) => c.includes("better-auth.session_token="))
    ?.split(";")[0];
}

/** Opens the latest verification link sent to `to` and returns the response. */
async function openVerificationLink(to: string): Promise<Response> {
  const mail = memoryOutboxFor(to).at(-1);
  expect(mail?.actionUrl, "verification email was sent").toBeDefined();
  return auth.handler(new Request(mail!.actionUrl!));
}

afterAll(async () => {
  await db.$disconnect();
});

describe("Better Auth on MySQL", () => {
  let cookie = "";

  it("registers with a UUIDv7 id and a hashed password, without a session", async () => {
    const response = await auth.api.signUpEmail({
      body: { name: "Prueba Técnica", email, password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    expect(sessionCookie(response)).toBeUndefined();

    const user = await db.user.findUniqueOrThrow({
      where: { email },
      include: { accounts: true, sessions: true },
    });
    expect(isId(user.id)).toBe(true);
    expect(user.emailVerified).toBe(false);
    expect(user.sessions).toHaveLength(0);
    const credential = user.accounts.find((a) => a.providerId === "credential");
    expect(credential?.password).toBeTruthy();
    expect(credential?.password).not.toContain(password);
  });

  it("refuses to sign in before the email is verified and resends the link", async () => {
    const before = memoryOutboxFor(email).length;
    await expect(
      auth.api.signInEmail({ body: { email, password } }),
    ).rejects.toThrow();
    expect(memoryOutboxFor(email).length).toBe(before + 1);
  });

  it("verifies the email from the link and starts a session", async () => {
    const response = await openVerificationLink(email);
    expect([200, 302]).toContain(response.status);
    cookie = sessionCookie(response) ?? "";
    expect(cookie).not.toBe("");

    const user = await db.user.findUniqueOrThrow({ where: { email } });
    expect(user.emailVerified).toBe(true);
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    });
    expect(session?.user.email).toBe(email);
  });

  it("rejects a reused verification link", async () => {
    const reused = await openVerificationLink(email);
    expect(sessionCookie(reused)).toBeUndefined();
  });

  it("rejects a forged verification token", async () => {
    const forged = await auth.handler(
      new Request(
        `${process.env.BETTER_AUTH_URL}/api/auth/verify-email?token=no-valido`,
      ),
    );
    expect(sessionCookie(forged)).toBeUndefined();
  });

  it("rejects short and wrong passwords", async () => {
    await expect(
      auth.api.signUpEmail({
        body: { name: "Corta", email: `short.${email}`, password: "123" },
      }),
    ).rejects.toThrow();
    await expect(
      auth.api.signInEmail({ body: { email, password: "incorrecta-123456" } }),
    ).rejects.toThrow();
  });

  it("signs in and out once verified; the revoked session stops working", async () => {
    const response = await auth.api.signInEmail({
      body: { email, password },
      asResponse: true,
    });
    expect(response.status).toBe(200);
    const signedIn = sessionCookie(response)!;

    await auth.api.signOut({ headers: new Headers({ cookie: signedIn }) });
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: signedIn }),
    });
    expect(session).toBeNull();
  });
});
