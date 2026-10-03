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

// Reuse one client across hot reloads in development.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db: PrismaClient = globalForDb.db ?? createClient();

if (process.env.NODE_ENV !== "production") globalForDb.db = db;
