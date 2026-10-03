import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WarehouseCard } from "@/components";
import {
  DEFAULT_AFTER_SIGN_IN,
  isMfaRequired,
  requireSession,
} from "@/platform/auth";

import { RequiredMfaSetup } from "./required-mfa-setup";

export const metadata: Metadata = {
  title: "Activa la verificación en dos pasos",
};

/**
 * Mandatory MFA setup (PLT-08B): accounts that must use MFA land here from
 * any protected screen until it is on.
 */
export default async function ActivaDosPasosPage() {
  const { user, mfaEnabled } = await requireSession({ allowMissingMfa: true });
  if (mfaEnabled || !(await isMfaRequired(user.id))) {
    redirect(DEFAULT_AFTER_SIGN_IN);
  }
  return (
    <WarehouseCard>
      <p className="mb-6 rounded-lg bg-accent p-3 text-sm text-accent-foreground">
        Tu cuenta necesita verificación en dos pasos antes de continuar: es
        obligatoria para titulares y administradores.
      </p>
      <RequiredMfaSetup next={DEFAULT_AFTER_SIGN_IN} />
    </WarehouseCard>
  );
}
