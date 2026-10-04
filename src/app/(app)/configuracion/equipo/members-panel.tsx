"use client";

import { Loader2, UserCheck, UserCog, UserX } from "lucide-react";
import {
  useActionState,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  assignRolesAction,
  disableMemberAction,
  reactivateMemberAction,
  type TeamActionState,
} from "./actions";
import { RoleCheckboxes, type RoleOption } from "./role-checkboxes";

export type MemberRow = {
  userId: string;
  name: string;
  email: string;
  disabled: boolean;
  isOwner: boolean;
  isMe: boolean;
  roles: RoleOption[];
  canAssign: boolean;
  canDisable: boolean;
};

type Editing = { kind: "roles" | "disable"; member: MemberRow } | null;

export function MembersPanel({
  members,
  roleOptions,
}: {
  members: MemberRow[];
  roleOptions: RoleOption[];
}) {
  const [editing, setEditing] = useState<Editing>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function reactivate(member: MemberRow) {
    setPendingId(member.userId);
    startTransition(async () => {
      const result = await reactivateMemberAction(member.userId);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      setPendingId(null);
    });
  }

  return (
    <section aria-labelledby="personas" className="rounded-xl border bg-card">
      <div className="border-b p-4 sm:p-5">
        <h2 id="personas" className="font-medium">
          Personas
        </h2>
        <p className="text-sm text-muted-foreground">
          {members.filter((m) => !m.disabled).length} con acceso activo.
        </p>
      </div>
      <ul className="divide-y">
        {members.map((member) => (
          <li
            key={member.userId}
            className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-medium">
                <span
                  className={member.disabled ? "text-muted-foreground" : ""}
                >
                  {member.name}
                </span>
                {member.isMe && <Badge variant="outline">Tú</Badge>}
                {member.disabled && (
                  <Badge variant="secondary">Desactivado</Badge>
                )}
              </p>
              <p className="text-sm [overflow-wrap:anywhere] text-muted-foreground">
                {member.email}
              </p>
              <p className="mt-2 flex flex-wrap gap-1.5">
                {member.isOwner && <Badge>Titular</Badge>}
                {member.roles.map((role) => (
                  <Badge key={role.id} variant="secondary">
                    {role.label}
                  </Badge>
                ))}
                {!member.isOwner && member.roles.length === 0 && (
                  <Badge variant="warning">Sin rol</Badge>
                )}
              </p>
            </div>
            {(member.canAssign || member.canDisable) && (
              <div className="flex flex-wrap gap-2">
                {member.canAssign && (
                  <Button
                    variant="outline"
                    onClick={() => setEditing({ kind: "roles", member })}
                    aria-label={`Cambiar roles de ${member.name}`}
                  >
                    <UserCog aria-hidden="true" data-icon="inline-start" />
                    Roles
                  </Button>
                )}
                {member.canDisable &&
                  (member.disabled ? (
                    <Button
                      variant="outline"
                      onClick={() => reactivate(member)}
                      disabled={pendingId === member.userId}
                      aria-label={`Reactivar a ${member.name}`}
                    >
                      {pendingId === member.userId ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <UserCheck
                          aria-hidden="true"
                          data-icon="inline-start"
                        />
                      )}
                      Reactivar
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      onClick={() => setEditing({ kind: "disable", member })}
                      aria-label={`Desactivar a ${member.name}`}
                    >
                      <UserX aria-hidden="true" data-icon="inline-start" />
                      Desactivar
                    </Button>
                  ))}
              </div>
            )}
          </li>
        ))}
      </ul>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent>
          {editing?.kind === "roles" && (
            <RolesForm
              key={editing.member.userId}
              member={editing.member}
              roleOptions={roleOptions}
              onDone={() => setEditing(null)}
            />
          )}
          {editing?.kind === "disable" && (
            <DisableForm
              key={editing.member.userId}
              member={editing.member}
              onDone={() => setEditing(null)}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function useTeamAction(
  action: (
    prev: TeamActionState | null,
    formData: FormData,
  ) => Promise<TeamActionState>,
  onDone: () => void,
) {
  const [state, formAction, pending] = useActionState(action, null);
  // Each result is reported once, even if the parent re-renders.
  const handled = useRef<TeamActionState | null>(null);
  useEffect(() => {
    if (state?.ok && handled.current !== state) {
      handled.current = state;
      toast.success(state.message);
      onDone();
    }
  }, [state, onDone]);
  return {
    error: state && !state.ok ? state.message : null,
    formAction,
    pending,
  };
}

function RolesForm({
  member,
  roleOptions,
  onDone,
}: {
  member: MemberRow;
  roleOptions: RoleOption[];
  onDone: () => void;
}) {
  const { error, formAction, pending } = useTeamAction(
    assignRolesAction,
    onDone,
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>Roles de {member.name}</DialogTitle>
        <DialogDescription>
          El cambio aplica de inmediato, sin que tenga que volver a entrar.
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="userId" value={member.userId} />
        <RoleCheckboxes
          idPrefix="member"
          options={roleOptions}
          defaultSelected={member.roles.map((role) => role.id)}
          error={error ?? undefined}
        />
        <DialogFooter>
          <DialogClose asChild>
            <Button type="button" variant="outline">
              Cancelar
            </Button>
          </DialogClose>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 aria-hidden="true" className="animate-spin" />}
            {pending ? "Guardando…" : "Guardar roles"}
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}

function DisableForm({
  member,
  onDone,
}: {
  member: MemberRow;
  onDone: () => void;
}) {
  const { error, formAction, pending } = useTeamAction(
    disableMemberAction,
    onDone,
  );
  return (
    <>
      <DialogHeader>
        <DialogTitle>¿Desactivar a {member.name}?</DialogTitle>
        <DialogDescription>
          Perderá el acceso de inmediato y cerraremos sus sesiones. Lo que hizo
          se conserva en el historial con su nombre, y puedes reactivarle
          después.
        </DialogDescription>
      </DialogHeader>
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="userId" value={member.userId} />
        <div className="space-y-2">
          <Label htmlFor="disable-reason">Motivo (opcional)</Label>
          <Input
            id="disable-reason"
            name="reason"
            maxLength={500}
            autoComplete="off"
            aria-describedby={error ? "disable-error" : undefined}
          />
        </div>
        {error && (
          <p
            id="disable-error"
            role="alert"
            className="text-sm text-destructive"
          >
            {error}
          </p>
        )}
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
