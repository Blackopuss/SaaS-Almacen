import { execSync } from "node:child_process";

import { migratorConnection, testDatabaseName } from "./test-db";

/**
 * Runs once before integration tests: applies migrations to the test
 * database and empties every table so each run starts from a clean state.
 */
export default async function setup(): Promise<void> {
  const database = testDatabaseName();

  execSync("npx prisma migrate deploy", {
    stdio: "pipe",
    env: { ...process.env, DATABASE_NAME: database },
  });

  const conn = await migratorConnection();
  try {
    const tables: { name: string }[] = await conn.query(
      `SELECT table_name AS name FROM information_schema.tables
       WHERE table_schema = ? AND table_type = 'BASE TABLE'
         AND table_name <> '_prisma_migrations'`,
      [database],
    );
    await conn.query("SET FOREIGN_KEY_CHECKS = 0");
    for (const { name } of tables) {
      await conn.query(`TRUNCATE TABLE \`${name}\``);
    }
    await conn.query("SET FOREIGN_KEY_CHECKS = 1");
  } finally {
    await conn.end();
  }
}
