import { afterAll, describe, expect, it } from "vitest";

import { isId } from "@/lib";
import {
  VERIFY_EMAIL_COOKIE,
  auth,
  handleAuthRequest,
  registerUser,
  signIn,
} from "@/platform/auth";
import { memoryOutboxFor } from "@/platform/email";
import { db } from "@/server";

// BAS-04 + PLT-03: email/password accounts and database sessions against
// MySQL; no session until the email is verified. Security audits 1 and 2:
// the email is confirmed only when the link's browser also gives the
// password, so the mailbox alone never activates a stranger's account.

const password = "correcto-caballo-bateria-42";
const stamp = Date.now();
const email = `spike.${stamp}@example.test`;
let ip = 0;

function sessionCookie(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((c) => c.includes("better-auth.session_token="))
    ?.split(";")[0];
}

/** Token of the latest verification link sent to `to`. */
function linkToken(to: string): string {
  const mail = memoryOutboxFor(to).at(-1);
  expect(mail?.actionUrl, "verification email was sent").toBeDefined();
  const url = new URL(mail!.actionUrl!);
  expect(url.pathname).toBe("/confirmar-correo");
  return url.searchParams.get("token")!;
}

/** A browser: its own IP and, if it opened a link, the link's cookie. */
const browser = (token?: string) =>
  new Headers({
    "x-forwarded-for": `198.18.${stamp % 200}.${++ip}`,
    ...(token
      ? { cookie: `${VERIFY_EMAIL_COOKIE}=${encodeURIComponent(token)}` }
      : {}),
  });

const verified = async (address: string) =>
  (await db.user.findUniqueOrThrow({ where: { email: address } }))
    .emailVerified;

afterAll(async () => {
  await db.$disconnect();
});

describe("Better Auth on MySQL", () => {
  it("registers with a UUIDv7 id and a hashed password, without a session", async () => {
    expect(
      await registerUser(
        { name: "Prueba Técnica", email, password },
        browser(),
      ),
    ).toEqual({ ok: true });
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

  it("refuses to sign in before the email is verified and resends within the limit", async () => {
    const before = memoryOutboxFor(email).length;
    expect(await signIn({ email, password }, browser())).toEqual({
      ok: false,
      reason: "unverified",
    });
    expect(memoryOutboxFor(email).length).toBe(before + 1);
    // Security audit 2: never one email per attempt.
    for (let i = 0; i < 5; i++) await signIn({ email, password }, browser());
    expect(memoryOutboxFor(email).length).toBeLessThanOrEqual(before + 3);
  }, 60_000);

  it("the link alone confirms nothing", async () => {
    const token = linkToken(email);
    const response = await handleAuthRequest(
      new Request(
        `${process.env.BETTER_AUTH_URL}/api/auth/verify-email?token=${token}`,
      ),
    );
    expect(response.status).toBe(404);
    expect(sessionCookie(response)).toBeUndefined();
    expect(await verified(email)).toBe(false);
  });

  it("the link's browser plus the password confirm the email and sign in", async () => {
    const token = linkToken(email);
    expect(await signIn({ email, password }, browser(token))).toEqual({
      ok: true,
    });
    expect(await verified(email)).toBe(true);
  }, 30_000);

  it("a link for another email does nothing", async () => {
    const other = `otro.${stamp}@example.test`;
    await registerUser({ name: "Otro", email: other, password }, browser());
    // Signing in to `other` with `email`'s link: not confirmed.
    expect(
      await signIn({ email: other, password }, browser(linkToken(email))),
    ).toMatchObject({ ok: false, reason: "unverified" });
    expect(await verified(other)).toBe(false);
  }, 30_000);

  it("a stranger's registration cannot be activated by the mailbox owner; recovery takes it over", async () => {
    const owner = `dueno.${stamp}@example.test`;
    const stranger = "la-contrasena-del-extrano-42";
    await registerUser(
      { name: "Extraño", email: owner, password: stranger },
      browser(),
    );
    // The owner opens the link but does not know the stranger's password.
    const token = linkToken(owner);
    expect(
      await signIn(
        { email: owner, password: "la-contrasena-del-dueno-42" },
        browser(token),
      ),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(await verified(owner)).toBe(false);
    // The stranger never gets in: the account was never confirmed.
    expect(
      await signIn({ email: owner, password: stranger }, browser()),
    ).toMatchObject({ ok: false, reason: "unverified" });
    // The owner recovers it: the stranger's password stops working.
    await auth.api.requestPasswordReset({
      body: { email: owner, redirectTo: "/restablecer-contrasena" },
    });
    const link = memoryOutboxFor(owner).at(-1)!.actionUrl!;
    const reset = new URL(link).pathname.split("/").at(-1)!;
    await auth.api.resetPassword({
      body: { token: reset, newPassword: "la-contrasena-del-dueno-42" },
    });
    expect(
      await signIn({ email: owner, password: stranger }, browser()),
    ).toEqual({ ok: false, reason: "invalid" });
    expect(
      await signIn(
        { email: owner, password: "la-contrasena-del-dueno-42" },
        browser(),
      ),
    ).toEqual({ ok: true });
    const user = await db.user.findUniqueOrThrow({ where: { email: owner } });
    expect(user.twoFactorEnabled).toBe(false);
  }, 60_000);

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
