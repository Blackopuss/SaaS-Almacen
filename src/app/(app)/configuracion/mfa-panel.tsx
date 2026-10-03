"use client";

import { Copy, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FormField, PasswordInput, QrCode } from "@/components";
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
import { Input } from "@/components/ui/input";

import { mfaSetupAction, type MfaSetupState } from "./actions";

/** Two-step verification status and enrollment (PLT-08A). */
export function MfaPanel({ enabled }: { enabled: boolean }) {
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

function MfaSetup({ onDone }: { onDone: () => void }) {
  const [state, formAction, pending] = useActionState<MfaSetupState, FormData>(
    mfaSetupAction,
    { step: "password" },
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const finished = useRef(false);

  useEffect(() => {
    if (state.step === "done") {
      // Report once, even if the dialog re-renders while it closes.
      if (!finished.current) onDone();
      finished.current = true;
    } else if (state.error && inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
  }, [state, onDone]);

  if (state.step === "password" || state.step === "done") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Activa la verificación en dos pasos</DialogTitle>
          <DialogDescription>
            Necesitarás una app de autenticación en tu teléfono, como Google
            Authenticator o Microsoft Authenticator. Primero confirma tu
            contraseña.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} noValidate className="space-y-5">
          <FormField
            id="mfa-password"
            label="Contraseña"
            error={state.step === "password" ? state.error : undefined}
          >
            {(control) => (
              <PasswordInput
                {...control}
                ref={inputRef}
                name="password"
                autoComplete="current-password"
                required
              />
            )}
          </FormField>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Verificando…" : "Continuar"}
          </Button>
        </form>
      </>
    );
  }

  const grouped = state.secret
    .replace(/=+$/, "")
    .match(/.{1,4}/g)
    ?.join(" ");

  return (
    <>
      <DialogHeader>
        <DialogTitle>Agrega tu cuenta a la app</DialogTitle>
        <DialogDescription>
          Escanea el código con tu app de autenticación o escribe la clave a
          mano. Después escribe el código de 6 números que te muestre.
        </DialogDescription>
      </DialogHeader>

      <div className="flex flex-col items-center gap-4">
        <QrCode
          value={state.totpUri}
          label="Código QR para agregar Almacén a tu app de autenticación"
          className="size-48 rounded-lg"
        />
        <Button asChild variant="outline" className="w-full md:hidden">
          <a href={state.totpUri}>
            <Smartphone aria-hidden="true" data-icon="inline-start" />
            Abrir en la app de este teléfono
          </a>
        </Button>
        <div className="w-full rounded-lg bg-muted p-3">
          <p className="text-sm text-muted-foreground">
            Clave para escribir a mano
          </p>
          <div className="mt-1 flex items-center justify-between gap-2">
            <code className="font-mono text-sm [overflow-wrap:anywhere]">
              {grouped}
            </code>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Copiar clave"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(state.secret);
                  toast.success("Clave copiada.");
                } catch {
                  toast.error("No se pudo copiar. Escríbela a mano.");
                }
              }}
            >
              <Copy aria-hidden="true" />
            </Button>
          </div>
        </div>
      </div>

      <form action={formAction} noValidate className="space-y-5">
        <FormField
          id="mfa-code"
          label="Código de 6 números"
          error={state.error}
        >
          {(control) => (
            <Input
              {...control}
              ref={inputRef}
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={7}
              spellCheck={false}
              className="font-mono tracking-widest"
              required
            />
          )}
        </FormField>
        <Button type="submit" className="w-full" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Confirmando…" : "Activar"}
        </Button>
      </form>
    </>
  );
}
