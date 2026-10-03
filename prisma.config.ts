import { existsSync } from "node:fs";
import { defineConfig } from "prisma/config";

// The Prisma CLI runs migrations as the migrator user, never as the app user.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

function mysqlUrl(database: string | undefined): string | undefined {
  const { DATABASE_HOST, DATABASE_PORT, DATABASE_MIGRATOR_USER } = process.env;
  const password = process.env.DATABASE_MIGRATOR_PASSWORD;
  if (!DATABASE_HOST || !DATABASE_MIGRATOR_USER || !password || !database) {
    return undefined; // `prisma generate` works without a database.
  }
  const user = encodeURIComponent(DATABASE_MIGRATOR_USER);
  const port = DATABASE_PORT ?? "3306";
  return `mysql://${user}:${encodeURIComponent(password)}@${DATABASE_HOST}:${port}/${database}`;
}

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: { path: "prisma/migrations" },
  datasource: {
    url: mysqlUrl(process.env.DATABASE_NAME) ?? "",
    shadowDatabaseUrl: mysqlUrl(process.env.DATABASE_SHADOW_NAME),
  },
});
