import { handleAuthRequest } from "@/platform/auth";

// Only the email links (verify email, reset password) reach Better Auth
// over HTTP; see src/platform/auth/http.ts (PLT-15).
export const GET = handleAuthRequest;
export const POST = handleAuthRequest;
