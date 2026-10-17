import { ArrowRight } from "lucide-react";
import Link from "next/link";

import { cn } from "cn";

import { Button } from "@/components/ui/button";

/** Building blocks shared by the public pages. */

export function Section({
  className,
  children,
  id,
}: {
  className?: string;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-20 py-20 sm:py-24", className)}>
      <div className="mx-auto max-w-6xl px-4 sm:px-6">{children}</div>
    </section>
  );
}

export function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
      <span className="size-1.5 rounded-full bg-primary" aria-hidden="true" />
      {children}
    </p>
  );
}

/** Title block at the top of an inner page. */
export function PageHero({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="relative overflow-hidden border-b">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,var(--scene-rack)_1px,transparent_0)] [mask-image:radial-gradient(ellipse_at_top,black,transparent_75%)] [background-size:24px_24px] opacity-[0.08]"
      />
      <div className="relative mx-auto max-w-3xl px-4 py-16 text-center motion-safe:animate-in motion-safe:duration-700 motion-safe:fade-in motion-safe:slide-in-from-bottom-3 sm:px-6 sm:py-20">
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1 className="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
          {title}
        </h1>
        {children && (
          <div className="mx-auto mt-5 max-w-2xl text-lg text-pretty text-muted-foreground">
            {children}
          </div>
        )}
      </div>
    </section>
  );
}

/** Closing call to action of every marketing page. */
export function CtaBand() {
  return (
    <section className="px-4 pb-20 sm:px-6 sm:pb-24">
      <div
        data-reveal
        className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl bg-primary px-6 py-14 text-center text-primary-foreground sm:px-12"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,currentColor_1px,transparent_0)] [background-size:20px_20px] opacity-15"
        />
        <h2 className="relative text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          Empieza a ordenar tu almacén hoy
        </h2>
        <p className="relative mx-auto mt-3 max-w-xl text-lg opacity-90">
          Crea tu cuenta, sube tu catálogo y registra tu primera entrada.
        </p>
        <div className="relative mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Button
            asChild
            size="lg"
            variant="secondary"
            className="bg-background text-foreground hover:bg-background/90"
          >
            <Link href="/registro">
              Crear cuenta
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button
            asChild
            size="lg"
            variant="ghost"
            className="text-primary-foreground ring-1 ring-primary-foreground/40 hover:bg-primary-foreground/10 hover:text-primary-foreground"
          >
            <Link href="/precios">Ver precios</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
