"use client";

import { CircleAlert, Loader2, UserPlus } from "lucide-react";
import { useActionState, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { FormField } from "@/components";
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

import { inviteAction, type InviteState } from "./actions";
import { RoleCheckboxes, type RoleOption } from "./role-checkboxes";

const initialState: InviteState = {
  fieldErrors: {},
  values: { email: "", roles: [] },
};

export function InviteDialog({ roleOptions }: { roleOptions: RoleOption[] }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    async (prev: InviteState, formData: FormData) => {
      const next = await inviteAction(prev, formData);
      if (next.sentTo) {
        toast.success(`Invitación enviada a ${next.sentTo}.`);
        setOpen(false);
      }
      return next;
    },
    initialState,
  );
  const emailRef = useRef<HTMLInputElement>(null);

  // After a rejected address, focus the field again.
  useEffect(() => {
    if (state.fieldErrors.email) emailRef.current?.focus();
  }, [state]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus aria-hidden="true" data-icon="inline-start" />
          Invitar persona
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invitar a tu equipo</DialogTitle>
          <DialogDescription>
            Le enviaremos un enlace por correo. Vence en 7 días y solo funciona
            una vez.
          </DialogDescription>
        </DialogHeader>
        <form action={formAction} noValidate className="space-y-5">
          {state.formError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
            >
              <CircleAlert
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 text-destructive"
              />
              {state.formError}
            </div>
          )}
          <FormField
            id="invite-email"
            label="Correo electrónico"
            error={state.fieldErrors.email}
          >
            {(control) => (
              <Input
                {...control}
                ref={emailRef}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="off"
                spellCheck={false}
                defaultValue={state.values.email}
                key={`email-${state.values.email}`}
                required
                maxLength={254}
              />
            )}
          </FormField>
          <RoleCheckboxes
            key={`roles-${state.values.roles.join()}-${state.sentTo ?? ""}`}
            idPrefix="invite"
            options={roleOptions}
            defaultSelected={state.values.roles}
            error={state.fieldErrors.roles}
          />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">
                Cancelar
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending && (
                <Loader2 aria-hidden="true" className="animate-spin" />
              )}
              {pending ? "Enviando…" : "Enviar invitación"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
