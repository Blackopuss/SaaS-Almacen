import { afterAll, afterEach, describe, expect, it } from "vitest";

import { newId } from "@/lib";
import {
  confirmReservation,
  consumeQuota,
  getQuotaUsage,
  invalidateEntitlements,
  releaseQuota,
  releaseReservation,
  reserveQuota,
} from "@/platform/entitlements";
import { createOrganization } from "@/platform/tenancy";
import { db, forOrganization } from "@/server";

// MOD-07: product quota counter with concurrency control. With 99 of 100,
// two simultaneous requests allow exactly one.

const stamp = Date.now();
let counter = 0;
const KEY = "active_products";

/** Company with a product limit and some places already used. */
async function company(limit: number | null, used = 0) {
  const user = await db.user.create({
    data: {
      id: newId(),
      name: "Titular",
      email: `cupo.${++counter}.${stamp}@example.test`,
      emailVerified: true,
    },
  });
  const created = await createOrganization(user.id, {
    name: `Empresa ${counter}`,
    timeZone: "",
  });
  if (!created.ok) throw new Error("company setup failed");
  const org = created.organizationId;
  if (limit !== null) await setLimit(org, limit);
  if (used > 0) {
    const result = await consumeQuota(forOrganization(org), org, KEY, used);
    if (!result.ok) throw new Error("setup over the limit");
  }
  return org;
}

async function setLimit(org: string, value: number) {
  await forOrganization(org).entitlement.upsert({
    where: {
      organizationId_kind_key: { organizationId: org, kind: "LIMIT", key: KEY },
    },
    update: { value },
    create: {
      id: newId(),
      organizationId: org,
      kind: "LIMIT",
      key: KEY,
      value,
      validFrom: new Date(Date.now() - 60_000),
    },
  });
  invalidateEntitlements(org);
}

const usage = (org: string) => getQuotaUsage(org, KEY);

afterEach(() => invalidateEntitlements());

afterAll(async () => {
  await db.$disconnect();
});

describe("consumeQuota", () => {
  it("with 99 of 100, two simultaneous requests allow exactly one", async () => {
    const org = await company(100, 99);
    const results = await Promise.all([
      consumeQuota(forOrganization(org), org, KEY),
      consumeQuota(forOrganization(org), org, KEY),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toEqual({
      ok: false,
      reason: "limit_reached",
      limit: 100,
      taken: 100,
    });
    expect(await usage(org)).toEqual({
      limit: 100,
      used: 100,
      reserved: 0,
      available: 0,
    });
  });

  it("with 5 places left, 25 simultaneous requests allow exactly 5", async () => {
    const org = await company(100, 95);
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        consumeQuota(forOrganization(org), org, KEY),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect((await usage(org)).used).toBe(100);
  });

  it("the very first simultaneous requests of a company do not lose count", async () => {
    const org = await company(3);
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        consumeQuota(forOrganization(org), org, KEY),
      ),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await db.quotaUsage.count({ where: { organizationId: org } })).toBe(
      1,
    );
  });

  it("takes several places at once only if all of them fit", async () => {
    const org = await company(100, 90);
    expect(
      await consumeQuota(forOrganization(org), org, KEY, 11),
    ).toMatchObject({ ok: false, limit: 100, taken: 90 });
    expect(await consumeQuota(forOrganization(org), org, KEY, 10)).toEqual({
      ok: true,
    });
    expect((await usage(org)).available).toBe(0);
  });

  it("a transaction that fails does not consume the place", async () => {
    const org = await company(100, 99);
    await expect(
      forOrganization(org).$transaction(async (tx) => {
        const result = await consumeQuota(tx, org, KEY);
        expect(result.ok).toBe(true);
        throw new Error("the product could not be saved");
      }),
    ).rejects.toThrow("could not be saved");
    expect((await usage(org)).used).toBe(99);
    // The place is still there for the next one.
    expect(await consumeQuota(forOrganization(org), org, KEY)).toEqual({
      ok: true,
    });
  });

  it("without a granted limit nothing fits", async () => {
    const org = await company(null);
    expect(await consumeQuota(forOrganization(org), org, KEY)).toEqual({
      ok: false,
      reason: "limit_reached",
      limit: null,
      taken: 0,
    });
    expect(await usage(org)).toEqual({
      limit: null,
      used: 0,
      reserved: 0,
      available: 0,
    });
  });

  it("each company has its own counter", async () => {
    const a = await company(1, 1);
    const b = await company(1);
    expect((await consumeQuota(forOrganization(a), a, KEY)).ok).toBe(false);
    expect((await consumeQuota(forOrganization(b), b, KEY)).ok).toBe(true);
    // A client of one company cannot write the counter of another.
    await expect(consumeQuota(forOrganization(a), b, KEY)).rejects.toThrow();
  });

  it("a higher limit opens places; a lower one deletes nothing", async () => {
    const org = await company(100, 100);
    expect((await consumeQuota(forOrganization(org), org, KEY)).ok).toBe(false);
    await setLimit(org, 500);
    expect((await consumeQuota(forOrganization(org), org, KEY)).ok).toBe(true);
    await setLimit(org, 50);
    expect(await usage(org)).toEqual({
      limit: 50,
      used: 101,
      reserved: 0,
      available: 0,
    });
    expect((await consumeQuota(forOrganization(org), org, KEY)).ok).toBe(false);
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects the amount %s", async (amount) => {
    const org = await company(10);
    await expect(
      consumeQuota(forOrganization(org), org, KEY, amount),
    ).rejects.toThrow(/Invalid quota amount/);
  });
});

describe("releaseQuota", () => {
  it("archiving frees a place that can be used again", async () => {
    const org = await company(100, 100);
    expect(await releaseQuota(forOrganization(org), KEY)).toBe(true);
    expect((await usage(org)).available).toBe(1);
    expect((await consumeQuota(forOrganization(org), org, KEY)).ok).toBe(true);
  });

  it("cannot free more than is in use", async () => {
    const org = await company(100, 2);
    expect(await releaseQuota(forOrganization(org), KEY, 3)).toBe(false);
    expect((await usage(org)).used).toBe(2);
    const empty = await company(100);
    expect(await releaseQuota(forOrganization(empty), KEY)).toBe(false);
  });

  it("simultaneous releases never go below zero", async () => {
    const org = await company(100, 3);
    const results = await Promise.all(
      Array.from({ length: 10 }, () => releaseQuota(forOrganization(org), KEY)),
    );
    expect(results.filter(Boolean)).toHaveLength(3);
    expect((await usage(org)).used).toBe(0);
  });
});

describe("reservations", () => {
  it("reserved places count against manual additions", async () => {
    const org = await company(100, 90);
    expect(await reserveQuota(forOrganization(org), org, KEY, 8)).toEqual({
      ok: true,
    });
    expect(await usage(org)).toEqual({
      limit: 100,
      used: 90,
      reserved: 8,
      available: 2,
    });
    const manual = await Promise.all(
      Array.from({ length: 5 }, () =>
        consumeQuota(forOrganization(org), org, KEY),
      ),
    );
    expect(manual.filter((r) => r.ok)).toHaveLength(2);
  });

  it("a reservation that does not fit reserves nothing", async () => {
    const org = await company(100, 95);
    expect(await reserveQuota(forOrganization(org), org, KEY, 6)).toMatchObject(
      { ok: false, limit: 100, taken: 95 },
    );
    expect((await usage(org)).reserved).toBe(0);
  });

  it("confirming turns a reserved place into a used one without counting twice", async () => {
    const org = await company(100, 90);
    await reserveQuota(forOrganization(org), org, KEY, 10);
    for (let i = 0; i < 4; i++) {
      expect(await confirmReservation(forOrganization(org), KEY)).toBe(true);
    }
    expect(await usage(org)).toEqual({
      limit: 100,
      used: 94,
      reserved: 6,
      available: 0,
    });
  });

  it("releasing gives back only the reserved places not used", async () => {
    const org = await company(100, 90);
    await reserveQuota(forOrganization(org), org, KEY, 10);
    await confirmReservation(forOrganization(org), KEY, 4);
    expect(await releaseReservation(forOrganization(org), KEY, 7)).toBe(false);
    expect(await releaseReservation(forOrganization(org), KEY, 6)).toBe(true);
    expect(await usage(org)).toEqual({
      limit: 100,
      used: 94,
      reserved: 0,
      available: 6,
    });
    // Nothing left to confirm or release.
    expect(await confirmReservation(forOrganization(org), KEY)).toBe(false);
    expect(await releaseReservation(forOrganization(org), KEY, 1)).toBe(false);
  });

  it("archiving cannot eat into reserved places", async () => {
    const org = await company(100, 1);
    await reserveQuota(forOrganization(org), org, KEY, 5);
    expect(await releaseQuota(forOrganization(org), KEY, 2)).toBe(false);
    expect(await releaseQuota(forOrganization(org), KEY, 1)).toBe(true);
    expect(await usage(org)).toMatchObject({ used: 0, reserved: 5 });
  });

  it("two simultaneous reservations for the same room allow one", async () => {
    const org = await company(100, 90);
    const results = await Promise.all([
      reserveQuota(forOrganization(org), org, KEY, 8),
      reserveQuota(forOrganization(org), org, KEY, 8),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await usage(org)).reserved).toBe(8);
  });
});

describe("the database protects the counter", () => {
  it("rejects impossible values written with SQL", async () => {
    const org = await company(100, 5);
    await expect(
      db.$executeRaw`UPDATE quota_usage SET taken = -1 WHERE organizationId = ${org}`,
    ).rejects.toThrow(/quota_usage_values_check/);
    await expect(
      db.$executeRaw`UPDATE quota_usage SET reserved = 6 WHERE organizationId = ${org}`,
    ).rejects.toThrow(/quota_usage_values_check/);
  });
});
