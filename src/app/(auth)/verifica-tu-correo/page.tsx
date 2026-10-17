import { MailCheck } from "lucide-react";
import type { Metadata } from "next";

import { WarehouseCard } from "@/components";
import { VERIFICATION_HOURS } from "@/platform/auth";

import { ResendForm } from "./resend-form";

export const metadata: Metadata = { title: "Revisa tu correo" };

export default function VerificaTuCorreoPage() {
  return (
    <WarehouseCard>
      <span className="grid size-12 place-items-center rounded-full bg-accent text-accent-foreground">
        <MailCheck aria-hidden="true" className="size-6" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        Revisa tu correo
      </h1>
      <p className="mt-2 text-muted-foreground">
        Te enviamos un enlace para confirmar tu cuenta. Ábrelo desde este
        dispositivo o desde otro; vence en {VERIFICATION_HOURS} horas.
      </p>
      <p className="mt-2 text-sm text-muted-foreground">
        Si no lo ves, revisa tu carpeta de spam o promociones.
      </p>
      <div className="mt-6 border-t pt-6">
        <ResendForm />
      </div>
    </WarehouseCard>
  );
}
