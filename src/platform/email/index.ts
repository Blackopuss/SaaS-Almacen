// Public API of platform/email: outgoing email and templates (PLT-03).
export {
  InvalidEmailError,
  MAX_ATTACHMENTS_BYTES,
  listDevOutbox,
  smtpSettings,
  memoryOutboxFor,
  sendEmail,
} from "./send";
export type {
  EmailAttachment,
  EmailMessage,
  SmtpSettings,
  StoredAttachment,
  StoredEmail,
} from "./send";
export {
  backupCodeUsedEmail,
  backupCodesRegeneratedEmail,
  existingAccountEmail,
  invitationEmail,
  mfaDisabledEmail,
  operationsAlertEmail,
  mfaEnabledEmail,
  passwordChangedEmail,
  passwordResetEmail,
  planPurchaseEmail,
  purchaseOrderEmail,
  salesQuoteEmail,
  salesStatementEmail,
  verificationEmail,
} from "./templates";
