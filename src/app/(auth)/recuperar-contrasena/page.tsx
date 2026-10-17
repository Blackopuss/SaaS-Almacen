import type { Metadata } from "next";

import { WarehouseCard } from "@/components";
import { RESET_PASSWORD_MINUTES } from "@/platform/auth";

import { RecoverForm } from "./recover-form";

export const metadata: Metadata = {
  title: "Recuperar contraseña",
  description: "Recibe un enlace para elegir una contraseña nueva.",
};

export default function RecuperarContrasenaPage() {
  return (
    <WarehouseCard>
      <div className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">
          Recupera tu contraseña
        </h1>
        <p className="text-muted-foreground">
          Escribe el correo de tu cuenta y te enviaremos un enlace para elegir
          una contraseña nueva. Vence en {RESET_PASSWORD_MINUTES} minutos.
        </p>
      </div>
      <RecoverForm />
    </WarehouseCard>
  );
}
