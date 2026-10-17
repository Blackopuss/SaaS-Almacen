"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import {
  DEFAULT_AFTER_SIGN_IN,
  requireSession,
  signIn,
  signOut,
  type InvitedAccountField,
} from "@/platform/auth";
import {
  INVITATION_PATH,
  acceptInvitation,
  acceptInvitationAsNewUser,
} from "@/platform/authorization";
import { switchOrganization } from "@/platform/tenancy";

export type AcceptInvitationState = { error?: string; invalid?: boolean };

/** Someone already signed in accepts the invitation sent to their email. */
export async function acceptInvitationAction(
  _prev: AcceptInvitationState,
  formData: FormData,
): Promise<AcceptInvitationState> {
  // Joining needs no MFA yet; the app asks for it right after if the new
  // roles require it.
  const { user, sessionId } = await requireSession({ allowMissingMfa: true });
  const result = await acceptInvitation(
    user.id,
    String(formData.get("token") ?? ""),
  );
  if (!result.ok) {
    return { error: result.error, invalid: result.reason === "invalid" };
  }
  await switchOrganization(user.id, sessionId, result.organizationId);
  revalidatePath("/", "layout");
  redirect(DEFAULT_AFTER_SIGN_IN);
}

export type JoinAsNewUserState = {
  fieldErrors: Partial<Record<InvitedAccountField, string>>;
  formError?: string;
  invalid?: boolean;
  hasAccount?: boolean;
  values: { name: string };
};

/** Someone without an account creates it from the invitation and enters. */
export async function joinAsNewUserAction(
  _prev: JoinAsNewUserState,
  formData: FormData,
): Promise<JoinAsNewUserState> {
  const requestHeaders = await headers();
  const name = String(formData.get("name") ?? "");
  const password = String(formData.get("password") ?? "");
  const result = await acceptInvitationAsNewUser(
    String(formData.get("token") ?? ""),
    { name, password },
    requestHeaders,
  );
  if (!result.ok) {
    if (result.reason === "fields") {
      return { fieldErrors: result.fieldErrors, values: { name } };
    }
    return {
      fieldErrors: {},
      formError: result.error,
      invalid: result.reason === "invalid",
      hasAccount: result.reason === "has_account",
      values: { name },
    };
  }
  const signedIn = await signIn(
    { email: result.email, password },
    requestHeaders,
  );
  redirect(signedIn.ok ? DEFAULT_AFTER_SIGN_IN : "/ingresar");
}

/** Leaves the current account and comes back to the same invitation. */
export async function invitationSignOutAction(
  formData: FormData,
): Promise<void> {
  const token = String(formData.get("token") ?? "");
  await signOut();
  redirect(
    /^[A-Za-z0-9_-]{20,128}$/.test(token)
      ? `${INVITATION_PATH}?token=${token}`
      : "/ingresar",
  );
}
