import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import Script from "next/script";

import { Providers, THEME_SCRIPT } from "@/components";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Almacén", template: "%s · Almacén" },
  description: "Inventario modular para pymes.",
};

export const viewport: Viewport = {
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f10" },
  ],
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Set by src/proxy.ts for every page (CSP, PLT16-04). Reading headers
  // also renders every page per request, which a nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <html
      lang="es-MX"
      className={`${inter.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        <Script id="almacen-tema" strategy="beforeInteractive" nonce={nonce}>
          {THEME_SCRIPT}
        </Script>
      </head>
      <body className="flex min-h-full flex-col">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
