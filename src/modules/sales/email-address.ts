const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The address a customer can be written to, or null. */
export function usableEmail(email: string | null): string | null {
  const text = (email ?? "").trim().toLowerCase();
  return text.length <= 254 && EMAIL.test(text) ? text : null;
}
