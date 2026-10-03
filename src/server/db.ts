import "server-only";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { PrismaClient } from "./generated/prisma/client";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

// The application connects as the least-privilege user (data only, no DDL).
function createClient(): PrismaClient {
  const adapter = new PrismaMariaDb({
    host: required("DATABASE_HOST"),
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: required("DATABASE_APP_USER"),
    password: required("DATABASE_APP_PASSWORD"),
    database: required("DATABASE_NAME"),
    connectionLimit: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    // Local MySQL without TLS needs the server key for caching_sha2_password.
    allowPublicKeyRetrieval: process.env.NODE_ENV !== "production",
  });
  return new PrismaClient({ adapter });
}

// Reuse one client across hot reloads in development, but only while the
// generated client is the same: after `prisma generate` (a new migration)
// the class changes and a fresh client with the new models is created.
const globalForDb = globalThis as unknown as {
  db?: PrismaClient;
  dbClass?: typeof PrismaClient;
};

const cached =
  globalForDb.dbClass === PrismaClient ? globalForDb.db : undefined;
if (!cached && globalForDb.db) void globalForDb.db.$disconnect();

export const db: PrismaClient = cached ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForDb.db = db;
  globalForDb.dbClass = PrismaClient;
}
