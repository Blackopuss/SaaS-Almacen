// Public API of platform/auth: identity, sessions and MFA (PLT).
export {
  RESET_PASSWORD_MINUTES,
  TOTP_DIGITS,
  VERIFICATION_HOURS,
  auth,
} from "./auth";
export type { Session } from "./auth";
export {
  confirmTotpEnrollment,
  getMfaStatus,
  isMfaRequired,
  normalizeTotpCode,
  startTotpEnrollment,
  verifySignInCode,
} from "./mfa";
export type {
  ConfirmTotpResult,
  MfaStatus,
  SignInCodeResult,
  StartTotpResult,
} from "./mfa";
export { disableMfa, regenerateBackupCodes } from "./mfa-recovery";
export { BACKUP_CODE_COUNT, normalizeBackupCode } from "./backup-codes";
export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password";
export { requestPasswordReset, resetPassword } from "./recovery";
export type {
  PasswordResetRequestResult,
  PasswordResetResult,
} from "./recovery";
export { DEFAULT_AFTER_SIGN_IN, safeRedirectPath } from "./redirect";
export { registerUser, resendVerification } from "./register";
export type {
  RegisterField,
  RegisterInput,
  RegisterResult,
  ResendResult,
} from "./register";
export {
  MFA_SETUP_PATH,
  getCurrentSession,
  requireSession,
  signIn,
  signOut,
} from "./session";
export type { CurrentUser, SignInResult } from "./session";
export {
  listActiveSessions,
  revokeOtherSessions,
  revokeSession,
} from "./sessions";
export type { ActiveSession } from "./sessions";
export { handleAuthRequest, isAllowedAuthRequest } from "./http";
export {
  blockedFor,
  clientIp,
  recordAttempt,
  throttleKeys,
  tooManyAttemptsMessage,
} from "./throttle";
export { insertInvitedAccount, prepareInvitedAccount } from "./invited-account";
export type {
  InvitedAccountField,
  PreparedInvitedAccount,
} from "./invited-account";
