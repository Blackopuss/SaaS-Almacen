"use client";

import "./globals.css";

/**
 * Last resort when the root layout itself fails (PIL-07): its own document,
 * in Spanish, with one way out. It replaces the layout, so the theme script
 * does not run: it follows the system's light or dark mode.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  const digest =
    error instanceof Error && "digest" in error
      ? String((error as Error & { digest?: string }).digest ?? "")
      : "";
  return (
    <html lang="es-MX">
      <body className="grid min-h-dvh place-items-center bg-background p-4 font-sans text-foreground">
        <title>Algo salió mal · Almacén</title>
        <main className="max-w-sm space-y-4 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">
            No pudimos abrir Almacén
          </h1>
          <p className="text-muted-foreground">
            Revisa tu conexión e inténtalo de nuevo. Tus datos no se
            modificaron.
            {digest &&
              ` Si continúa, comparte este código con soporte: ${digest}`}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 font-medium text-primary-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Reintentar
          </button>
        </main>
      </body>
    </html>
  );
}
