import { CircleAlert, CircleCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { FadeIn } from "@/components";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "Confirmación de correo" };

/** Landing page of the verification link (Better Auth adds ?error=...). */
export default async function CorreoVerificadoPage({
  searchParams,
}: PageProps<"/correo-verificado">) {
  const { error } = await searchParams;
  const failed = Boolean(error);

  return (
    <FadeIn className="w-full max-w-md">
      <div className="rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
        <span
          className={
            failed
              ? "grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive"
              : "grid size-12 place-items-center rounded-full bg-success/10 text-success"
          }
        >
          {failed ? (
            <CircleAlert aria-hidden="true" className="size-6" />
          ) : (
            <CircleCheck aria-hidden="true" className="size-6" />
          )}
        </span>
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">
          {failed ? "El enlace no es válido" : "¡Correo confirmado!"}
        </h1>
        <p className="mt-2 text-muted-foreground">
          {failed
            ? "Puede que haya vencido o que ya lo hayas usado. Pide uno nuevo para activar tu cuenta."
            : "Tu cuenta está activa. Ya puedes empezar a registrar tu inventario."}
        </p>
        <Button asChild size="lg" className="mt-6 w-full">
          {failed ? (
            <Link href="/verifica-tu-correo">Pedir un enlace nuevo</Link>
          ) : (
            <Link href="/inventario">Ir a mi inventario</Link>
          )}
        </Button>
      </div>
    </FadeIn>
  );
}
