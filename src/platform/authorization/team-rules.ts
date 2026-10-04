/**
 * Who may change whom in the team (USR-03B, matrix rule 4 and founder's
 * answer 6). Pure: callers load the people and pass them in.
 *
 * - Nobody disables the titular or changes their roles; the titular only
 *   stops being one through the ownership transfer.
 * - Only the titular names, changes or removes administrators.
 * - An administrator manages Almacén, Comprador and Consulta of other
 *   people, never their own roles.
 */
import { isRole, type Permission, type Role } from "./catalog";
import { can, type Subject } from "./policy";

export type TeamPerson = Subject & { userId: string };

export type TeamChange =
  { kind: "assign_roles"; roles: readonly string[] } | { kind: "disable" };

export type TeamRuleReason =
  | "forbidden"
  | "owner_protected"
  | "self"
  | "administrator_reserved"
  | "invalid_roles";

export type TeamRuleResult =
  { ok: true } | { ok: false; reason: TeamRuleReason };

export const TEAM_RULE_MESSAGES: Record<TeamRuleReason, string> = {
  forbidden: "No tienes permiso para hacer esto.",
  owner_protected:
    "El titular no se puede desactivar ni cambiar de rol. Para cambiar de titular se transfiere la empresa.",
  self: "No puedes cambiar tu propio acceso.",
  administrator_reserved:
    "Solo el titular puede nombrar, cambiar o quitar administradores.",
  invalid_roles: "Elige al menos un rol válido.",
};

const PERMISSION_OF: Record<TeamChange["kind"], Permission> = {
  assign_roles: "platform.team.assign_roles",
  disable: "platform.team.disable",
};

const deny = (reason: TeamRuleReason): TeamRuleResult => ({
  ok: false,
  reason,
});

/** Roles a person may hand out: the titular all, an administrator all but administrator. */
export function assignableRoles(actor: Subject): Role[] {
  if (!can(actor, "platform.team.assign_roles")) return [];
  const all: Role[] = ["administrator", "warehouse", "buyer", "viewer"];
  return actor.isOwner === true
    ? all
    : all.filter((r) => r !== "administrator");
}

export function checkTeamChange(
  actor: TeamPerson,
  target: TeamPerson,
  change: TeamChange,
): TeamRuleResult {
  if (!can(actor, PERMISSION_OF[change.kind])) return deny("forbidden");
  if (target.isOwner === true) return deny("owner_protected");
  if (actor.userId === target.userId) return deny("self");

  if (change.kind === "assign_roles") {
    const roles = change.roles;
    if (
      roles.length === 0 ||
      !roles.every(isRole) ||
      new Set(roles).size !== roles.length
    ) {
      return deny("invalid_roles");
    }
  }

  if (actor.isOwner !== true) {
    if (target.roles.includes("administrator")) {
      return deny("administrator_reserved");
    }
    if (change.kind === "assign_roles") {
      const allowed = new Set<string>(assignableRoles(actor));
      if (!change.roles.every((role) => allowed.has(role))) {
        return deny("administrator_reserved");
      }
    }
  }
  return { ok: true };
}

/** Roles that can be offered in an invitation by this person (USR-04). */
export function checkInvitationRoles(
  actor: Subject,
  roles: readonly string[],
): TeamRuleResult {
  if (!can(actor, "platform.team.invite")) return deny("forbidden");
  if (
    roles.length === 0 ||
    !roles.every(isRole) ||
    new Set(roles).size !== roles.length
  ) {
    return deny("invalid_roles");
  }
  if (actor.isOwner !== true && roles.includes("administrator")) {
    return deny("administrator_reserved");
  }
  return { ok: true };
}
