import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  OWNER_ONLY_PERMISSIONS,
  PERMISSIONS,
  assertAllowed,
  assertOwnerAction,
  assignRoles,
  cancelInvitation,
  createInvitation,
  disableMember,
  isAllowed,
  offerOwnershipTransfer,
  resendInvitation,
  type Permission,
  type Role,
} from "@/platform/authorization";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

import { grantSeats } from "../setup/plan";

// USR-10: negative tests by role, through the same guards the screens and
// services use, with real members in the database. Consulta does not
// write; Almacén does not buy; Administrador does not charge.

const stamp = Date.now();
let counter = 0;

async function newUser(label: string) {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: label,
      email: `${label}.${++counter}.neg.${stamp}@example.test`,
      emailVerified: true,
      twoFactorEnabled: true,
    },
  });
  return user.id;
}

async function addMember(
  organizationId: string,
  roles: Role[],
  status: "ACTIVE" | "DISABLED" = "ACTIVE",
) {
  const userId = await newUser(roles.join("-") || "sin-rol");
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId, status },
  });
  for (const role of roles) {
    await db.membershipRole.create({
      data: { id: newId(), organizationId, membershipId: membership.id, role },
    });
  }
  return userId;
}

async function newCompany(name: string) {
  const owner = await newUser("titular");
  const created = await createOrganization(owner, { name, timeZone: "" });
  if (!created.ok) throw new Error("company setup failed");
  await grantSeats(created.organizationId);
  return { org: created.organizationId, owner };
}

const READS = /\.(read)$/;
const writes = (prefix: string) =>
  PERMISSIONS.filter((p) => p.startsWith(prefix) && !READS.test(p));

async function denied(org: string, userId: string, permission: Permission) {
  expect(await isAllowed(org, userId, permission), permission).toBe(false);
  await expect(
    assertAllowed(org, userId, permission),
    permission,
  ).rejects.toMatchObject({ kind: "forbidden", code: "permission_denied" });
}

let org = "";
let owner = "";
let admin = "";
let warehouse = "";
let buyer = "";
let viewer = "";
let other = { org: "", owner: "" };

beforeAll(async () => {
  ({ org, owner } = await newCompany("Ferretería La Esperanza"));
  other = await newCompany("Ferretería Ajena");
  admin = await addMember(org, ["administrator"]);
  warehouse = await addMember(org, ["warehouse"]);
  buyer = await addMember(org, ["buyer"]);
  viewer = await addMember(org, ["viewer"]);
});

afterAll(async () => {
  await db.$disconnect();
});

describe("Consulta no escribe (NEG-01, NEG-02)", () => {
  it("is denied every write of Inventario", async () => {
    const allowed = new Set<Permission>(["inventory.export.create"]);
    for (const permission of writes("inventory.")) {
      if (!allowed.has(permission)) await denied(org, viewer, permission);
    }
  });

  it("is denied every write of Compras, including sending an order", async () => {
    const allowed = new Set<Permission>(["purchasing.report.export"]);
    for (const permission of writes("purchasing.")) {
      if (!allowed.has(permission)) await denied(org, viewer, permission);
    }
    await denied(org, viewer, "purchasing.order.send");
    await denied(org, viewer, "purchasing.order.export");
  });

  it("cannot import: reading and exporting do not become importing", async () => {
    for (const permission of [
      "inventory.import.create",
      "inventory.import.read",
      "inventory.import.confirm",
      "inventory.import.cancel",
    ] as const) {
      await denied(org, viewer, permission);
    }
    expect(await isAllowed(org, viewer, "inventory.export.create")).toBe(true);
  });

  it("is denied every change of the company, the team and the plan", async () => {
    for (const permission of writes("platform.")) {
      await denied(org, viewer, permission);
    }
    for (const permission of [
      "platform.team.read",
      "platform.audit.read",
      "platform.billing.read",
      "platform.plan.read",
    ] as const) {
      await denied(org, viewer, permission);
    }
  });

  it("cannot change the team through the services either", async () => {
    expect(
      await createInvitation(org, viewer, {
        email: `x.${stamp}@example.test`,
        roles: ["viewer"],
      }),
    ).toMatchObject({ ok: false });
    expect(
      await assignRoles(org, viewer, { userId: buyer, roles: ["viewer"] }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
    expect(await disableMember(org, viewer, { userId: buyer })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });
    expect(
      await assignRoles(org, viewer, {
        userId: viewer,
        roles: ["administrator"],
      }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
  });
});

describe("Almacén no compra (NEG-03, NEG-04)", () => {
  it("is denied every permission of Compras, reads included", async () => {
    for (const permission of PERMISSIONS.filter((p) =>
      p.startsWith("purchasing."),
    )) {
      await denied(org, warehouse, permission);
    }
  });

  it("does not receive, return or see costs although it moves stock", async () => {
    expect(await isAllowed(org, warehouse, "inventory.entry.create")).toBe(
      true,
    );
    for (const permission of [
      "purchasing.receipt.create",
      "purchasing.return.create",
      "purchasing.cost.read",
      "purchasing.suggestion.generate",
    ] as const) {
      await denied(org, warehouse, permission);
    }
  });

  it("Consulta does not see costs either", async () => {
    await denied(org, viewer, "purchasing.cost.read");
    await denied(org, viewer, "purchasing.cost.record");
  });
});

describe("Comprador no mueve inventario a mano (NEG-05)", () => {
  it("is denied products, manual movements, adjustments and counts", async () => {
    for (const permission of [
      "inventory.product.create",
      "inventory.product.update",
      "inventory.presentation.update",
      "inventory.entry.create",
      "inventory.exit.create",
      "inventory.transfer.create",
      "inventory.adjustment.create",
      "inventory.movement.reverse",
      "inventory.count.create",
      "inventory.count.apply",
      "inventory.import.confirm",
    ] as const) {
      await denied(org, buyer, permission);
    }
    expect(await isAllowed(org, buyer, "purchasing.receipt.create")).toBe(true);
  });
});

describe("Administrador no cobra (NEG-06, NEG-07, NEG-08, NEG-09)", () => {
  it("is denied contracting, cancelling, payment, plan and modules, even with every role", async () => {
    const everyRole = await addMember(org, [
      "administrator",
      "warehouse",
      "buyer",
      "viewer",
    ]);
    for (const userId of [admin, everyRole]) {
      for (const permission of OWNER_ONLY_PERMISSIONS) {
        await denied(org, userId, permission);
        await expect(
          assertOwnerAction(org, userId, permission),
        ).rejects.toMatchObject({ code: "owner_only" });
      }
    }
  });

  it("cannot take the company, disable or demote the titular", async () => {
    expect(
      await offerOwnershipTransfer(org, admin, { toUserId: admin }),
    ).toMatchObject({ ok: false, reason: "not_owner" });
    expect(await disableMember(org, admin, { userId: owner })).toMatchObject({
      ok: false,
      reason: "owner_protected",
    });
    expect(
      await assignRoles(org, admin, { userId: owner, roles: ["viewer"] }),
    ).toMatchObject({ ok: false, reason: "owner_protected" });
    expect(
      (await db.organization.findUniqueOrThrow({ where: { id: org } }))
        .ownerUserId,
    ).toBe(owner);
  });

  it("cannot raise itself, invite a titular or name administrators", async () => {
    expect(
      await assignRoles(org, admin, {
        userId: admin,
        roles: ["administrator", "buyer"],
      }),
    ).toMatchObject({ ok: false, reason: "self" });
    for (const roles of [["owner"], ["titular"], ["administrator"]]) {
      expect(
        await createInvitation(org, admin, {
          email: `rol.${++counter}.${stamp}@example.test`,
          roles,
        }),
      ).toMatchObject({ ok: false });
    }
    expect(
      await assignRoles(org, admin, {
        userId: viewer,
        roles: ["administrator"],
      }),
    ).toMatchObject({ ok: false, reason: "administrator_reserved" });
  });

  it("cannot resend or cancel the invitation of an administrator", async () => {
    const invitation = await createInvitation(org, owner, {
      email: `admin.${stamp}@example.test`,
      roles: ["administrator"],
    });
    if (!invitation.ok) throw new Error("invitation failed");
    expect(
      await resendInvitation(org, admin, invitation.invitationId),
    ).toMatchObject({ ok: false });
    expect(
      await cancelInvitation(org, admin, invitation.invitationId),
    ).toMatchObject({ ok: false });
    expect(
      (
        await db.invitation.findUniqueOrThrow({
          where: { id: invitation.invitationId },
        })
      ).status,
    ).toBe("PENDING");
  });
});

describe("nobody reaches the platform or another company (NEG-10 to NEG-13)", () => {
  it("no client role provisions the platform, not even the titular", async () => {
    for (const userId of [owner, admin, warehouse, buyer, viewer]) {
      await denied(org, userId, "platform.provisioning.manage");
    }
  });

  it("without an active membership every permission is denied", async () => {
    const outsider = await newUser("ajeno");
    const disabled = await addMember(org, ["administrator"], "DISABLED");
    const noRoles = await addMember(org, []);
    for (const userId of [outsider, disabled, noRoles]) {
      for (const permission of PERMISSIONS) {
        expect(await isAllowed(org, userId, permission), permission).toBe(
          false,
        );
      }
    }
  });

  it("roles of one company give nothing in another", async () => {
    for (const userId of [owner, admin]) {
      for (const permission of PERMISSIONS) {
        expect(await isAllowed(other.org, userId, permission), permission).toBe(
          false,
        );
      }
    }
    expect(
      await disableMember(other.org, owner, { userId: other.owner }),
    ).toMatchObject({ ok: false, reason: "forbidden" });
  });

  it("unknown permissions and roles sent by the client count for nothing", async () => {
    for (const permission of ["inventory.*", "*", "platform.owner", ""]) {
      expect(await isAllowed(org, owner, permission as Permission)).toBe(false);
    }
    // Asking for a role does not grant it: only stored assignments count.
    expect(
      await assignRoles(org, warehouse, {
        userId: warehouse,
        roles: ["administrator"],
      }),
    ).toMatchObject({ ok: false });
    await denied(org, warehouse, "platform.team.invite");
  });
});

// Every negative case of the approved matrix is either tested today or
// waits for the step that builds what it talks about. A new case in the
// document fails here until it is placed.
const NEGATIVE_CASES: Record<string, { tests?: string[]; waitsFor?: string }> =
  {
    "NEG-01": { tests: ["tests/platform/negative-by-role.int.test.ts"] },
    "NEG-02": { tests: ["tests/platform/negative-by-role.int.test.ts"] },
    "NEG-03": { tests: ["tests/platform/negative-by-role.int.test.ts"] },
    "NEG-04": {
      tests: ["tests/platform/negative-by-role.int.test.ts"],
      waitsFor: "CMP-16 (campos de costo en respuestas, PDF y exportaciones)",
    },
    "NEG-05": { tests: ["tests/platform/negative-by-role.int.test.ts"] },
    "NEG-06": { tests: ["tests/platform/negative-by-role.int.test.ts"] },
    "NEG-07": {
      tests: [
        "tests/platform/negative-by-role.int.test.ts",
        "src/platform/authorization/team-rules.test.ts",
      ],
    },
    "NEG-08": {
      tests: [
        "tests/platform/negative-by-role.int.test.ts",
        "tests/platform/team.int.test.ts",
      ],
    },
    "NEG-09": { tests: ["tests/platform/invitations.int.test.ts"] },
    "NEG-10": {
      tests: [
        "tests/platform/negative-by-role.int.test.ts",
        "tests/platform/provisioning.int.test.ts",
      ],
    },
    "NEG-11": {
      tests: [
        "tests/platform/negative-by-role.int.test.ts",
        "tests/platform/team-disable.int.test.ts",
        "tests/platform/organization-context.int.test.ts",
      ],
    },
    "NEG-12": { tests: ["tests/isolation/two-companies.int.test.ts"] },
    "NEG-13": { tests: ["tests/platform/negative-by-role.int.test.ts"] },
    "NEG-14": { tests: ["tests/platform/invitation-accept.int.test.ts"] },
    "NEG-15": { tests: ["tests/platform/seats.int.test.ts"] },
    "NEG-16": {
      tests: [
        "tests/platform/module-guard.int.test.ts",
        "tests/platform/subscription-states.int.test.ts",
      ],
    },
    "NEG-17": { tests: ["tests/platform/module-activation.int.test.ts"] },
    "NEG-18": { tests: ["tests/platform/subscription-states.int.test.ts"] },
    "NEG-19": {
      tests: [
        "tests/platform/quota.int.test.ts",
        "tests/platform/products.int.test.ts",
        "tests/platform/product-archive.int.test.ts",
      ],
      waitsFor: "IMP (importaciones que reservan cupo)",
    },
    "NEG-20": { waitsFor: "IMP (trabajos en segundo plano)" },
    "NEG-21": { waitsFor: "INV (movimientos y archivo)" },
    "NEG-22": { waitsFor: "INV (reversas)" },
    "NEG-23": { waitsFor: "INV (conteos)" },
    "NEG-24": { waitsFor: "CMP (recepciones y devoluciones)" },
    "NEG-25": { waitsFor: "CMP-16 e IMP (exportaciones y PDF)" },
    "NEG-26": { tests: ["tests/platform/ownership.int.test.ts"] },
  };

describe("negative cases of the matrix", () => {
  const doc = readFileSync(
    path.join(process.cwd(), "docs/MATRIZ_ROLES_PERMISOS.md"),
    "utf8",
  );
  const ids = [...doc.matchAll(/^\| (NEG-\d+) \|/gm)].map((m) => m[1]!);

  it("every case of the document is tested or waits for a named step", () => {
    expect(ids.length).toBeGreaterThanOrEqual(26);
    expect(Object.keys(NEGATIVE_CASES).sort()).toEqual([...ids].sort());
    for (const [id, entry] of Object.entries(NEGATIVE_CASES)) {
      expect(Boolean(entry.tests?.length || entry.waitsFor), id).toBe(true);
      for (const file of entry.tests ?? []) {
        expect(existsSync(path.join(process.cwd(), file)), file).toBe(true);
      }
    }
  });
});
