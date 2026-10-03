// Public API of platform/email: outgoing email and templates (PLT-03).
export { listDevOutbox, memoryOutboxFor, sendEmail } from "./send";
export type { EmailMessage, StoredEmail } from "./send";
export {
  existingAccountEmail,
  passwordChangedEmail,
  passwordResetEmail,
  verificationEmail,
} from "./templates";
