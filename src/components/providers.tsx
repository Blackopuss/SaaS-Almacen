"use client";

import { MotionProvider } from "./motion";
import { Toaster } from "./ui/sonner";

/** Client-side providers mounted once in the root layout. */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <MotionProvider>
      {children}
      <Toaster position="top-center" richColors closeButton />
    </MotionProvider>
  );
}
