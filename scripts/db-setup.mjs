// Creates local databases and least-privilege users (BAS-03). Idempotent.
// Usage: npm run db:setup  (needs MYSQL_ROOT_PASSWORD in .env.local)
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync } from "node:fs";
import mariadb from "mariadb";

const ENV_FILE = ".env.local";
if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);

const rootPassword = process.env.MYSQL_ROOT_PASSWORD;
if (!rootPassword) {
  console.error(`Falta MYSQL_ROOT_PASSWORD en ${ENV_FILE}.`);
  process.exit(1);
}

const defaults = {
  DATABASE_HOST: "127.0.0.1",
  DATABASE_PORT: "3306",
  DATABASE_NAME: "almacen_dev",
  DATABASE_TEST_NAME: "almacen_test",
  DATABASE_SHADOW_NAME: "almacen_shadow",
  DATABASE_APP_USER: "almacen_app",
  DATABASE_MIGRATOR_USER: "almacen_migrator",
};
const generated = ["DATABASE_APP_PASSWORD", "DATABASE_MIGRATOR_PASSWORD"];

// Fill missing values in .env.local; passwords are random and never printed.
const added = [];
for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) added.push([key, value]);
}
for (const key of generated) {
  if (!process.env[key])
    added.push([key, randomBytes(24).toString("base64url")]);
}
if (added.length > 0) {
  appendFileSync(
    ENV_FILE,
    "\n" + added.map(([k, v]) => `${k}=${v}`).join("\n") + "\n",
  );
  for (const [k, v] of added) process.env[k] = v;
  console.log(`Agregadas a ${ENV_FILE}: ${added.map(([k]) => k).join(", ")}`);
}

const env = (key) => process.env[key];
const ident = (name) => {
  if (!/^[A-Za-z0-9_]+$/.test(name))
    throw new Error(`Nombre inválido: ${name}`);
  return `\`${name}\``;
};
const host = env("DATABASE_HOST");
if (!/^[A-Za-z0-9.:-]+$/.test(host)) throw new Error(`Host inválido: ${host}`);
// Host the MySQL accounts accept connections from. Locally the same as
// DATABASE_HOST; in CI the server sees the Docker gateway, so CI uses "%".
const userHost = env("DATABASE_USER_HOST") ?? host;
if (!/^[A-Za-z0-9.:%-]+$/.test(userHost)) {
  throw new Error(`Host de usuarios inválido: ${userHost}`);
}
const account = (user) => `'${user}'@'${userHost}'`;

const conn = await mariadb.createConnection({
  host,
  port: Number(env("DATABASE_PORT")),
  user: "root",
  password: rootPassword,
  allowPublicKeyRetrieval: true,
});

try {
  const app = env("DATABASE_APP_USER");
  const migrator = env("DATABASE_MIGRATOR_USER");
  ident(app);
  ident(migrator);
  const appDbs = [env("DATABASE_NAME"), env("DATABASE_TEST_NAME")];
  const allDbs = [...appDbs, env("DATABASE_SHADOW_NAME")];

  for (const db of allDbs) {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS ${ident(db)} CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  }

  for (const [user, password] of [
    [app, env("DATABASE_APP_PASSWORD")],
    [migrator, env("DATABASE_MIGRATOR_PASSWORD")],
  ]) {
    await conn.query(
      `CREATE USER IF NOT EXISTS ${account(user)} IDENTIFIED BY ?`,
      [password],
    );
    await conn.query(`ALTER USER ${account(user)} IDENTIFIED BY ?`, [password]);
  }

  // The application can only read and write data; it cannot change the schema.
  for (const db of appDbs) {
    await conn.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ${ident(db)}.* TO ${account(app)}`,
    );
  }
  // The migrator owns schema changes, including the shadow database.
  for (const db of allDbs) {
    await conn.query(
      `GRANT ALL PRIVILEGES ON ${ident(db)}.* TO ${account(migrator)}`,
    );
  }

  // The migrator creates triggers (append-only audit log, PLT-14). With
  // binary logging on, MySQL requires this instead of SUPER. Managed MySQL
  // services expose it as a server parameter (see docs/adr/0002).
  await conn.query("SET PERSIST log_bin_trust_function_creators = 1");

  console.log(`Bases listas: ${allDbs.join(", ")}`);
  console.log(`Usuarios listos: ${app} (datos), ${migrator} (esquema)`);
} finally {
  await conn.end();
}
