import "server-only";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";

import { isLoopbackHost } from "@/lib";

import { PrismaClient } from "./generated/prisma/client";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing environment variable ${name}`);
  return value;
}

// The application connects as the least-privilege user (data only, no DDL).
function createClient(): PrismaClient {
  const host = required("DATABASE_HOST");
  const adapter = new PrismaMariaDb({
    host,
    port: Number(process.env.DATABASE_PORT ?? 3306),
    user: required("DATABASE_APP_USER"),
    password: required("DATABASE_APP_PASSWORD"),
    database: required("DATABASE_NAME"),
    connectionLimit: Number(process.env.DATABASE_POOL_SIZE ?? 5),
    // MySQL without TLS sends its public key for caching_sha2_password on
    // a user's first sign-in. Over a network someone could swap that key,
    // so production only accepts it from this same machine (the VPS of
    // ADR 0024); a remote database must use TLS.
    allowPublicKeyRetrieval:
      process.env.NODE_ENV !== "production" || isLoopbackHost(host),
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
