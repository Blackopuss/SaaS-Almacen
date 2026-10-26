"use client";

import { ArrowRight, Menu, Warehouse } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { cn } from "cn";

import { ThemeToggle } from "@/components";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

import { SITE_NAV } from "./site-shared";

/**
 * Header of the public site: brand, sections, theme and account buttons.
 * With a session cookie it offers to go back to the app instead (the app
 * still checks the session). On phones the sections live in a sheet.
 */
export function SiteHeader({ signedIn }: { signedIn: boolean }) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const current = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  return (
    <header
      data-scrolled={scrolled}
      className="sticky top-0 z-40 border-b border-transparent transition-[background-color,border-color,backdrop-filter] duration-300 data-[scrolled=true]:border-border data-[scrolled=true]:bg-background/80 data-[scrolled=true]:backdrop-blur-lg"
    >
      <a
        href="#contenido"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:shadow"
      >
        Saltar al contenido
      </a>
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Brand />
        <nav aria-label="Secciones" className="ml-6 hidden md:block">
          <ul className="flex items-center gap-1">
            {SITE_NAV.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={current(item.href) ? "page" : undefined}
                  className="relative inline-flex h-10 items-center rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors outline-none after:absolute after:inset-x-3 after:bottom-1 after:h-0.5 after:origin-left after:scale-x-0 after:rounded-full after:bg-primary after:transition-transform after:duration-300 hover:text-foreground hover:after:scale-x-100 focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:text-foreground aria-[current=page]:after:scale-x-100 motion-reduce:after:transition-none"
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle className="hidden sm:inline-flex" />
          {signedIn ? (
            <Button asChild className="hidden sm:inline-flex">
              <Link href="/inicio">
                Ir a mi almacén
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          ) : (
            <>
              <Button asChild variant="ghost" className="hidden sm:inline-flex">
                <Link href="/ingresar">Entrar</Link>
              </Button>
              <Button asChild className="hidden sm:inline-flex">
                <Link href="/registro">Crear cuenta</Link>
              </Button>
            </>
          )}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu />
                <span className="sr-only">Abrir menú</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[85%] max-w-sm">
              <SheetHeader>
                <SheetTitle>Menú</SheetTitle>
                <SheetDescription className="sr-only">
                  Secciones del sitio y acceso a tu cuenta
                </SheetDescription>
              </SheetHeader>
              <nav aria-label="Secciones" className="px-4">
                <ul className="space-y-1">
                  {[{ href: "/", label: "Inicio" }, ...SITE_NAV].map((item) => (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        onClick={() => setOpen(false)}
                        aria-current={
                          (
                            item.href === "/"
                              ? pathname === "/"
                              : current(item.href)
                          )
                            ? "page"
                            : undefined
                        }
                        className="flex h-12 items-center rounded-lg px-3 text-base font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-accent aria-[current=page]:text-accent-foreground"
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
              <div className="mt-auto space-y-3 border-t p-4">
                <ThemeToggle showLabel />
                {signedIn ? (
                  <Button asChild className="w-full">
                    <Link href="/inicio">Ir a mi almacén</Link>
                  </Button>
                ) : (
                  <div className="grid gap-2">
                    <Button asChild className="w-full">
                      <Link href="/registro">Crear cuenta</Link>
                    </Button>
                    <Button asChild variant="outline" className="w-full">
                      <Link href="/ingresar">Entrar</Link>
                    </Button>
                  </div>
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

export function Brand({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "flex h-11 items-center gap-2.5 rounded-lg px-1 font-semibold tracking-tight outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <span className="grid size-8 place-items-center rounded-lg bg-primary text-primary-foreground">
        <Warehouse aria-hidden="true" className="size-4.5" />
      </span>
      Almacén
    </Link>
  );
}
