"use client";

import { Check, ChevronsUpDown, Loader2, Store } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";

export type ShellOrganization = { id: string; name: string };

/**
 * Active company (PLT-11). A plain label with one company; with several,
 * a dialog to switch. The server re-checks the membership on every switch.
 */
export function OrganizationSwitcher({
  organization,
  organizations,
  switchOrganizationAction,
}: {
  organization: ShellOrganization;
  organizations: ShellOrganization[];
  switchOrganizationAction: (id: string) => Promise<{ error: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const label = (
    <>
      <Store aria-hidden="true" className="size-4.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">
        <span className="sr-only">Empresa: </span>
        {organization.name}
      </span>
    </>
  );

  if (organizations.length < 2) {
    return (
      <p className="flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground">
        {label}
      </p>
    );
  }

  function choose(id: string) {
    if (id === organization.id) {
      setOpen(false);
      return;
    }
    setPendingId(id);
    startTransition(async () => {
      // Redirects on success; only an error comes back.
      const result = await switchOrganizationAction(id);
      if (result?.error) toast.error(result.error);
      setPendingId(null);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger className="flex min-h-11 w-full items-center gap-2.5 rounded-lg px-3 text-sm font-medium text-muted-foreground transition-colors outline-none hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50">
        {label}
        <ChevronsUpDown aria-hidden="true" className="size-4 shrink-0" />
        <span className="sr-only">Cambiar de empresa</span>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Cambiar de empresa</DialogTitle>
          <DialogDescription>
            Elige en qué empresa quieres trabajar.
          </DialogDescription>
        </DialogHeader>
        <ul className="space-y-1">
          {organizations.map((org) => {
            const current = org.id === organization.id;
            return (
              <li key={org.id}>
                <button
                  type="button"
                  onClick={() => choose(org.id)}
                  disabled={pendingId !== null}
                  aria-current={current ? "true" : undefined}
                  className="flex min-h-12 w-full items-center gap-3 rounded-lg px-3 text-left font-medium transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60 aria-[current=true]:bg-accent aria-[current=true]:text-accent-foreground"
                >
                  <Store aria-hidden="true" className="size-5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{org.name}</span>
                  {pendingId === org.id ? (
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                  ) : (
                    current && <Check aria-hidden="true" className="size-4" />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
