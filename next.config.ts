import type { NextConfig } from "next";

import { CHECKOUT_HOSTS } from "./src/lib/csp";

/**
 * Security headers for every response (PLT-16). The page cannot be shown
 * inside another site's frame (clickjacking), the browser does not guess
 * content types, links do not leak full URLs to other sites, and unused
 * device features are off. Pages also get a script policy with a nonce
 * per request from src/proxy.ts (PLT16-04); this one covers every
 * response, static files included.
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: `frame-ancestors 'none'; base-uri 'self'; form-action 'self' ${CHECKOUT_HOSTS}; object-src 'none'`,
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    // Camera stays available for barcode scanning (INV-34).
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
  },
  ...(process.env.NODE_ENV === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains",
        },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // The floating "N" indicator covered the theme switch and the sidebar
  // user menu. Compile and runtime errors are still shown when they happen.
  devIndicators: false,
  poweredByHeader: false,
  experimental: {
    serverActions: {
      // Import files travel in a Server Action: up to 10 MB of file
      // (FILE_PURPOSES.import_source) plus the form around it.
      bodySizeLimit: "11mb",
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // An address people reach by trimming an order's: the list of orders is
  // the Compras screen itself.
  async redirects() {
    return [
      { source: "/compras/ordenes", destination: "/compras", permanent: false },
    ];
  },
};

export default nextConfig;
