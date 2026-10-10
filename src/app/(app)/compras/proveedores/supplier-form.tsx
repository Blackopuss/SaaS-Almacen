"use client";

import { CircleAlert, Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { SupplierFormState } from "./actions";

export const EMPTY_SUPPLIER: SupplierFormState["values"] = {
  name: "",
  legalName: "",
  rfc: "",
  contactPerson: "",
  email: "",
  phone: "",
  address: "",
  notes: "",
};

const FIELD_ORDER = [
  "name",
  "legalName",
  "rfc",
  "contactPerson",
  "phone",
  "email",
  "address",
  "notes",
] as const;

const areaClass =
  "w-full rounded-lg border border-input bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 aria-invalid:border-destructive md:text-sm";

/** Card of a supplier: used to create it and to edit it (CMP-02). */
export function SupplierForm({
  action,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (
    prev: SupplierFormState,
    formData: FormData,
  ) => Promise<SupplierFormState>;
  initial: SupplierFormState["values"];
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    fieldErrors: {},
    values: initial,
  });
  const formRef = useRef<HTMLFormElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const duplicates = state.duplicates ?? [];

  // After a refused submit, move focus to the first field with an error,
  // or to the message when the whole form was answered.
  useEffect(() => {
    const first = FIELD_ORDER.find((field) => state.fieldErrors[field]);
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
    else if (state.formError || (state.duplicates?.length ?? 0) > 0)
      alertRef.current?.focus();
  }, [state]);

  // React resets the form after its action: each field remounts with what
  // the person had written.
  const attempt = JSON.stringify(state.values);
  type Name = (typeof FIELD_ORDER)[number];
  const field = (name: Name) => ({ name, defaultValue: state.values[name] });
  const remount = (name: Name) => `${name}-${attempt}`;

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="max-w-2xl space-y-5 rounded-xl border bg-card p-4 sm:p-6"
    >
      {state.formError && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground outline-none"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {state.formError}
        </div>
      )}
      {duplicates.length > 0 && (
        <div
          ref={alertRef}
          role="alert"
          tabIndex={-1}
          className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm text-foreground outline-none"
        >
          <p className="flex items-start gap-2 font-medium">
            <CircleAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            {duplicates.length === 1
              ? "Ya tienes un contacto que parece el mismo. Todavía no se guardó nada."
              : "Ya tienes contactos que parecen el mismo. Todavía no se guardó nada."}
          </p>
          <ul className="space-y-1 pl-6">
            {duplicates.map((duplicate) => (
              <li key={duplicate.id}>
                {duplicate.isSupplier ? (
                  <Link
                    href={`/compras/proveedores/${duplicate.id}`}
                    className="inline-flex min-h-11 items-center rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
                  >
                    {duplicate.name}
                  </Link>
                ) : (
                  <span className="font-medium">{duplicate.name}</span>
                )}
                <span className="text-muted-foreground">
                  {" "}
                  ·{" "}
                  {duplicate.match === "rfc"
                    ? `mismo RFC (${duplicate.rfc})`
                    : "mismo nombre"}
                  {!duplicate.isSupplier && " · es un cliente"}
                  {duplicate.archived && " · archivado"}
                </span>
              </li>
            ))}
          </ul>
          <p>
            Si es otro negocio (una sucursal, un RFC genérico), guárdalo de
            todos modos. Si es el mismo, cancela y usa el que ya tienes.
          </p>
          <Button
            type="submit"
            name="acceptDuplicates"
            value="1"
            variant="outline"
            disabled={pending}
          >
            Guardar de todos modos
          </Button>
        </div>
      )}

      <FormField
        id="name"
        label="Nombre"
        hint="Como lo conoces: «Ferretera del Norte»."
        error={state.fieldErrors.name}
      >
        {(control) => (
          <Input
            {...control}
            {...field("name")}
            key={remount("name")}
            maxLength={160}
            autoComplete="off"
            required
          />
        )}
      </FormField>

      <div className="grid gap-5 sm:grid-cols-2">
        <FormField
          id="legalName"
          label="Razón social (opcional)"
          hint="Si es distinta del nombre."
          error={state.fieldErrors.legalName}
        >
          {(control) => (
            <Input
              {...control}
              {...field("legalName")}
              key={remount("legalName")}
              maxLength={200}
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField
          id="rfc"
          label="RFC (opcional)"
          hint="12 o 13 caracteres. Puedes pegarlo con guiones o espacios."
          error={state.fieldErrors.rfc}
        >
          {(control) => (
            <Input
              {...control}
              {...field("rfc")}
              key={remount("rfc")}
              maxLength={20}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="uppercase placeholder:normal-case"
            />
          )}
        </FormField>
        <FormField
          id="contactPerson"
          label="Persona de contacto (opcional)"
          error={state.fieldErrors.contactPerson}
        >
          {(control) => (
            <Input
              {...control}
              {...field("contactPerson")}
              key={remount("contactPerson")}
              maxLength={120}
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField
          id="phone"
          label="Teléfono (opcional)"
          error={state.fieldErrors.phone}
        >
          {(control) => (
            <Input
              {...control}
              {...field("phone")}
              key={remount("phone")}
              type="tel"
              inputMode="tel"
              maxLength={40}
              autoComplete="off"
            />
          )}
        </FormField>
      </div>

      <FormField
        id="email"
        label="Correo (opcional)"
        hint="A donde se le enviarán las órdenes de compra."
        error={state.fieldErrors.email}
      >
        {(control) => (
          <Input
            {...control}
            {...field("email")}
            key={remount("email")}
            type="email"
            inputMode="email"
            maxLength={254}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
          />
        )}
      </FormField>

      <FormField
        id="address"
        label="Dirección (opcional)"
        error={state.fieldErrors.address}
      >
        {(control) => (
          <Input
            {...control}
            {...field("address")}
            key={remount("address")}
            maxLength={300}
            autoComplete="off"
          />
        )}
      </FormField>

      <FormField
        id="notes"
        label="Notas (opcional)"
        hint="Días de entrega, condiciones, a quién pedirle."
        error={state.fieldErrors.notes}
      >
        {(control) => (
          <textarea
            {...control}
            {...field("notes")}
            key={remount("notes")}
            rows={3}
            maxLength={500}
            className={areaClass}
          />
        )}
      </FormField>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button asChild variant="outline">
          <Link href={cancelHref}>Cancelar</Link>
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Guardando…" : submitLabel}
        </Button>
      </div>
    </form>
  );
}
