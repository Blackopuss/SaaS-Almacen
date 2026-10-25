import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { newId } from "@/lib";
import { auth, registerUser, requireSession } from "@/platform/auth";
import {
  acceptInvitationAsNewUser,
  createInvitation,
} from "@/platform/authorization";
import { memoryOutboxFor } from "@/platform/email";
import {
  LEGAL_DOCUMENTS,
  acceptLegalDocuments,
  pendingLegalDocuments,
} from "@/platform/legal";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

import { grantSeats } from "../setup/plan";

// PIL-09: every account stores version, date and person of its acceptance
// of the terms and the privacy notice; a new version stops the person at
// /acepta-terminos until they accept it.

const request = vi.hoisted(() => ({ cookie: "" }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-forwarded-for": "198.51.100.90" }),
  cookies: async () => ({ toString: () => request.cookie }),
}));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect:${path}`);
  },
}));

const stamp = Date.now();
let counter = 0;
const address = (label: string) =>
  `${label}.${++counter}.legal.${stamp}@example.test`;
const PASSWORD = "una frase larga y segura 2026";
const SLOW = 30_000;
const from = (ip = `198.51.100.${(++counter % 200) + 1}`) =>
  new Headers({ "x-forwarded-for": ip, "user-agent": "Navegador de prueba" });

const current = {
  terms: LEGAL_DOCUMENTS.terms.version,
  privacy: LEGAL_DOCUMENTS.privacy.version,
};

async function acceptances(userId: string) {
  return db.legalAcceptance.findMany({
    where: { userId },
    orderBy: [{ document: "asc" }, { version: "asc" }],
  });
}

let org = "";
let owner = "";

beforeAll(async () => {
  owner = newId();
  await db.user.create({
    data: { id: owner, name: "Titular", email: address("titular") },
  });
  const created = await createOrganization(owner, {
    name: "Ferretería Legal",
    timeZone: "",
  });
  if (!created.ok) throw new Error("organization failed");
  org = created.organizationId;
  await grantSeats(org, 10);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("registration", () => {
  it("refuses to create the account without the checkbox", async () => {
    const email = address("sin-casilla");
    const result = await registerUser(
      { name: "Sin Casilla", email, password: PASSWORD, acceptLegal: false },
      from(),
    );
    expect(result).toEqual({
      ok: false,
      fieldErrors: {
        acceptLegal: expect.stringMatching(/acepta los términos/),
      },
    });
    expect(await db.user.count({ where: { email } })).toBe(0);
  });

  it(
    "stores version, date and person of each document",
    async () => {
      const email = address("registro");
      const before = new Date(Date.now() - 1000);
      expect(
        await registerUser(
          { name: "Con Casilla", email, password: PASSWORD, acceptLegal: true },
          from("198.51.100.231"),
        ),
      ).toEqual({ ok: true });
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      const rows = await acceptances(user.id);
      expect(rows).toMatchObject([
        {
          document: "privacy",
          version: current.privacy,
          ipAddress: "198.51.100.231",
          userAgent: "Navegador de prueba",
        },
        { document: "terms", version: current.terms },
      ]);
      for (const row of rows) {
        expect(row.acceptedAt.getTime()).toBeGreaterThan(before.getTime());
      }
      expect(await pendingLegalDocuments(user.id)).toEqual([]);
    },
    SLOW,
  );

  it(
    "a sign-up with a taken email records nothing for its owner",
    async () => {
      const email = address("ocupado");
      await registerUser(
        { name: "Dueña", email, password: PASSWORD, acceptLegal: true },
        from(),
      );
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      await registerUser(
        { name: "Otra", email, password: PASSWORD, acceptLegal: true },
        from(),
      );
      expect(await acceptances(user.id)).toHaveLength(2);
    },
    SLOW,
  );
});

describe("invitation with a new account", () => {
  async function invite(email: string) {
    const result = await createInvitation(org, owner, {
      email,
      roles: ["viewer"],
    });
    if (!result.ok) throw new Error("invitation failed");
    const url = memoryOutboxFor(email).at(-1)!.actionUrl!;
    return new URL(url).searchParams.get("token")!;
  }

  it(
    "requires the checkbox and records it with the account",
    async () => {
      const email = address("invitada");
      const token = await invite(email);
      expect(
        await acceptInvitationAsNewUser(
          token,
          { name: "Invitada", password: PASSWORD, acceptLegal: false },
          from(),
        ),
      ).toMatchObject({
        ok: false,
        reason: "fields",
        fieldErrors: { acceptLegal: expect.any(String) },
      });
      expect(await db.user.count({ where: { email } })).toBe(0);

      expect(
        await acceptInvitationAsNewUser(
          token,
          { name: "Invitada", password: PASSWORD, acceptLegal: true },
          from(),
        ),
      ).toMatchObject({ ok: true });
      const user = await db.user.findUniqueOrThrow({ where: { email } });
      expect(await pendingLegalDocuments(user.id)).toEqual([]);
      expect(await acceptances(user.id)).toHaveLength(2);
    },
    SLOW,
  );
});

describe("a new version", () => {
  it(
    "stops the person at /acepta-terminos until they accept it again",
    async () => {
      // A person (not a titular: no MFA required) who accepted the
      // current versions when the account was created.
      const email = address("vigente");
      const token = await (async () => {
        const result = await createInvitation(org, owner, {
          email,
          roles: ["viewer"],
        });
        if (!result.ok) throw new Error("invitation failed");
        const url = memoryOutboxFor(email).at(-1)!.actionUrl!;
        return new URL(url).searchParams.get("token")!;
      })();
      await acceptInvitationAsNewUser(
        token,
        { name: "Vigente", password: PASSWORD, acceptLegal: true },
        from(),
      );
      const signedIn = await auth.api.signInEmail({
        body: { email, password: PASSWORD },
        headers: from(),
        returnHeaders: true,
      });
      request.cookie = signedIn.headers
        .getSetCookie()
        .map((cookie) => cookie.split(";")[0])
        .join("; ");
      const userId = signedIn.response.user.id;

      await expect(requireSession()).resolves.toMatchObject({
        user: { id: userId },
      });

      const terms = LEGAL_DOCUMENTS.terms as { version: string };
      terms.version = "2099-01-01";
      try {
        expect(await pendingLegalDocuments(userId)).toEqual(["terms"]);
        await expect(requireSession()).rejects.toThrow(
          "redirect:/acepta-terminos",
        );
        // The acceptance screen itself still opens.
        await expect(
          requireSession({ allowPendingLegal: true }),
        ).resolves.toMatchObject({ user: { id: userId } });

        expect(
          await acceptLegalDocuments(
            userId,
            { accept: false },
            { ipAddress: null, userAgent: null },
          ),
        ).toMatchObject({ ok: false });
        expect(await acceptances(userId)).toHaveLength(2);

        expect(
          await acceptLegalDocuments(
            userId,
            { accept: true },
            { ipAddress: "203.0.113.5", userAgent: "Otro navegador" },
          ),
        ).toEqual({ ok: true });
        // The old acceptance stays; the new version is a new row.
        expect(await acceptances(userId)).toMatchObject([
          { document: "privacy", version: current.privacy },
          { document: "terms", version: current.terms },
          {
            document: "terms",
            version: "2099-01-01",
            ipAddress: "203.0.113.5",
          },
        ]);
        await expect(requireSession()).resolves.toMatchObject({
          user: { id: userId },
        });
        // Accepting twice keeps the first acceptance.
        await acceptLegalDocuments(
          userId,
          { accept: true },
          { ipAddress: null, userAgent: null },
        );
        expect(await acceptances(userId)).toHaveLength(3);
      } finally {
        terms.version = current.terms;
        request.cookie = "";
      }
    },
    SLOW,
  );

  it("acceptances cannot be changed or deleted", async () => {
    const userId = newId();
    await acceptLegalDocuments(
      userId,
      { accept: true },
      { ipAddress: null, userAgent: null },
    );
    await expect(
      db.legalAcceptance.updateMany({
        where: { userId },
        data: { version: "2000-01-01" },
      }),
    ).rejects.toThrow(/append-only/);
    await expect(
      db.legalAcceptance.deleteMany({ where: { userId } }),
    ).rejects.toThrow(/append-only/);
  });
});
