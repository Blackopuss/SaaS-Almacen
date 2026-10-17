import { MapPin, PackageCheck, ScanBarcode, Warehouse } from "lucide-react";
import Link from "next/link";

import { FadeIn, ThemeToggle, WarehouseScene } from "@/components";

const BENEFITS = [
  { icon: PackageCheck, text: "Cuánto tienes de cada producto, al momento" },
  { icon: MapPin, text: "En qué pasillo y estante está" },
  { icon: ScanBarcode, text: "Entradas por caja, salidas por pieza" },
];

/** Account screens: warehouse showcase + form (registration, sign-in…). */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.05fr_1fr]">
      {/* Showcase (desktop) */}
      <aside className="relative hidden overflow-hidden border-r bg-[var(--scene-sky)] lg:flex lg:flex-col">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,var(--scene-rack)_1px,transparent_0)] [background-size:22px_22px] opacity-[0.12]"
        />
        <div className="relative z-10 flex h-16 items-center px-8">
          <Brand />
        </div>
        <div className="relative z-10 flex flex-1 flex-col justify-center gap-10 px-10 pb-12 xl:px-16">
          <FadeIn className="max-w-md space-y-4">
            <h2 className="text-4xl font-semibold tracking-tight text-balance">
              Tu almacén, bajo control.
            </h2>
            <ul className="space-y-3 text-muted-foreground">
              {BENEFITS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-3">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg border bg-card text-primary shadow-sm">
                    <Icon aria-hidden="true" className="size-4" />
                  </span>
                  {text}
                </li>
              ))}
            </ul>
          </FadeIn>
          <WarehouseScene className="aspect-[48/34] w-full max-w-xl" />
        </div>
      </aside>

      {/* Form column */}
      <div className="flex min-h-dvh flex-col">
        <header className="flex h-16 items-center justify-between px-4 sm:px-6 lg:justify-end">
          <span className="lg:hidden">
            <Brand />
          </span>
          <ThemeToggle />
        </header>
        <main
          id="contenido"
          className="flex flex-1 flex-col items-center px-4 pb-16 sm:justify-center"
        >
          <div className="w-full max-w-md pt-4">{children}</div>
        </main>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link
      href="/"
      className="flex h-11 items-center gap-2.5 rounded-lg px-1 font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Warehouse aria-hidden="true" className="size-4.5" />
      </span>
      Almacén
    </Link>
  );
}
