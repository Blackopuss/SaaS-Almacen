// Public API of platform/email: outgoing email and templates (PLT-03).
export {
  InvalidEmailError,
  MAX_ATTACHMENTS_BYTES,
  listDevOutbox,
  memoryOutboxFor,
  sendEmail,
} from "./send";
export type {
  EmailAttachment,
  EmailMessage,
  StoredAttachment,
  StoredEmail,
} from "./send";
export {
  backupCodeUsedEmail,
  backupCodesRegeneratedEmail,
  existingAccountEmail,
  invitationEmail,
  mfaDisabledEmail,
  mfaEnabledEmail,
  passwordChangedEmail,
  passwordResetEmail,
  purchaseOrderEmail,
  verificationEmail,
} from "./templates";
