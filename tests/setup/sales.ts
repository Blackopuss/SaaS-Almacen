import { newId } from "@/lib";
import { hashPassword } from "@/platform/auth/password";
import { moduleRegistry } from "@/modules/registry";
import type { Role } from "@/platform/authorization";
import { provisionCompany } from "@/platform/billing";
import { invalidateEntitlements } from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db } from "@/server";

/**
 * A company with Inventario and Ventas for the tests of Ventas (VEN). Ventas
 * cannot be contracted yet (VEN-02: unavailable until a sale works end to
 * end), so its right is written here directly, as only tests may.
 */

const stamp = Date.now();
let counter = 0;
let staff = "";

export async function newPerson(label = "persona") {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: label,
      email: `ventas.${label}.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  return user.id;
}

export async function salesCompany(
  options: { productLimit?: number; purchasing?: boolean } = {},
) {
  const owner = await newPerson("titular");
  const created = await createOrganization(owner, {
    name: `Ferretería ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  if (!staff) {
    staff = await newPerson("plataforma");
    await db.platformStaff.create({ data: { userId: staff } });
  }
  const provisioned = await provisionCompany(
    moduleRegistry,
    staff,
    created.organizationId,
    {
      productLimit: options.productLimit ?? 30,
      users: 10,
      modules: options.purchasing ? ["inventory", "purchasing"] : ["inventory"],
      validUntil: null,
      reason: "Prueba de ventas",
    },
  );
  if (!provisioned.ok) throw new Error("provision failed");
  await db.entitlement.create({
    data: {
      id: newId(),
      organizationId: created.organizationId,
      kind: "MODULE",
      key: "sales",
      validFrom: new Date(Date.now() - 60_000),
    },
  });
  invalidateEntitlements(created.organizationId);
  return { organizationId: created.organizationId, userId: owner };
}

export async function salesMember(organizationId: string, role: Role) {
  const userId = await newPerson(role);
  const membership = await db.membership.create({
    data: { id: newId(), organizationId, userId },
  });
  await db.membershipRole.create({
    data: { id: newId(), organizationId, membershipId: membership.id, role },
  });
  return { organizationId, userId };
}

/** Gives a test person a password, to type it where one is asked. */
export async function withPassword(userId: string, password: string) {
  await db.account.create({
    data: {
      id: newId(),
      userId,
      providerId: "credential",
      accountId: userId,
      password: await hashPassword(password),
    },
  });
}
