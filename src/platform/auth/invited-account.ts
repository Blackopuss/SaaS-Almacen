import "server-only";

import { z } from "zod";

import { newId } from "@/lib";

import { hashPassword } from "./password";
import { newPasswordSchema } from "./register";

/**
 * Account for someone who arrives through an invitation link (USR-05). The
 * link was sent to their mailbox, so the email counts as confirmed and no
 * verification email is needed. The account is written with the caller's
 * transaction, together with the membership: both exist or neither.
 */

const invitedAccountSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Escribe tu nombre (mínimo 2 caracteres).")
    .max(120, "El nombre es demasiado largo (máximo 120 caracteres)."),
  password: newPasswordSchema,
});

export type InvitedAccountField = "name" | "password";

export type PreparedInvitedAccount =
  | { ok: true; name: string; passwordHash: string }
  | { ok: false; fieldErrors: Partial<Record<InvitedAccountField, string>> };

/** Validates name and password and hashes the password (slow: outside transactions). */
export async function prepareInvitedAccount(input: {
  name: string;
  password: string;
}): Promise<PreparedInvitedAccount> {
  const parsed = invitedAccountSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Partial<Record<InvitedAccountField, string>> = {};
    for (const issue of parsed.error.issues) {
      const field = issue.path[0] as InvitedAccountField;
      fieldErrors[field] ??= issue.message;
    }
    return { ok: false, fieldErrors };
  }
  return {
    ok: true,
    name: parsed.data.name,
    passwordHash: await hashPassword(parsed.data.password),
  };
}

type AccountWriter = {
  user: {
    create(args: {
      data: { id: string; name: string; email: string; emailVerified: true };
    }): PromiseLike<unknown>;
  };
  account: {
    create(args: {
      data: {
        id: string;
        userId: string;
        providerId: "credential";
        accountId: string;
        password: string;
      };
    }): PromiseLike<unknown>;
  };
};

/** Creates the verified account with its password. Returns the new user id. */
export async function insertInvitedAccount(
  client: AccountWriter,
  input: { name: string; email: string; passwordHash: string },
): Promise<string> {
  const userId = newId();
  await client.user.create({
    data: {
      id: userId,
      name: input.name,
      email: input.email.trim().toLowerCase(),
      emailVerified: true,
    },
  });
  await client.account.create({
    data: {
      id: newId(),
      userId,
      providerId: "credential",
      accountId: userId,
      password: input.passwordHash,
    },
  });
  return userId;
}
