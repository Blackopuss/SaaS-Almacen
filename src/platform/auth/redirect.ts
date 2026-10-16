/**
 * Only same-site relative paths are accepted as "return to" targets, so a
 * crafted link can never send someone to another website after signing in
 * (open redirect, ASVS 5.1.5).
 */
export const DEFAULT_AFTER_SIGN_IN = "/inicio";

/** A single-slash absolute path: no "//host", "/\host" or schemes. */
function isLocalPath(value: string): boolean {
  return (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/\\") &&
    !/[\u0000-\u001f\\]/.test(value)
  );
}

export function safeRedirectPath(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 512) {
    return DEFAULT_AFTER_SIGN_IN;
  }
  if (!isLocalPath(value)) return DEFAULT_AFTER_SIGN_IN;
  try {
    const url = new URL(value, "http://local.invalid");
    if (url.origin !== "http://local.invalid") return DEFAULT_AFTER_SIGN_IN;
    const path = `${url.pathname}${url.search}${url.hash}`;
    // Normalizing dot segments can make a path start with "//" again
    // ("/.//evil.example" → "//evil.example"): what comes out is checked
    // too, not only what came in (security audit).
    return isLocalPath(path) ? path : DEFAULT_AFTER_SIGN_IN;
  } catch {
    return DEFAULT_AFTER_SIGN_IN;
  }
}
