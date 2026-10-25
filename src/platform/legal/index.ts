// Public API of platform/legal: versioned acceptance of legal documents (PIL-09).
export {
  LEGAL_DOCUMENTS,
  LEGAL_DOCUMENT_IDS,
  legalConsentSchema,
  legalVersionDate,
} from "./documents";
export type { LegalDocumentId } from "./documents";
export {
  acceptLegalDocuments,
  pendingLegalDocuments,
  recordLegalAcceptance,
} from "./acceptance";
export type { AcceptLegalResult, AcceptanceOrigin } from "./acceptance";
