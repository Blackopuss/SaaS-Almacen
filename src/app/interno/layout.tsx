import { ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { ThemeToggle } from "@/components";
import { requirePlatformStaff } from "@/platform/billing";

export const metadata: Metadata = {
  title: { default: "Consola interna", template: "%s · Consola interna" },
  robots: { index: false },
};

/** Internal console (MOD-09): only platform staff with MFA get past here. */
export default async function InternoLayout({
  children,
}: LayoutProps<"/interno">) {
  const staff = await requirePlatformStaff();
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-md sm:px-6">
        <Link
          href="/interno"
          className="flex min-h-11 items-center gap-2 rounded-lg font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ShieldCheck aria-hidden="true" className="size-5 text-primary" />
          <span className="sr-only sm:not-sr-only">Consola interna</span>
        </Link>
        <nav aria-label="Consola" className="flex items-center gap-1 text-sm">
          {[
            { href: "/interno", label: "Empresas" },
            { href: "/interno/codigos", label: "Códigos" },
          ].map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center rounded-lg px-2 font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <span className="ml-auto hidden text-sm text-muted-foreground sm:inline">
          {staff.name}
        </span>
        <ThemeToggle className="ml-auto sm:ml-0" />
      </header>
      <main id="contenido" className="flex-1">
        {children}
      </main>
    </div>
  );
}
