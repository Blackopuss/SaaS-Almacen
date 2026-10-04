"use client";

import { Loader2, MailX, Send } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib";

import {
  cancelInvitationAction,
  resendInvitationAction,
  type TeamActionState,
} from "./actions";

export type InvitationRow = {
  id: string;
  email: string;
  roles: string[];
  expiresAt: string;
  expired: boolean;
  canResend: boolean;
  canCancel: boolean;
};

export function InvitationsPanel({
  invitations,
}: {
  invitations: InvitationRow[];
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function run(
    key: string,
    action: (id: string) => Promise<TeamActionState>,
    id: string,
  ) {
    setPending(key);
    startTransition(async () => {
      const result = await action(id);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      setPending(null);
    });
  }

  return (
    <section
      aria-labelledby="invitaciones"
      className="rounded-xl border bg-card"
    >
      <div className="border-b p-4 sm:p-5">
        <h2 id="invitaciones" className="font-medium">
          Invitaciones pendientes
        </h2>
        <p className="text-sm text-muted-foreground">
          Personas invitadas que aún no aceptan.
        </p>
      </div>
      {invitations.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground sm:px-5">
          No hay invitaciones pendientes.
        </p>
      ) : (
        <ul className="divide-y">
          {invitations.map((invitation) => (
            <li
              key={invitation.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:px-5"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium [overflow-wrap:anywhere]">
                  {invitation.email}
                </p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                  {invitation.roles.map((role) => (
                    <Badge key={role} variant="secondary">
                      {role}
                    </Badge>
                  ))}
                  {invitation.expired ? (
                    <Badge variant="warning">Vencida</Badge>
                  ) : (
                    <span>
                      Vence el {formatDate(new Date(invitation.expiresAt))}
                    </span>
                  )}
                </p>
              </div>
              {(invitation.canResend || invitation.canCancel) && (
                <div className="flex flex-wrap gap-2">
                  {invitation.canResend && (
                    <Button
                      variant="outline"
                      disabled={pending !== null}
                      onClick={() =>
                        run(
                          `resend-${invitation.id}`,
                          resendInvitationAction,
                          invitation.id,
                        )
                      }
                      aria-label={`Reenviar invitación a ${invitation.email}`}
                    >
                      {pending === `resend-${invitation.id}` ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Send aria-hidden="true" data-icon="inline-start" />
                      )}
                      Reenviar
                    </Button>
                  )}
                  {invitation.canCancel && (
                    <Button
                      variant="ghost"
                      disabled={pending !== null}
                      onClick={() =>
                        run(
                          `cancel-${invitation.id}`,
                          cancelInvitationAction,
                          invitation.id,
                        )
                      }
                      aria-label={`Cancelar invitación a ${invitation.email}`}
                    >
                      {pending === `cancel-${invitation.id}` ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <MailX aria-hidden="true" data-icon="inline-start" />
                      )}
                      Cancelar
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
