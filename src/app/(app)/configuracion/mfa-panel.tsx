"use client";

import { ShieldCheck } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { MfaSetup, type MfaSetupHeading } from "./mfa-setup";

const DialogHeading: MfaSetupHeading = ({ title, description }) => (
  <DialogHeader>
    <DialogTitle>{title}</DialogTitle>
    <DialogDescription>{description}</DialogDescription>
  </DialogHeader>
);

/** Two-step verification status and enrollment (PLT-08A). */
export function MfaPanel({
  enabled,
  required,
}: {
  enabled: boolean;
  required: boolean;
}) {
  const [open, setOpen] = useState(false);
  // A new key on every opening starts the enrollment from the beginning.
  const [attempt, setAttempt] = useState(0);

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h3 className="flex flex-wrap items-center gap-2 font-medium">
              Verificación en dos pasos
              {enabled ? (
                <Badge variant="success">Activada</Badge>
              ) : (
                <Badge variant="secondary">Desactivada</Badge>
              )}
            </h3>
            <p className="text-sm text-muted-foreground">
              {enabled
                ? "Al entrar te pedimos tu contraseña y un código de tu app de autenticación."
                : "Protege tu cuenta con un código de tu teléfono además de tu contraseña."}
              {required && " Es obligatoria para el titular de la empresa."}
            </p>
          </div>
        </div>
        {/* Stays mounted after enabling so the dialog can close itself. */}
        <Dialog
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) setAttempt((n) => n + 1);
          }}
        >
          {!enabled && (
            <DialogTrigger asChild>
              <Button>Activar</Button>
            </DialogTrigger>
          )}
          <DialogContent className="max-h-[90dvh] overflow-y-auto">
            <MfaSetup
              key={attempt}
              Heading={DialogHeading}
              onDone={() => {
                setOpen(false);
                toast.success("Verificación en dos pasos activada.");
              }}
            />
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
