"use server";

import { revalidatePath } from "next/cache";

import {
  assignRoles,
  cancelInvitation,
  createInvitation,
  disableMember,
  reactivateMember,
  resendInvitation,
  type InvitationField,
} from "@/platform/authorization";
import { requireOrganizationContext } from "@/platform/tenancy";

const TEAM_PATH = "/configuracion/equipo";

export type TeamActionState = { ok: boolean; message: string };

export type InviteState = {
  fieldErrors: Partial<Record<InvitationField, string>>;
  formError?: string;
  /** Email of the invitation just sent (the dialog closes and says so). */
  sentTo?: string;
  values: { email: string; roles: string[] };
};

/** The person and the company always come from the session, never the form. */
async function actor() {
  const { user, organization } = await requireOrganizationContext();
  return { userId: user.id, organizationId: organization.id };
}

const rolesFrom = (formData: FormData) =>
  formData.getAll("roles").map((value) => String(value));

export async function inviteAction(
  _prev: InviteState,
  formData: FormData,
): Promise<InviteState> {
  const { userId, organizationId } = await actor();
  const values = {
    email: String(formData.get("email") ?? ""),
    roles: rolesFrom(formData),
  };
  const result = await createInvitation(organizationId, userId, values);
  if (!result.ok) {
    return {
      fieldErrors: result.fieldErrors,
      formError: result.formError,
      values,
    };
  }
  revalidatePath(TEAM_PATH);
  return {
    fieldErrors: {},
    sentTo: values.email.trim().toLowerCase(),
    values: { email: "", roles: [] },
  };
}

export async function resendInvitationAction(
  invitationId: string,
): Promise<TeamActionState> {
  const { userId, organizationId } = await actor();
  const result = await resendInvitation(
    organizationId,
    userId,
    String(invitationId),
  );
  revalidatePath(TEAM_PATH);
  return result.ok
    ? {
        ok: true,
        message: "Enviamos un enlace nuevo. El anterior ya no sirve.",
      }
    : { ok: false, message: result.error };
}

export async function cancelInvitationAction(
  invitationId: string,
): Promise<TeamActionState> {
  const { userId, organizationId } = await actor();
  const result = await cancelInvitation(
    organizationId,
    userId,
    String(invitationId),
  );
  revalidatePath(TEAM_PATH);
  return result.ok
    ? { ok: true, message: "Invitación cancelada. Su enlace ya no sirve." }
    : { ok: false, message: result.error };
}

export async function assignRolesAction(
  _prev: TeamActionState | null,
  formData: FormData,
): Promise<TeamActionState> {
  const { userId, organizationId } = await actor();
  const result = await assignRoles(organizationId, userId, {
    userId: String(formData.get("userId") ?? ""),
    roles: rolesFrom(formData),
  });
  revalidatePath(TEAM_PATH);
  return result.ok
    ? { ok: true, message: "Roles actualizados." }
    : { ok: false, message: result.error };
}

export async function disableMemberAction(
  _prev: TeamActionState | null,
  formData: FormData,
): Promise<TeamActionState> {
  const { userId, organizationId } = await actor();
  const result = await disableMember(organizationId, userId, {
    userId: String(formData.get("userId") ?? ""),
    reason: String(formData.get("reason") ?? ""),
  });
  revalidatePath(TEAM_PATH);
  return result.ok
    ? {
        ok: true,
        message: "Persona desactivada. Cerramos sus sesiones abiertas.",
      }
    : { ok: false, message: result.error };
}

export async function reactivateMemberAction(
  memberUserId: string,
): Promise<TeamActionState> {
  const { userId, organizationId } = await actor();
  const result = await reactivateMember(organizationId, userId, {
    userId: String(memberUserId),
  });
  revalidatePath(TEAM_PATH);
  return result.ok
    ? { ok: true, message: "Persona reactivada con los roles que tenía." }
    : { ok: false, message: result.error };
}
