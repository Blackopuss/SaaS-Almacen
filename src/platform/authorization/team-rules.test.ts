import { describe, expect, it } from "vitest";

import { ROLES } from "./catalog";
import {
  assignableRoles,
  checkInvitationRoles,
  checkTeamChange,
  type TeamPerson,
} from "./team-rules";

// USR-03B: an administrator cannot disable or demote the titular, nor give
// themselves (or anyone) more than they have. NEG-07 and NEG-08 of the matrix.

const person = (
  userId: string,
  roles: string[],
  isOwner = false,
): TeamPerson => ({ userId, roles, isOwner });

const titular = person("titular", [], true);
const admin = person("admin", ["administrator"]);
const otherAdmin = person("admin-2", ["administrator"]);
const warehouse = person("almacen", ["warehouse"]);
const viewer = person("consulta", ["viewer"]);

describe("the titular is protected", () => {
  it.each([titular, admin, warehouse])(
    "nobody disables the titular (%#)",
    (actor) => {
      expect(
        checkTeamChange(actor, titular, { kind: "disable" }),
      ).toMatchObject({ ok: false });
    },
  );

  it("an administrator cannot disable or demote the titular", () => {
    expect(checkTeamChange(admin, titular, { kind: "disable" })).toEqual({
      ok: false,
      reason: "owner_protected",
    });
    expect(
      checkTeamChange(admin, titular, {
        kind: "assign_roles",
        roles: ["viewer"],
      }),
    ).toEqual({ ok: false, reason: "owner_protected" });
  });

  it("a titular who also has roles stays protected", () => {
    const withRoles = person("titular", ["viewer"], true);
    expect(checkTeamChange(admin, withRoles, { kind: "disable" })).toEqual({
      ok: false,
      reason: "owner_protected",
    });
  });
});

describe("an administrator cannot raise privileges", () => {
  it("cannot change their own roles or disable themselves", () => {
    expect(
      checkTeamChange(admin, admin, {
        kind: "assign_roles",
        roles: ["administrator", "buyer"],
      }),
    ).toEqual({ ok: false, reason: "self" });
    expect(checkTeamChange(admin, admin, { kind: "disable" })).toEqual({
      ok: false,
      reason: "self",
    });
  });

  it("cannot name another administrator", () => {
    expect(
      checkTeamChange(admin, viewer, {
        kind: "assign_roles",
        roles: ["administrator"],
      }),
    ).toEqual({ ok: false, reason: "administrator_reserved" });
    expect(
      checkTeamChange(admin, viewer, {
        kind: "assign_roles",
        roles: ["viewer", "administrator"],
      }),
    ).toEqual({ ok: false, reason: "administrator_reserved" });
  });

  it("cannot change or disable another administrator", () => {
    expect(
      checkTeamChange(admin, otherAdmin, {
        kind: "assign_roles",
        roles: ["viewer"],
      }),
    ).toEqual({ ok: false, reason: "administrator_reserved" });
    expect(checkTeamChange(admin, otherAdmin, { kind: "disable" })).toEqual({
      ok: false,
      reason: "administrator_reserved",
    });
  });

  it("manages Almacén, Comprador and Consulta of other people", () => {
    expect(
      checkTeamChange(admin, viewer, {
        kind: "assign_roles",
        roles: ["warehouse", "buyer"],
      }),
    ).toEqual({ ok: true });
    expect(checkTeamChange(admin, warehouse, { kind: "disable" })).toEqual({
      ok: true,
    });
    expect(assignableRoles(admin)).toEqual(["warehouse", "buyer", "viewer"]);
  });

  it("cannot invite an administrator; the titular can", () => {
    expect(checkInvitationRoles(admin, ["administrator"])).toEqual({
      ok: false,
      reason: "administrator_reserved",
    });
    expect(checkInvitationRoles(admin, ["buyer", "viewer"])).toEqual({
      ok: true,
    });
    expect(checkInvitationRoles(titular, ["administrator"])).toEqual({
      ok: true,
    });
  });
});

describe("the titular manages everyone else", () => {
  it("names, changes and removes administrators", () => {
    expect(
      checkTeamChange(titular, viewer, {
        kind: "assign_roles",
        roles: ["administrator"],
      }),
    ).toEqual({ ok: true });
    expect(
      checkTeamChange(titular, admin, {
        kind: "assign_roles",
        roles: ["viewer"],
      }),
    ).toEqual({ ok: true });
    expect(checkTeamChange(titular, admin, { kind: "disable" })).toEqual({
      ok: true,
    });
    expect(assignableRoles(titular)).toEqual([...ROLES]);
  });

  it("cannot disable or demote themselves", () => {
    expect(checkTeamChange(titular, titular, { kind: "disable" })).toEqual({
      ok: false,
      reason: "owner_protected",
    });
  });
});

describe("other roles and invalid input", () => {
  it.each([warehouse, viewer, person("comprador", ["buyer"]), person("x", [])])(
    "without team permissions nothing is allowed (%#)",
    (actor) => {
      expect(checkTeamChange(actor, viewer, { kind: "disable" })).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect(
        checkTeamChange(actor, warehouse, {
          kind: "assign_roles",
          roles: ["viewer"],
        }),
      ).toEqual({ ok: false, reason: "forbidden" });
      expect(checkInvitationRoles(actor, ["viewer"])).toEqual({
        ok: false,
        reason: "forbidden",
      });
      expect(assignableRoles(actor)).toEqual([]);
    },
  );

  it.each([
    [[]],
    [["owner"]],
    [["titular"]],
    [["viewer", "viewer"]],
    [["cajero"]],
  ])("roles %j are rejected", (roles) => {
    expect(
      checkTeamChange(titular, viewer, { kind: "assign_roles", roles }),
    ).toEqual({ ok: false, reason: "invalid_roles" });
    expect(checkInvitationRoles(titular, roles)).toEqual({
      ok: false,
      reason: "invalid_roles",
    });
  });
});
