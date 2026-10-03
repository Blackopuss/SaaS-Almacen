import { Warehouse } from "lucide-react";
import Link from "next/link";

import { ThemeToggle } from "@/components";

/** Centered layout for account screens (registration, sign-in, recovery). */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex h-16 items-center justify-between px-4 sm:px-6">
        <Link
          href="/"
          className="flex h-11 items-center gap-2.5 rounded-lg px-1 font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Warehouse aria-hidden="true" className="size-4.5" />
          </span>
          Almacén
        </Link>
        <ThemeToggle />
      </header>
      <main
        id="contenido"
        className="flex flex-1 items-start justify-center px-4 pt-6 pb-16 sm:items-center sm:pt-0"
      >
        {children}
      </main>
    </div>
  );
}
