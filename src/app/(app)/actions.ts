"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  DEFAULT_AFTER_SIGN_IN,
  requireSession,
  signOut,
} from "@/platform/auth";
import { switchOrganization } from "@/platform/tenancy";

export async function signOutAction(): Promise<void> {
  await signOut();
  redirect("/ingresar");
}

/** Switches the session's company; the server re-checks the membership. */
export async function switchOrganizationAction(
  organizationId: string,
): Promise<{ error: string }> {
  const { user, sessionId } = await requireSession();
  const result = await switchOrganization(
    user.id,
    sessionId,
    String(organizationId),
  );
  if (!result.ok) return { error: result.error };
  // Start over in the new company: re-render everything, layout included,
  // so nothing from the previous company stays on screen.
  revalidatePath("/", "layout");
  redirect(DEFAULT_AFTER_SIGN_IN);
}
