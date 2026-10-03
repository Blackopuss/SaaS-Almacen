// Public API of platform/auth: identity, sessions and MFA (PLT).
export { VERIFICATION_HOURS, auth } from "./auth";
export type { Session } from "./auth";
export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password";
export { registerUser, resendVerification } from "./register";
export type {
  RegisterField,
  RegisterInput,
  RegisterResult,
  ResendResult,
} from "./register";
