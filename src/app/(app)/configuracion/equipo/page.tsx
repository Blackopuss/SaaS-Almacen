import { ChevronLeft, ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState, PageContainer, PageHeader } from "@/components";
import {
  ROLE_LABELS,
  assignableRoles,
  checkTeamChange,
  getAccess,
  listPendingInvitations,
  listTeamMembers,
} from "@/platform/authorization";

import { InviteDialog } from "./invite-dialog";
import { InvitationsPanel } from "./invitations-panel";
import { MembersPanel } from "./members-panel";

export const metadata: Metadata = { title: "Equipo" };

function BackLink() {
  return (
    <Link
      href="/configuracion"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Configuración
    </Link>
  );
}

/** Team screen (USR-08): people, their roles and pending invitations. */
export default async function EquipoPage() {
  const access = await getAccess();
  if (!access.can("platform.team.read")) {
    return (
      <PageContainer>
        <BackLink />
        <EmptyState
          icon={ShieldAlert}
          title="No tienes acceso al equipo"
          description="Solo el titular y los administradores pueden ver y cambiar quién trabaja en la empresa."
        />
      </PageContainer>
    );
  }

  const organizationId = access.organization.id;
  const [members, invitations] = await Promise.all([
    listTeamMembers(organizationId),
    access.can("platform.team.invite")
      ? listPendingInvitations(organizationId)
      : Promise.resolve([]),
  ]);

  const me = {
    userId: access.user.id,
    isOwner: access.organization.isOwner,
    roles: access.roles,
  };
  const offered = assignableRoles(me);
  const roleOptions = offered.map((role) => ({
    id: role,
    label: ROLE_LABELS[role],
  }));
  // The server decides what each row offers; the actions check it again.
  const allows = (
    target: (typeof members)[number],
    kind: "assign_roles" | "disable",
  ) =>
    checkTeamChange(
      me,
      target,
      kind === "disable"
        ? { kind }
        : { kind, roles: offered.length > 0 ? [offered[0]!] : [] },
    ).ok;
  const handlesAdministrators = access.organization.isOwner;

  return (
    <PageContainer>
      <BackLink />
      <PageHeader
        title="Equipo"
        description="Quién trabaja en tu empresa y qué puede hacer cada persona."
        actions={
          access.can("platform.team.invite") && roleOptions.length > 0 ? (
            <InviteDialog roleOptions={roleOptions} />
          ) : undefined
        }
      />

      <MembersPanel
        roleOptions={roleOptions}
        members={members.map((member) => ({
          userId: member.userId,
          name: member.name,
          email: member.email,
          disabled: member.status === "DISABLED",
          isOwner: member.isOwner,
          isMe: member.userId === access.user.id,
          roles: member.roles.map((role) => ({
            id: role,
            label: ROLE_LABELS[role],
          })),
          canAssign:
            member.status === "ACTIVE" && allows(member, "assign_roles"),
          canDisable: allows(member, "disable"),
        }))}
      />

      {access.can("platform.team.invite") && (
        <InvitationsPanel
          invitations={invitations.map((invitation) => {
            const manageable =
              handlesAdministrators ||
              !invitation.roles.includes("administrator");
            return {
              id: invitation.id,
              email: invitation.email,
              roles: invitation.roles.map((role) => ROLE_LABELS[role]),
              expiresAt: invitation.expiresAt.toISOString(),
              expired: invitation.expired,
              canResend: manageable && access.can("platform.invitation.resend"),
              canCancel: manageable && access.can("platform.invitation.cancel"),
            };
          })}
        />
      )}
    </PageContainer>
  );
}
