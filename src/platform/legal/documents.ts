import { z } from "zod";

/**
 * Legal documents every account accepts (PIL-09). The version is the date
 * the text took effect (YYYY-MM-DD): publishing a new text means changing
 * the page and bumping its version here; from then on, every person must
 * accept it again before using the app. No `server-only`: the public
 * pages and the seed script read it too.
 */
export const LEGAL_DOCUMENTS = {
  terms: {
    version: "2026-10-25",
    title: "Términos y condiciones",
    href: "/terminos",
  },
  privacy: {
    version: "2026-10-16",
    title: "Aviso de privacidad",
    href: "/privacidad",
  },
} as const;

export type LegalDocumentId = keyof typeof LEGAL_DOCUMENTS;

export const LEGAL_DOCUMENT_IDS = Object.keys(
  LEGAL_DOCUMENTS,
) as LegalDocumentId[];

/** "16 de octubre de 2026" for a version, as the documents show it. */
export function legalVersionDate(version: string): string {
  return new Date(`${version}T12:00:00Z`).toLocaleDateString("es-MX", {
    dateStyle: "long",
    timeZone: "UTC",
  });
}

/** The checkbox of a form that creates an account or accepts new versions. */
export const legalConsentSchema = z.boolean().refine(Boolean, {
  message:
    "Para continuar acepta los términos y condiciones y el aviso de privacidad.",
});
