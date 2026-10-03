"use client";

import { Copy, Loader2, Smartphone } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  BackupCodesList,
  FormField,
  PasswordInput,
  QrCode,
} from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import { mfaSetupAction, type MfaSetupState } from "./actions";

export type MfaSetupHeading = (props: {
  title: string;
  description: string;
}) => React.ReactNode;

/**
 * MFA enrollment steps (PLT-08A): password, then QR/key and the first code.
 * Used in the Configuración dialog and on the mandatory setup screen
 * (PLT-08B); `Heading` renders the title for each place.
 */
export function MfaSetup({
  onDone,
  Heading,
}: {
  onDone: () => void;
  Heading: MfaSetupHeading;
}) {
  const [state, formAction, pending] = useActionState<MfaSetupState, FormData>(
    mfaSetupAction,
    { step: "password" },
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (state.step !== "codes" && state.error && inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.focus();
    }
  }, [state]);

  if (state.step === "codes") {
    return (
      <>
        <Heading
          title="Guarda tus códigos de recuperación"
          description="La verificación en dos pasos ya está activada. Si pierdes tu teléfono, entra con uno de estos códigos; cada uno sirve una sola vez. No los volverás a ver."
        />
        <BackupCodesList codes={state.backupCodes} />
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={saved}
            onChange={(event) => setSaved(event.target.checked)}
            className="size-5 shrink-0 accent-primary"
          />
          Ya guardé mis códigos en un lugar seguro
        </label>
        <Button
          type="button"
          className="w-full"
          disabled={!saved}
          onClick={onDone}
        >
          Listo
        </Button>
      </>
    );
  }

  if (state.step === "password") {
    return (
      <>
        <Heading
          title="Activa la verificación en dos pasos"
          description="Necesitarás una app de autenticación en tu teléfono, como Google Authenticator o Microsoft Authenticator. Primero confirma tu contraseña."
        />
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
      <Heading
        title="Agrega tu cuenta a la app"
        description="Escanea el código con tu app de autenticación o escribe la clave a mano. Después escribe el código de 6 números que te muestre."
      />

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
