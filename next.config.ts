import type { NextConfig } from "next";

/**
 * Security headers for every response (PLT-16). The page cannot be shown
 * inside another site's frame (clickjacking), the browser does not guess
 * content types, links do not leak full URLs to other sites, and unused
 * device features are off. A full script Content-Security-Policy with
 * nonces is pending (see docs/seguridad/REVISION_PLT.md).
 */
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value:
      "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
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
};

export default nextConfig;
