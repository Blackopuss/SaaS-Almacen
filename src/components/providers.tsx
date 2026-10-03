"use client";

import { ThemeProvider } from "next-themes";

import { MotionProvider } from "./motion";
import { Toaster } from "./ui/sonner";

/** Client-side providers mounted once in the root layout. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      storageKey="almacen-tema"
      disableTransitionOnChange
    >
      <MotionProvider>
        {children}
        <Toaster position="top-center" richColors closeButton />
      </MotionProvider>
    </ThemeProvider>
  );
}
