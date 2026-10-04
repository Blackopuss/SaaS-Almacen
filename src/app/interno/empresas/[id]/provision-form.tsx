"use client";

import { CircleAlert, CircleCheck, Loader2 } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import type { ProvisionState } from "./actions";

type ModuleOption = {
  id: string;
  name: string;
  required: boolean;
  needs: string[];
};

type Tier = { productLimit: number; users: number };

const FIELD_ORDER = ["productLimit", "users", "validUntil", "reason"] as const;

/** Date part (YYYY-MM-DD) of an instant, as seen in central Mexico. */
function dateInMexico(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
  }).format(new Date(iso));
}

export function ProvisionForm({
  action,
  modules,
  tiers,
  current,
}: {
  action: (prev: ProvisionState, formData: FormData) => Promise<ProvisionState>;
  modules: ModuleOption[];
  tiers: Tier[];
  current: {
    productLimit: number | null;
    users: number | null;
    modules: string[];
    validUntil: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(action, {
    fieldErrors: {},
  });
  const [productLimit, setProductLimit] = useState(
    String(current.productLimit ?? ""),
  );
  const [users, setUsers] = useState(String(current.users ?? ""));
  const formRef = useRef<HTMLFormElement>(null);
  // A rejected submit keeps what was typed; a saved one starts from the
  // plan now in force.
  const shown = state.values ?? {
    modules: current.modules,
    validUntil: current.validUntil ? dateInMexico(current.validUntil) : "",
    reason: "",
  };
  const attempt = JSON.stringify(shown);

  // After a failed submit, move focus to the first field with an error.
  useEffect(() => {
    const first = FIELD_ORDER.find((field) => state.fieldErrors[field]);
    if (first)
      formRef.current?.querySelector<HTMLElement>(`#${first}`)?.focus();
  }, [state]);

  return (
    <section
      aria-labelledby="asignar-plan"
      className="rounded-xl border bg-card p-4 sm:p-5"
    >
      <h2 id="asignar-plan" className="font-medium">
        Asignar plan
      </h2>
      <p className="text-sm text-muted-foreground">
        Reemplaza el plan actual. Queda en la bitácora de la empresa con tu
        nombre y el motivo.
      </p>

      {state.formError && (
        <div
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
        >
          <CircleAlert
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-destructive"
          />
          {state.formError}
        </div>
      )}
      {state.saved && (
        <div
          role="status"
          className="mt-4 flex items-start gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-foreground"
        >
          <CircleCheck
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 text-success"
          />
          Plan asignado. La empresa ya puede usarlo.
        </div>
      )}

      <form
        ref={formRef}
        action={formAction}
        noValidate
        className="mt-5 space-y-5"
      >
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Niveles propuestos</legend>
          <div className="flex flex-wrap gap-2">
            {tiers.map((tier) => (
              <Button
                key={tier.productLimit}
                type="button"
                variant="outline"
                onClick={() => {
                  setProductLimit(String(tier.productLimit));
                  setUsers(String(tier.users));
                }}
              >
                {tier.productLimit.toLocaleString("es-MX")} productos ·{" "}
                {tier.users} usuarios
              </Button>
            ))}
          </div>
        </fieldset>

        <div className="grid gap-5 sm:grid-cols-2">
          <FormField
            id="productLimit"
            label="Cupo de productos activos"
            error={state.fieldErrors.productLimit}
          >
            {(control) => (
              <Input
                {...control}
                name="productLimit"
                inputMode="numeric"
                autoComplete="off"
                value={productLimit}
                onChange={(event) => setProductLimit(event.target.value)}
                required
              />
            )}
          </FormField>
          <FormField
            id="users"
            label="Usuarios incluidos"
            error={state.fieldErrors.users}
          >
            {(control) => (
              <Input
                {...control}
                name="users"
                inputMode="numeric"
                autoComplete="off"
                value={users}
                onChange={(event) => setUsers(event.target.value)}
                required
              />
            )}
          </FormField>
        </div>

        <fieldset
          className="space-y-2"
          aria-describedby={
            state.fieldErrors.modules ? "modules-error" : undefined
          }
        >
          <legend className="text-sm font-medium">Módulos</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {modules.map((option) => (
              <label
                key={option.id}
                className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 transition-colors hover:bg-muted/50 has-checked:border-primary has-checked:bg-primary/5 has-focus-visible:ring-3 has-focus-visible:ring-ring/50"
              >
                <input
                  type="checkbox"
                  name="modules"
                  value={option.id}
                  key={`${option.id}-${attempt}`}
                  defaultChecked={
                    state.values
                      ? shown.modules.includes(option.id)
                      : option.required || shown.modules.includes(option.id)
                  }
                  className="mt-0.5 size-5 shrink-0 accent-primary outline-none"
                />
                <span className="min-w-0">
                  <span className="block font-medium">{option.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {option.required
                      ? "Base obligatoria."
                      : option.needs.length > 0
                        ? `Necesita ${option.needs.join(" y ")}.`
                        : "Opcional."}
                  </span>
                </span>
              </label>
            ))}
          </div>
          {state.fieldErrors.modules && (
            <p
              id="modules-error"
              className="flex items-start gap-1.5 text-sm text-destructive"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              {state.fieldErrors.modules}
            </p>
          )}
        </fieldset>

        <FormField
          id="validUntil"
          label="Vigente hasta (opcional)"
          hint="Déjalo vacío para un plan sin fecha de término. Termina al final de ese día, hora del centro de México."
          error={state.fieldErrors.validUntil}
        >
          {(control) => (
            <Input
              {...control}
              name="validUntil"
              type="date"
              key={`validUntil-${attempt}`}
              defaultValue={shown.validUntil}
              className="sm:max-w-xs"
            />
          )}
        </FormField>

        <FormField
          id="reason"
          label="Motivo"
          hint="Por ejemplo: «Pago SPEI del 3 de octubre, folio 8841»."
          error={state.fieldErrors.reason}
        >
          {(control) => (
            <Input
              {...control}
              name="reason"
              key={`reason-${attempt}`}
              defaultValue={shown.reason}
              autoComplete="off"
              maxLength={500}
              required
            />
          )}
        </FormField>

        <Button type="submit" disabled={pending}>
          {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
          {pending ? "Asignando…" : "Asignar plan"}
        </Button>
      </form>
    </section>
  );
}
