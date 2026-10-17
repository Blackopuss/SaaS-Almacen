/**
 * Content-Security-Policy of every page (PLT16-04). Scripts run only with
 * the nonce of their request ('strict-dynamic' lets them load the chunks
 * they need), so a script injected into the HTML does not execute even if
 * some text ever escaped unescaped. Styles keep 'unsafe-inline': React and
 * the animation libraries write inline style attributes, and a style
 * cannot run code.
 */
export function contentSecurityPolicy(
  nonce: string,
  options: { development: boolean; https: boolean },
): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    // Development reloads over a websocket to the same server.
    `connect-src 'self'${options.development ? " ws: wss:" : ""}`,
    "worker-src 'self' blob:",
    "media-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(options.https ? ["upgrade-insecure-requests"] : []),
  ];
  return directives.join("; ");
}

/** A fresh, unpredictable nonce (128 bits, base64). */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
