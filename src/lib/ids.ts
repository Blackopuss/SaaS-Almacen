import { validate, version, v7 } from "uuid";

/**
 * Record identifiers: UUIDv7 (time-ordered, so InnoDB primary-key inserts
 * stay sequential). Stored as CHAR(36).
 */
export function newId(): string {
  return v7();
}

export function isId(value: unknown): value is string {
  return typeof value === "string" && validate(value) && version(value) === 7;
}
