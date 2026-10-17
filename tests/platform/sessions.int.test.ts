import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  auth,
  listActiveSessions,
  revokeOtherSessions,
  revokeSession,
} from "@/platform/auth";
import { db } from "@/server";

// PLT-05: a revoked session stops working immediately, only the owner can
// end their sessions, and tokens are never part of the listing.

const password = "una-frase-larga-y-segura";
const stamp = Date.now();
const owner = `sesiones.${stamp}@example.test`;
const other = `ajeno.${stamp}@example.test`;

const UA = {
  laptop:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0",
  phone:
    "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
};

type Signed = { cookie: string; id: string; userId: string };

async function signInFrom(email: string, userAgent: string): Promise<Signed> {
  const response = await auth.api.signInEmail({
    body: { email, password },
    headers: new Headers({ "user-agent": userAgent }),
    asResponse: true,
  });
  const cookie = response.headers
    .getSetCookie()
    .find((c) => c.includes("session_token="))!
    .split(";")[0]!;
  const session = await auth.api.getSession({
    headers: new Headers({ cookie }),
  });
  return { cookie, id: session!.session.id, userId: session!.user.id };
}

async function stillValid(cookie: string): Promise<boolean> {
  return (
    (await auth.api.getSession({ headers: new Headers({ cookie }) })) !== null
  );
}

let laptop: Signed;
let phone: Signed;
let tablet: Signed;
let stranger: Signed;

beforeAll(async () => {
  for (const email of [owner, other]) {
    await auth.api.signUpEmail({ body: { name: "Sesiones", email, password } });
    await db.user.update({ where: { email }, data: { emailVerified: true } });
  }
  laptop = await signInFrom(owner, UA.laptop);
  phone = await signInFrom(owner, UA.phone);
  tablet = await signInFrom(owner, UA.phone);
  stranger = await signInFrom(other, UA.laptop);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("active sessions", () => {
  it("lists the owner's sessions with the current one first, without tokens", async () => {
    const list = await listActiveSessions(laptop.userId, laptop.id);
    expect(list).toHaveLength(3);
    expect(list[0]).toMatchObject({
      id: laptop.id,
      current: true,
      label: "Edge en Windows",
    });
    expect(list.find((s) => s.id === phone.id)).toMatchObject({
      current: false,
      label: "Chrome en Android",
      mobile: true,
    });
    expect(JSON.stringify(list)).not.toMatch(/token/i);
  });

  it("revoked session stops working immediately; the others keep working", async () => {
    expect(await stillValid(phone.cookie)).toBe(true);
    expect(await revokeSession(laptop.userId, phone.id, laptop.id)).toBe(true);
    expect(await stillValid(phone.cookie)).toBe(false);
    expect(await stillValid(laptop.cookie)).toBe(true);
    expect(await stillValid(tablet.cookie)).toBe(true);
  });

  it("cannot end another user's session or the current one", async () => {
    expect(await revokeSession(laptop.userId, stranger.id, laptop.id)).toBe(
      false,
    );
    expect(await stillValid(stranger.cookie)).toBe(true);
    expect(await revokeSession(laptop.userId, laptop.id, laptop.id)).toBe(
      false,
    );
    expect(await stillValid(laptop.cookie)).toBe(true);
  });

  it("ends every other session at once and keeps the current one", async () => {
    expect(await revokeOtherSessions(laptop.userId, laptop.id)).toBe(1);
    expect(await stillValid(tablet.cookie)).toBe(false);
    expect(await stillValid(laptop.cookie)).toBe(true);
    expect(await stillValid(stranger.cookie)).toBe(true);
    expect(await listActiveSessions(laptop.userId, laptop.id)).toHaveLength(1);
  });

  it("signing out revokes the session in the database", async () => {
    await auth.api.signOut({ headers: new Headers({ cookie: laptop.cookie }) });
    expect(await stillValid(laptop.cookie)).toBe(false);
    expect(await db.session.count({ where: { id: laptop.id } })).toBe(0);
  });
});
