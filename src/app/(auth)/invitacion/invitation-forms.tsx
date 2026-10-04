"use client";

import { CircleAlert, Loader2, MailCheck } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormField, PasswordInput } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  acceptInvitationAction,
  invitationSignOutAction,
  joinAsNewUserAction,
  type AcceptInvitationState,
  type JoinAsNewUserState,
} from "./actions";

export type InvitationSummary = {
  organizationName: string;
  email: string;
  roles: string[];
};

function Heading({ invitation }: { invitation: InvitationSummary }) {
  return (
    <>
      <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
        <MailCheck aria-hidden="true" className="size-6" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight text-balance">
        Te invitaron a {invitation.organizationName}
      </h1>
      <dl className="mt-4 space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">Correo invitado</dt>
          <dd className="min-w-0 font-medium break-all">{invitation.email}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1">
          <dt className="text-muted-foreground">
            {invitation.roles.length === 1 ? "Rol" : "Roles"}
          </dt>
          <dd className="font-medium">{invitation.roles.join(", ")}</dd>
        </div>
      </dl>
    </>
  );
}

function FormError({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="alert"
      className="mt-6 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-destructive"
      />
      <span>{children}</span>
    </div>
  );
}

/** Signed in with the invited email: one button. */
export function AcceptForm({
  token,
  invitation,
}: {
  token: string;
  invitation: InvitationSummary;
}) {
  const [state, formAction, pending] = useActionState<
    AcceptInvitationState,
    FormData
  >(acceptInvitationAction, {});

  if (state.invalid) return <InvalidInvitation />;

  return (
    <>
      <Heading invitation={invitation} />
      {state.error && <FormError>{state.error}</FormError>}
      <form action={formAction} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Aceptando…" : "Aceptar invitación"}
        </Button>
      </form>
    </>
  );
}

/** No account yet: name and password. */
export function JoinForm({
  token,
  invitation,
  minLength,
}: {
  token: string;
  invitation: InvitationSummary;
  minLength: number;
}) {
  const [state, formAction, pending] = useActionState<
    JoinAsNewUserState,
    FormData
  >(joinAsNewUserAction, { fieldErrors: {}, values: { name: "" } });
  const formRef = useRef<HTMLFormElement>(null);

  // After a failed submit, move focus to the first field with an error.
  useEffect(() => {
    const first = (["name", "password"] as const).find(
      (field) => state.fieldErrors[field],
    );
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
  }, [state]);

  if (state.invalid) return <InvalidInvitation />;

  return (
    <>
      <Heading invitation={invitation} />
      <p className="mt-4 text-muted-foreground">
        Crea tu cuenta para entrar. Usaremos el correo invitado.
      </p>
      {state.formError && (
        <FormError>
          {state.formError}{" "}
          {state.hasAccount && (
            <Link
              href="/ingresar"
              className="rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Iniciar sesión
            </Link>
          )}
        </FormError>
      )}
      <form
        ref={formRef}
        action={formAction}
        noValidate
        className="mt-6 space-y-5"
      >
        <input type="hidden" name="token" value={token} />
        <FormField id="name" label="Tu nombre" error={state.fieldErrors.name}>
          {(control) => (
            <Input
              {...control}
              name="name"
              autoComplete="name"
              defaultValue={state.values.name}
              key={`name-${state.values.name}`}
              required
              maxLength={120}
            />
          )}
        </FormField>
        <FormField
          id="password"
          label="Contraseña"
          hint={`Mínimo ${minLength} caracteres. Una frase fácil de recordar funciona bien.`}
          error={state.fieldErrors.password}
        >
          {(control) => (
            <PasswordInput
              {...control}
              name="password"
              autoComplete="new-password"
              required
              minLength={minLength}
              maxLength={128}
            />
          )}
        </FormField>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Creando cuenta…" : "Crear cuenta y entrar"}
        </Button>
      </form>
    </>
  );
}

/** The invited email already has an account: sign in, then accept. */
export function SignInFirst({
  invitation,
  signInHref,
}: {
  invitation: InvitationSummary;
  signInHref: string;
}) {
  return (
    <>
      <Heading invitation={invitation} />
      <p className="mt-4 text-muted-foreground">
        Este correo ya tiene cuenta en Almacén. Inicia sesión para aceptar la
        invitación.
      </p>
      <Button asChild size="lg" className="mt-6 w-full">
        <Link href={signInHref}>Iniciar sesión</Link>
      </Button>
    </>
  );
}

/** Signed in with a different email than the invited one. */
export function WrongAccount({
  token,
  invitation,
  currentEmail,
}: {
  token: string;
  invitation: InvitationSummary;
  currentEmail: string;
}) {
  return (
    <>
      <Heading invitation={invitation} />
      <p className="mt-4 text-muted-foreground">
        Entraste como{" "}
        <span className="font-medium break-all text-foreground">
          {currentEmail}
        </span>
        . Para aceptar, cierra sesión y entra con el correo invitado.
      </p>
      <form action={invitationSignOutAction} className="mt-6">
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" variant="outline" className="w-full">
          Cerrar sesión y continuar
        </Button>
      </form>
    </>
  );
}

export function InvalidInvitation() {
  return (
    <>
      <span className="grid size-12 place-items-center rounded-full bg-destructive/10 text-destructive">
        <CircleAlert aria-hidden="true" className="size-6" />
      </span>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">
        La invitación no es válida
      </h1>
      <p className="mt-2 text-muted-foreground">
        Puede que haya vencido, que ya la hayas usado o que la hayan cancelado.
        Pide a quien te invitó que te envíe una nueva.
      </p>
      <Button asChild size="lg" variant="outline" className="mt-6 w-full">
        <Link href="/ingresar">Ir a iniciar sesión</Link>
      </Button>
    </>
  );
}
