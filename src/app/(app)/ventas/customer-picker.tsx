"use client";

import { Loader2, Search, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { FormField } from "@/components";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import {
  createCustomerAction,
  findCustomersAction,
  type NewCustomerState,
  type SaleCustomer as CustomerSummary,
} from "./actions";

/**
 * Who buys (VEN-08): nobody in particular — «Público en general» — unless
 * the cashier looks up a customer or registers a new one. It lives inside
 * the sale form, so it uses buttons instead of a form of its own.
 */
export function CustomerPicker({
  value,
  onChange,
  canCreate,
}: {
  value: CustomerSummary | null;
  onChange: (customer: CustomerSummary | null) => void;
  /** The server says whether this person may register customers. */
  canCreate: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<CustomerSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState({ name: "", phone: "", rfc: "" });
  const [saving, setSaving] = useState(false);
  const [answer, setAnswer] = useState<NewCustomerState>({ status: "idle" });
  const searchRef = useRef<HTMLInputElement>(null);

  function choose(customer: CustomerSummary | null) {
    onChange(customer);
    setOpen(false);
    setQuery("");
    setFound(null);
    setCreating(false);
    setAnswer({ status: "idle" });
  }

  async function search() {
    const typed = query.trim();
    if (typed === "") return;
    setSearching(true);
    try {
      setFound(await findCustomersAction(typed));
    } catch {
      setFound([]);
    } finally {
      setSearching(false);
    }
  }

  async function save(acceptDuplicates: boolean) {
    setSaving(true);
    try {
      const result = await createCustomerAction({ ...draft, acceptDuplicates });
      if (result.status === "saved") choose(result.customer);
      else setAnswer(result);
    } catch {
      setAnswer({
        status: "rejected",
        fieldErrors: {},
        formError: "No pudimos guardarlo. Revisa tu conexión.",
      });
    } finally {
      setSaving(false);
    }
  }

  const rejected = answer.status === "rejected" ? answer : null;
  const boxRef = useRef<HTMLDivElement>(null);

  // A refused save takes the focus to the first field to fix (PIL-07).
  useEffect(() => {
    if (answer.status !== "rejected") return;
    const first = (["name", "phone", "rfc"] as const).find(
      (field) => answer.fieldErrors[field],
    );
    const id = first
      ? {
          name: "cliente-nombre",
          phone: "cliente-telefono",
          rfc: "cliente-rfc",
        }[first]
      : null;
    if (id) boxRef.current?.querySelector<HTMLElement>(`#${id}`)?.focus();
  }, [answer]);

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
          <UserRound aria-hidden="true" className="size-4" />
        </span>
        <p className="min-w-0 flex-1 text-sm">
          <span className="block font-medium [overflow-wrap:anywhere]">
            {value?.name ?? "Público en general"}
          </span>
          {value && (value.phone || value.rfc) && (
            <span className="block text-muted-foreground">
              {[value.phone, value.rfc].filter(Boolean).join(" · ")}
            </span>
          )}
        </p>
        {value ? (
          <Button type="button" variant="ghost" onClick={() => choose(null)}>
            Quitar cliente
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setOpen(true);
              setTimeout(() => searchRef.current?.focus(), 0);
            }}
          >
            Elegir cliente
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label htmlFor="buscar-cliente" className="sr-only">
          Nombre, teléfono o RFC del cliente
        </label>
        <Input
          ref={searchRef}
          id="buscar-cliente"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
          placeholder="Nombre, teléfono o RFC"
          maxLength={100}
          autoComplete="off"
        />
        <Button type="button" variant="outline" onClick={() => void search()}>
          {searching ? (
            <Loader2
              aria-hidden="true"
              data-icon="inline-start"
              className="animate-spin"
            />
          ) : (
            <Search aria-hidden="true" data-icon="inline-start" />
          )}
          Buscar
        </Button>
      </div>
      {found !== null && (
        <p role="status" className="text-sm text-muted-foreground">
          {found.length === 0
            ? `No hay clientes con «${query.trim()}».`
            : "Elige al cliente:"}
        </p>
      )}
      {found && found.length > 0 && (
        <ul
          aria-label="Clientes encontrados"
          className="divide-y rounded-lg border"
        >
          {found.map((customer) => (
            <li key={customer.id}>
              <button
                type="button"
                onClick={() => choose(customer)}
                className="flex min-h-11 w-full flex-col items-start p-3 text-left text-sm outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset"
              >
                <span className="font-medium">{customer.name}</span>
                {(customer.phone || customer.rfc) && (
                  <span className="text-muted-foreground">
                    {[customer.phone, customer.rfc].filter(Boolean).join(" · ")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {canCreate && !creating && (
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setCreating(true);
            setDraft({ name: query.trim(), phone: "", rfc: "" });
          }}
        >
          Registrar cliente nuevo
        </Button>
      )}
      {creating && (
        <div ref={boxRef} className="space-y-3 rounded-lg border p-3">
          <FormField
            id="cliente-nombre"
            label="Nombre"
            error={rejected?.fieldErrors.name}
          >
            {(control) => (
              <Input
                {...control}
                value={draft.name}
                onChange={(event) =>
                  setDraft({ ...draft, name: event.target.value })
                }
                maxLength={160}
                autoComplete="off"
              />
            )}
          </FormField>
          <FormField
            id="cliente-telefono"
            label="Teléfono (opcional)"
            error={rejected?.fieldErrors.phone}
          >
            {(control) => (
              <Input
                {...control}
                type="tel"
                value={draft.phone}
                onChange={(event) =>
                  setDraft({ ...draft, phone: event.target.value })
                }
                maxLength={40}
                autoComplete="off"
              />
            )}
          </FormField>
          <FormField
            id="cliente-rfc"
            label="RFC (opcional)"
            error={rejected?.fieldErrors.rfc}
          >
            {(control) => (
              <Input
                {...control}
                value={draft.rfc}
                onChange={(event) =>
                  setDraft({ ...draft, rfc: event.target.value })
                }
                maxLength={20}
                autoComplete="off"
                autoCapitalize="characters"
              />
            )}
          </FormField>
          {rejected?.formError && (
            <p role="alert" className="text-sm text-destructive">
              {rejected.formError}
            </p>
          )}
          {rejected?.duplicates && (
            <div role="alert" className="space-y-2 text-sm">
              <p>Ya hay un cliente así. ¿Es alguno de estos?</p>
              <ul className="space-y-1">
                {rejected.duplicates.map((customer) => (
                  <li key={customer.id}>
                    <Button type="button" onClick={() => choose(customer)}>
                      Usar {customer.name}
                      {customer.phone ? ` · ${customer.phone}` : ""}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={rejected?.duplicates ? "outline" : "default"}
              disabled={saving}
              onClick={() => void save(Boolean(rejected?.duplicates))}
            >
              {saving && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              {rejected?.duplicates
                ? "Guardar de todos modos"
                : "Guardar cliente"}
            </Button>
          </div>
        </div>
      )}
      <Button type="button" variant="ghost" onClick={() => choose(value)}>
        Cancelar
      </Button>
    </div>
  );
}
