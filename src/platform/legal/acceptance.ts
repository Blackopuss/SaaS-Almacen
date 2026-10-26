import "server-only";

import { cache } from "react";

import { newId } from "@/lib";
import { db } from "@/server";

import {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_IDS,
  legalConsentSchema,
  type LegalDocumentId,
} from "./documents";

type AcceptanceWriter = {
  legalAcceptance: {
    createMany(args: {
      data: {
        id: string;
        userId: string;
        document: string;
        version: string;
        ipAddress: string | null;
        userAgent: string | null;
      }[];
      skipDuplicates: true;
    }): PromiseLike<unknown>;
  };
};

/**
 * Where an acceptance came from. The IP is `clientIp` of platform/auth
 * (the caller passes it: platform/auth uses this area, not the reverse).
 */
export type AcceptanceOrigin = {
  ipAddress: string | null;
  userAgent: string | null;
};

/**
 * Stores that `userId` accepted the current version of every legal
 * document (PIL-09), with the caller's client so it can join the
 * transaction that creates the account. A version already accepted is
 * kept as it was (the first acceptance is the proof).
 */
export async function recordLegalAcceptance(
  client: AcceptanceWriter,
  userId: string,
  origin: AcceptanceOrigin,
): Promise<void> {
  await client.legalAcceptance.createMany({
    data: LEGAL_DOCUMENT_IDS.map((document) => ({
      id: newId(),
      userId,
      document,
      version: LEGAL_DOCUMENTS[document].version,
      ipAddress: origin.ipAddress?.slice(0, 64) ?? null,
      userAgent: origin.userAgent?.slice(0, 500) ?? null,
    })),
    skipDuplicates: true,
  });
}

/** Documents whose current version `userId` has not accepted. */
export const pendingLegalDocuments = cache(
  async (userId: string): Promise<LegalDocumentId[]> => {
    const accepted = await db.legalAcceptance.findMany({
      where: {
        userId,
        OR: LEGAL_DOCUMENT_IDS.map((document) => ({
          document,
          version: LEGAL_DOCUMENTS[document].version,
        })),
      },
      select: { document: true },
    });
    const done = new Set(accepted.map((row) => row.document));
    return LEGAL_DOCUMENT_IDS.filter((document) => !done.has(document));
  },
);

export type AcceptLegalResult = { ok: true } | { ok: false; error: string };

/** Someone already signed in accepts the current versions (the gate). */
export async function acceptLegalDocuments(
  userId: string,
  input: { accept: boolean },
  origin: AcceptanceOrigin,
): Promise<AcceptLegalResult> {
  const parsed = legalConsentSchema.safeParse(input.accept);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]!.message };
  }
  await recordLegalAcceptance(db, userId, origin);
  return { ok: true };
}
