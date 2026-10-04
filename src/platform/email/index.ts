// Public API of platform/email: outgoing email and templates (PLT-03).
export { listDevOutbox, memoryOutboxFor, sendEmail } from "./send";
export type { EmailMessage, StoredEmail } from "./send";
export {
  backupCodeUsedEmail,
  backupCodesRegeneratedEmail,
  existingAccountEmail,
  invitationEmail,
  mfaDisabledEmail,
  mfaEnabledEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from "./templates";
