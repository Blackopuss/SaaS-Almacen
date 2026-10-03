import mariadb from "mariadb";

/** Name of the database integration tests run against. */
export function testDatabaseName(): string {
  const name = process.env.DATABASE_NAME ?? "";
  // Safety net: never migrate or wipe a database that is not a test database.
  if (!/^[A-Za-z0-9_]+_test$/.test(name)) {
    throw new Error(
      `Integration tests require a *_test database, got "${name}".`,
    );
  }
  return name;
}

/** Connection with schema privileges, for setup and test fixtures only. */
export function migratorConnection(): Promise<mariadb.Connection> {
  return mariadb.createConnection({
    host: process.env.DATABASE_HOST,
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: process.env.DATABASE_MIGRATOR_USER,
    password: process.env.DATABASE_MIGRATOR_PASSWORD,
    database: testDatabaseName(),
    allowPublicKeyRetrieval: true,
  });
}
