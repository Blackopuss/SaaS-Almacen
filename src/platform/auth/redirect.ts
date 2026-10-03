/**
 * Only same-site relative paths are accepted as "return to" targets, so a
 * crafted link can never send someone to another website after signing in
 * (open redirect, ASVS 5.1.5).
 */
export const DEFAULT_AFTER_SIGN_IN = "/inventario";

export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return DEFAULT_AFTER_SIGN_IN;
  }
  // Must be a single-slash absolute path: no "//host", "/\host" or schemes.
  if (
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.startsWith("/\\")
  ) {
    return DEFAULT_AFTER_SIGN_IN;
  }
  if (/[\u0000-\u001f\\]/.test(value)) return DEFAULT_AFTER_SIGN_IN;
  try {
    const url = new URL(value, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return DEFAULT_AFTER_SIGN_IN;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return DEFAULT_AFTER_SIGN_IN;
  }
}
