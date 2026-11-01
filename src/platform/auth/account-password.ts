import "server-only";

import { db } from "@/server";

import { verifyPassword } from "./password";

/**
 * Whether a password is the one of a person's account, to confirm on the
 * spot that it is them — a supervisor allowing a discount at the counter
 * (VEN-14). It does not sign anyone in. Callers limit attempts with
 * `reserveAttempt` before asking and `settleFailure` after a wrong one.
 */
export async function verifyAccountPassword(
  userId: string,
  password: string,
): Promise<boolean> {
  const typed = String(password ?? "");
  if (typed === "" || typed.length > 1024) return false;
  const account = await db.account.findFirst({
    where: { userId: String(userId).slice(0, 36), providerId: "credential" },
    select: { password: true },
  });
  if (!account?.password) return false;
  return verifyPassword({ hash: account.password, password: typed });
}
