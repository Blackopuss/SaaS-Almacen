import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  ENTITLEMENT_CACHE_MS,
  getEntitlements,
  getFreshEntitlements,
  invalidateEntitlements,
  setEntitlementClock,
} from "@/platform/billing";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// MOD-04: company → active modules and limits, with a cache that can be
// invalidated and never outlives a right that expired.

const stamp = Date.now();
let counter = 0;
const HOUR = 3_600_000;

async function newCompany() {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Titular",
      email: `derechos.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  const created = await createOrganization(user.id, {
    name: `Empresa ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  return created.organizationId;
}

async function grant(
  organizationId: string,
  key: string,
  options: { value?: number; from?: number; until?: number | null } = {},
) {
  return forOrganization(organizationId).entitlement.create({
    data: {
      id: newId(),
      organizationId,
      kind: options.value === undefined ? "MODULE" : "LIMIT",
      key,
      ...(options.value === undefined ? {} : { value: options.value }),
      validFrom: new Date(Date.now() + (options.from ?? -HOUR)),
      validUntil:
        options.until === undefined || options.until === null
          ? null
          : new Date(Date.now() + options.until),
    },
  });
}

let restoreClock: (() => void) | null = null;
/** Moves the service's clock forward without waiting. */
function travel(ms: number) {
  restoreClock?.();
  restoreClock = setEntitlementClock(() => Date.now() + ms);
}

let org = "";
let other = "";

beforeAll(async () => {
  org = await newCompany();
  other = await newCompany();
});

afterEach(() => {
  restoreClock?.();
  restoreClock = null;
  invalidateEntitlements();
});

afterAll(async () => {
  await db.$disconnect();
});

describe("getEntitlements", () => {
  it("a company without entitlements has no modules and no limits", async () => {
    const entitlements = await getEntitlements(await newCompany());
    expect([...entitlements.modules]).toEqual([]);
    expect(entitlements.hasModule("inventory")).toBe(false);
    expect(entitlements.limit("active_products")).toBeNull();
  });

  it("returns active modules and limits of the company only", async () => {
    await grant(org, "inventory");
    await grant(org, "purchasing");
    await grant(org, "active_products", { value: 1000 });
    await grant(org, "users", { value: 5 });
    await grant(other, "inventory");
    await grant(other, "active_products", { value: 100 });

    const mine = await getFreshEntitlements(org);
    expect([...mine.modules].sort()).toEqual(["inventory", "purchasing"]);
    expect(mine.limit("active_products")).toBe(1000);
    expect(mine.limit("users")).toBe(5);

    const theirs = await getFreshEntitlements(other);
    expect([...theirs.modules]).toEqual(["inventory"]);
    expect(theirs.hasModule("purchasing")).toBe(false);
    expect(theirs.limit("active_products")).toBe(100);
    expect(theirs.limit("users")).toBeNull();
  });

  it("ignores rights that have not started or already ended", async () => {
    const company = await newCompany();
    await grant(company, "inventory", { until: HOUR });
    await grant(company, "purchasing", { from: HOUR });
    await grant(company, "sales", { from: -2 * HOUR, until: -HOUR });
    await grant(company, "active_products", {
      value: 500,
      from: -2 * HOUR,
      until: -HOUR,
    });
    const entitlements = await getEntitlements(company);
    expect([...entitlements.modules]).toEqual(["inventory"]);
    expect(entitlements.limit("active_products")).toBeNull();
  });

  it("a limit of zero is a limit, not a missing one", async () => {
    const company = await newCompany();
    await grant(company, "active_products", { value: 0 });
    expect((await getEntitlements(company)).limit("active_products")).toBe(0);
  });
});

describe("cache", () => {
  it("serves from memory until it is invalidated", async () => {
    const company = await newCompany();
    await grant(company, "inventory");
    expect((await getEntitlements(company)).hasModule("purchasing")).toBe(
      false,
    );

    await grant(company, "purchasing");
    // Still the cached answer…
    expect((await getEntitlements(company)).hasModule("purchasing")).toBe(
      false,
    );
    // …until whoever wrote invalidates it.
    invalidateEntitlements(company);
    expect((await getEntitlements(company)).hasModule("purchasing")).toBe(true);
  });

  it("invalidating one company keeps the others cached", async () => {
    const a = await newCompany();
    const b = await newCompany();
    await getEntitlements(a);
    await getEntitlements(b);
    await grant(a, "inventory");
    await grant(b, "inventory");
    invalidateEntitlements(a);
    expect((await getEntitlements(a)).hasModule("inventory")).toBe(true);
    expect((await getEntitlements(b)).hasModule("inventory")).toBe(false);
  });

  it("refreshes by itself after the cache time", async () => {
    const company = await newCompany();
    await getEntitlements(company);
    await grant(company, "inventory");
    travel(ENTITLEMENT_CACHE_MS - 1000);
    expect((await getEntitlements(company)).hasModule("inventory")).toBe(false);
    travel(ENTITLEMENT_CACHE_MS + 1);
    expect((await getEntitlements(company)).hasModule("inventory")).toBe(true);
  });

  it("a cached right stops counting the moment it expires", async () => {
    const company = await newCompany();
    await grant(company, "inventory", { until: 5000 });
    expect((await getEntitlements(company)).hasModule("inventory")).toBe(true);
    // 6 seconds later, still inside the cache time, without reloading.
    travel(6000);
    expect((await getEntitlements(company)).hasModule("inventory")).toBe(false);
  });

  it("a cached right that starts later begins on time", async () => {
    const company = await newCompany();
    await grant(company, "purchasing", { from: 5000 });
    expect((await getEntitlements(company)).hasModule("purchasing")).toBe(
      false,
    );
    travel(6000);
    expect((await getEntitlements(company)).hasModule("purchasing")).toBe(true);
  });

  it("getFreshEntitlements always reads the database", async () => {
    const company = await newCompany();
    await getEntitlements(company);
    await grant(company, "active_products", { value: 100 });
    expect((await getFreshEntitlements(company)).limit("active_products")).toBe(
      100,
    );
  });

  it("removing a right takes effect after invalidating", async () => {
    const company = await newCompany();
    const row = await grant(company, "purchasing");
    expect((await getEntitlements(company)).hasModule("purchasing")).toBe(true);
    await forOrganization(company).entitlement.delete({
      where: { id: row.id },
    });
    invalidateEntitlements(company);
    expect((await getEntitlements(company)).hasModule("purchasing")).toBe(
      false,
    );
  });
});
