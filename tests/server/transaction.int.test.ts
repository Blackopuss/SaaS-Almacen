import type mariadb from "mariadb";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { db } from "@/server";

import { migratorConnection } from "../setup/test-db";

// A throwaway table: the schema has no business models yet (PLT-01).
const PROBE = "__tx_probe";

let admin: mariadb.Connection;

async function count(): Promise<number> {
  const rows = await db.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM ${PROBE}`,
  );
  return Number(rows[0]?.n ?? 0);
}

beforeAll(async () => {
  admin = await migratorConnection();
  await admin.query(
    `CREATE TABLE IF NOT EXISTS ${PROBE} (id INT PRIMARY KEY, label VARCHAR(20) NOT NULL) ENGINE=InnoDB`,
  );
});

beforeEach(async () => {
  await admin.query(`DELETE FROM ${PROBE}`);
});

afterAll(async () => {
  await admin.query(`DROP TABLE IF EXISTS ${PROBE}`);
  await admin.end();
  await db.$disconnect();
});

describe("database transactions (app user)", () => {
  it("connects to the test database", async () => {
    const rows = await db.$queryRaw<
      { name: string }[]
    >`SELECT DATABASE() AS name`;
    expect(rows[0]?.name).toMatch(/_test$/);
  });

  it("commits all writes when the transaction succeeds", async () => {
    await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`INSERT INTO ${PROBE} VALUES (1, 'a')`);
      await tx.$executeRawUnsafe(`INSERT INTO ${PROBE} VALUES (2, 'b')`);
    });
    expect(await count()).toBe(2);
  });

  it("rolls back every write when the transaction fails", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${PROBE} VALUES (1, 'a')`);
        throw new Error("business rule failed");
      }),
    ).rejects.toThrow("business rule failed");
    expect(await count()).toBe(0);
  });

  it("rolls back when a later statement violates a constraint", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`INSERT INTO ${PROBE} VALUES (1, 'a')`);
        await tx.$executeRawUnsafe(`INSERT INTO ${PROBE} VALUES (1, 'dup')`);
      }),
    ).rejects.toThrow();
    expect(await count()).toBe(0);
  });

  it("cannot change the schema as the app user", async () => {
    await expect(
      db.$executeRawUnsafe("CREATE TABLE __should_fail (id INT)"),
    ).rejects.toThrow();
  });
});
