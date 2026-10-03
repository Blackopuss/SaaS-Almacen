// Verifies the local database setup (BAS-03): the app user can read and
// write data but cannot change the schema. Usage: npm run db:check
import { existsSync } from "node:fs";
import mariadb from "mariadb";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const env = process.env;

const conn = await mariadb.createConnection({
  host: env.DATABASE_HOST,
  port: Number(env.DATABASE_PORT ?? 3306),
  user: env.DATABASE_APP_USER,
  password: env.DATABASE_APP_PASSWORD,
  database: env.DATABASE_NAME,
  allowPublicKeyRetrieval: true,
});

let failures = 0;
const check = (ok, label) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

try {
  const [row] = await conn.query("SELECT VERSION() AS version");
  check(Boolean(row?.version), `app user connects (MySQL ${row?.version})`);

  const [migrations] = await conn.query(
    "SELECT COUNT(*) AS n FROM _prisma_migrations WHERE finished_at IS NOT NULL",
  );
  check(Number(migrations.n) > 0, "migrations are applied");

  let denied = false;
  try {
    await conn.query("CREATE TABLE __privilege_probe (id INT)");
    await conn.query("DROP TABLE __privilege_probe");
  } catch (error) {
    denied = error?.code === "ER_TABLEACCESS_DENIED_ERROR";
  }
  check(denied, "app user cannot change the schema");
} finally {
  await conn.end();
}

if (failures > 0) process.exit(1);
