"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";

import { LegalConsent } from "@/components";
import { Button } from "@/components/ui/button";

import { signOutAction } from "../../(app)/actions";
import { acceptLegalAction, type AcceptLegalState } from "./actions";

const link =
  "rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

export function AcceptLegalForm({
  documents,
}: {
  documents: { id: string; title: string; href: string; date: string }[];
}) {
  const [state, formAction, pending] = useActionState<
    AcceptLegalState,
    FormData
  >(acceptLegalAction, {});

  return (
    <>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Revisa nuestros documentos
        </h1>
        <p className="text-muted-foreground">
          Para seguir usando Almacén necesitamos que aceptes la versión vigente
          de:
        </p>
      </div>
      <ul className="mt-4 space-y-2 text-sm">
        {documents.map((document) => (
          <li key={document.id}>
            <a
              href={document.href}
              target="_blank"
              rel="noopener"
              className={link}
            >
              {document.title}
            </a>{" "}
            <span className="text-muted-foreground">
              · versión del {document.date}
            </span>
          </li>
        ))}
      </ul>
      <form action={formAction} noValidate className="mt-6 space-y-5">
        <LegalConsent error={state.error} />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Guardando…" : "Aceptar y continuar"}
        </Button>
      </form>
      <form action={signOutAction} className="mt-6 text-center text-sm">
        <span className="text-muted-foreground">¿No estás de acuerdo? </span>
        <button
          type="submit"
          className="inline-flex min-h-11 items-center rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 md:min-h-0"
        >
          Cerrar sesión
        </button>
      </form>
    </>
  );
}
