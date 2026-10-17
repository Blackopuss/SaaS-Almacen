"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";

import { BackupCodesList, FormField, PasswordInput } from "@/components";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

import {
  disableMfaAction,
  regenerateBackupCodesAction,
  type BackupCodesState,
  type DisableMfaState,
} from "./actions";

/** Dialog whose content starts over every time it opens. */
function FreshDialog({
  trigger,
  children,
}: {
  trigger: React.ReactNode;
  children: (close: () => void) => React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setKey((n) => n + 1);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent key={key} className="max-h-[90dvh] overflow-y-auto">
        {children(() => setOpen(false))}
      </DialogContent>
    </Dialog>
  );
}

/** Backup codes left and «Generar nuevos» (PLT-09). */
export function BackupCodesRow({ left }: { left: number }) {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div>
        <h4 className="font-medium">Códigos de recuperación</h4>
        <p className="text-sm text-muted-foreground">
          {left === 0
            ? "Ya no te quedan códigos. Genera nuevos por si pierdes tu teléfono."
            : `Te ${left === 1 ? "queda 1 código" : `quedan ${left} códigos`} para entrar si pierdes tu teléfono.`}
        </p>
      </div>
      <FreshDialog
        trigger={
          <Button variant={left <= 3 ? "default" : "outline"}>
            Generar nuevos
          </Button>
        }
      >
        {(close) => <RegenerateCodes onClose={close} />}
      </FreshDialog>
    </div>
  );
}

function RegenerateCodes({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState<
    BackupCodesState,
    FormData
  >(regenerateBackupCodesAction, {});
  const passwordRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (state.error) passwordRef.current?.focus();
  }, [state]);

  if (state.backupCodes) {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Tus nuevos códigos de recuperación</DialogTitle>
          <DialogDescription>
            Los anteriores ya no sirven. Guárdalos en un lugar seguro; no los
            volverás a ver.
          </DialogDescription>
        </DialogHeader>
        <BackupCodesList codes={state.backupCodes} />
        <DialogFooter>
          <Button onClick={onClose}>Listo</Button>
        </DialogFooter>
      </>
    );
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>¿Generar nuevos códigos?</DialogTitle>
        <DialogDescription>
          Los códigos que tienes ahora dejarán de servir. Confirma tu contraseña
          para continuar.
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} noValidate className="space-y-5">
        <FormField id="codes-password" label="Contraseña" error={state.error}>
          {(control) => (
            <PasswordInput
              {...control}
              ref={passwordRef}
              name="password"
              autoComplete="current-password"
              required
            />
          )}
        </FormField>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </DialogClose>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Generando…" : "Generar códigos"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

/** «Desactivar» for accounts where MFA is optional (PLT-09). */
export function DisableMfaRow() {
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
      <div>
        <h4 className="font-medium">Desactivar la verificación</h4>
        <p className="text-sm text-muted-foreground">
          Tu cuenta quedará protegida solo con tu contraseña.
        </p>
      </div>
      <FreshDialog trigger={<Button variant="outline">Desactivar</Button>}>
        {(close) => <DisableMfa onClose={close} />}
      </FreshDialog>
    </div>
  );
}

function DisableMfa({ onClose }: { onClose: () => void }) {
  const [state, formAction, pending] = useActionState<
    DisableMfaState,
    FormData
  >(disableMfaAction, {});
  const passwordRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const handled = useRef(false);

  useEffect(() => {
    // Success is announced by MfaPanel when the status changes.
    if (state.done) {
      if (handled.current) return;
      handled.current = true;
      onClose();
      router.refresh();
    } else if (state.error) {
      passwordRef.current?.focus();
    }
  }, [state, onClose, router]);

  return (
    <>
      <DialogHeader>
        <DialogTitle>¿Desactivar la verificación en dos pasos?</DialogTitle>
        <DialogDescription>
          Para confirmar que eres tú, escribe tu contraseña y un código de tu
          app o uno de tus códigos de recuperación.
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} noValidate className="space-y-5">
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <FormField id="disable-password" label="Contraseña">
          {(control) => (
            <PasswordInput
              {...control}
              ref={passwordRef}
              name="password"
              autoComplete="current-password"
              required
            />
          )}
        </FormField>
        <FormField id="disable-code" label="Código de tu app o de recuperación">
          {(control) => (
            <Input
              {...control}
              name="code"
              autoComplete="one-time-code"
              spellCheck={false}
              autoCapitalize="none"
              className="font-mono"
              required
            />
          )}
        </FormField>
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </DialogClose>
          <Button type="submit" variant="destructive" disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Desactivando…" : "Desactivar"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
