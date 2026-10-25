import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { WarehouseCard } from "@/components";
import { DEFAULT_AFTER_SIGN_IN, requireSession } from "@/platform/auth";
import {
  LEGAL_DOCUMENTS,
  legalVersionDate,
  pendingLegalDocuments,
} from "@/platform/legal";

import { AcceptLegalForm } from "./accept-legal-form";

export const metadata: Metadata = { title: "Acepta los términos" };

/**
 * PIL-09: accounts that have not accepted the current version of the
 * terms or the privacy notice land here from any protected screen.
 */
export default async function AceptaTerminosPage() {
  const { user } = await requireSession({
    allowPendingLegal: true,
    allowMissingMfa: true,
  });
  const pending = await pendingLegalDocuments(user.id);
  if (pending.length === 0) redirect(DEFAULT_AFTER_SIGN_IN);
  return (
    <WarehouseCard>
      <AcceptLegalForm
        documents={pending.map((id) => ({
          id,
          title: LEGAL_DOCUMENTS[id].title,
          href: LEGAL_DOCUMENTS[id].href,
          date: legalVersionDate(LEGAL_DOCUMENTS[id].version),
        }))}
      />
    </WarehouseCard>
  );
}
