"use client";

import { CircleCheck, Loader2, ShieldAlert } from "lucide-react";
import { useState } from "react";

import { FormField, PasswordInput } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";

import {
  authorizeDiscountAction,
  type DiscountAuthorizationState,
} from "./actions";
import type { CartQuote } from "@/modules/sales";

export type Authorization = {
  authorizationId: string;
  summary: string;
  /** «10.00»: the largest percent it allows. */
  percent: string;
};

/**
 * A discount of the whole sale (VEN-14): percent and reason. Above the
 * cashier's cap — or below cost without that permission — a supervisor
 * allows it right here with their password.
 */
export function DiscountPanel({
  percent,
  reason,
  onPercent,
  onReason,
  discount,
  authorizers,
  authorization,
  onAuthorization,
  error,
}: {
  percent: string;
  reason: string;
  onPercent: (percent: string) => void;
  onReason: (reason: string) => void;
  /** What the server says about the discount typed. */
  discount: CartQuote["discount"];
  authorizers: { userId: string; name: string; cap: string }[];
  /** A valid authorization for this percent, if there is one. */
  authorization: Authorization | null;
  onAuthorization: (authorization: Authorization | null) => void;
  /** Problem the server found when charging. */
  error?: string;
}) {
  const [authorizer, setAuthorizer] = useState(authorizers[0]?.userId ?? "");
  const [password, setPassword] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<DiscountAuthorizationState>({
    status: "idle",
  });
  const refused = answer.status === "refused" ? answer : null;
  const needs =
    discount !== null &&
    (discount.needsAuthorization || discount.belowCost) &&
    authorization === null;

  async function ask() {
    setAsking(true);
    try {
      const result = await authorizeDiscountAction({
        authorizerUserId: authorizer,
        password,
        percent,
        reason,
      });
      setAnswer(result);
      setPassword("");
      if (result.status === "allowed") {
        onAuthorization({
          authorizationId: result.authorizationId,
          summary: result.summary,
          percent: result.percent,
        });
      }
    } catch {
      setAnswer({
        status: "refused",
        fieldErrors: {},
        formError: "No pudimos pedir la autorización. Revisa tu conexión.",
      });
    } finally {
      setAsking(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-[8rem_1fr] gap-2">
        <FormField
          id="descuento"
          label="Descuento (%)"
          error={refused?.fieldErrors.percent}
        >
          {(control) => (
            <Input
              {...control}
              value={percent}
              onChange={(event) => onPercent(event.target.value)}
              inputMode="decimal"
              autoComplete="off"
              maxLength={6}
              className="tabular-nums"
            />
          )}
        </FormField>
        <FormField
          id="descuento-motivo"
          label="Motivo"
          error={refused?.fieldErrors.reason}
        >
          {(control) => (
            <Input
              {...control}
              value={reason}
              onChange={(event) => onReason(event.target.value)}
              autoComplete="off"
              maxLength={200}
              placeholder="Compra grande"
            />
          )}
        </FormField>
      </div>

      {authorization && (
        <p className="flex items-start gap-2 text-sm text-success">
          <CircleCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {authorization.summary}
        </p>
      )}

      {needs && (
        <div className="space-y-3 rounded-lg border border-warning/40 bg-warning/10 p-3">
          <p className="flex items-start gap-2 text-sm">
            <ShieldAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-warning"
            />
            {discount.belowCost
              ? "Con este descuento hay productos por debajo de su costo: lo autoriza un administrador o el titular."
              : `Tu tope de descuento es ${discount.cap}. Pide que lo autorice un encargado.`}
          </p>
          {authorizers.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nadie más en tu equipo puede autorizar descuentos.
            </p>
          ) : (
            <>
              <FormField
                id="autoriza"
                label="Quién autoriza"
                error={refused?.fieldErrors.authorizer}
              >
                {(control) => (
                  <NativeSelect
                    {...control}
                    value={authorizer}
                    onChange={(event) => setAuthorizer(event.target.value)}
                  >
                    {authorizers.map((person) => (
                      <option key={person.userId} value={person.userId}>
                        {person.name} · hasta {person.cap}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </FormField>
              <FormField
                id="autoriza-contrasena"
                label="Su contraseña"
                error={refused?.fieldErrors.password}
              >
                {(control) => (
                  <PasswordInput
                    {...control}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="off"
                    onKeyDown={(event) => {
                      // Enter here asks for the authorization, not the sale.
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void ask();
                      }
                    }}
                  />
                )}
              </FormField>
              {refused?.formError && (
                <p role="alert" className="text-sm text-destructive">
                  {refused.formError}
                </p>
              )}
              <Button
                type="button"
                variant="outline"
                disabled={asking}
                onClick={() => void ask()}
              >
                {asking && (
                  <Loader2 aria-hidden="true" className="animate-spin" />
                )}
                Autorizar
              </Button>
            </>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
