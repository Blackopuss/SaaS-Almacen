import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// PLT-15: every server action is an HTTP endpoint anyone can call with any
// body. Each one is reviewed here: what it takes from the client, where
// the user/company come from, and which test proves it cannot reach other
// people's data. A new action fails this test until it is added.

type Review = {
  /** What the client can send. */
  input: string;
  /** Where the account/company used by the action come from. */
  identity: string;
  /** Test that covers the cross-account / cross-company case. */
  coveredBy: string;
};

const REVIEWED: Record<string, Review> = {
  registerTransferAction: {
    input:
      "id de producto, ubicación de origen y de destino, cantidad, forma de captura, nota y clave de la confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y ubicaciones se buscan solo en esa empresa",
    coveredBy: "tests/inventory/transfers.int.test.ts",
  },
  checkConfirmationAction: {
    input: "clave de la confirmación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); solo responde por movimientos confirmados por la misma persona",
    coveredBy: "tests/inventory/lost-answer.int.test.ts",
  },
  registerExitAction: {
    input:
      "id de producto, id de ubicación, cantidad, forma de captura, referencia y nota (sin factor ni saldo)",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y ubicación se buscan solo en esa empresa",
    coveredBy: "tests/inventory/exits.int.test.ts",
  },
  registerInitialBalanceAction: {
    input:
      "id de producto, id de ubicación, cantidad, forma de captura y nota (sin factor ni saldo)",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y ubicación se buscan solo en esa empresa",
    coveredBy: "tests/inventory/initial-balance.int.test.ts",
  },
  previewEntryAction: {
    input:
      "id de producto, forma de captura (id de presentación o código de unidad) y cantidad; solo lee",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y presentación se buscan solo en esa empresa",
    coveredBy: "tests/platform/conversion.int.test.ts",
  },
  registerEntryAction: {
    input:
      "id de producto, id de ubicación, cantidad, forma de captura (id de presentación o código de unidad), referencia y nota (sin factor ni saldo)",
    identity:
      "sesión y empresa activa (requireOrganizationContext); producto y ubicación se buscan solo en esa empresa",
    coveredBy: "tests/inventory/entries.int.test.ts",
  },
  createLocationAction: {
    input: "nombre, tipo e id de la ubicación que la contiene",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/platform/location-hierarchy.int.test.ts",
  },
  renameLocationAction: {
    input: "id de ubicación y nombre nuevo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/platform/location-hierarchy.int.test.ts",
  },
  moveLocationAction: {
    input: "id de ubicación e id del destino",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/platform/location-hierarchy.int.test.ts",
  },
  archiveLocationAction: {
    input: "id de ubicación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/platform/location-hierarchy.int.test.ts",
  },
  restoreLocationAction: {
    input: "id de ubicación",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la ubicación se busca solo en esa empresa",
    coveredBy: "tests/platform/location-hierarchy.int.test.ts",
  },
  changePresentationFactorAction: {
    input:
      "id de producto (solo para refrescar), id de presentación y contenido nuevo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); la presentación se busca solo en esa empresa",
    coveredBy: "tests/platform/presentation-versions.int.test.ts",
  },
  createPresentationAction: {
    input: "id de producto, nombre de la presentación y contenido",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el producto se busca solo en esa empresa",
    coveredBy: "tests/platform/presentations.int.test.ts",
  },
  archiveProductAction: {
    input: "id de producto y motivo",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el producto se busca solo en esa empresa",
    coveredBy: "tests/platform/product-archive.int.test.ts",
  },
  reactivateProductAction: {
    input: "id de producto",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el producto se busca solo en esa empresa",
    coveredBy: "tests/platform/product-archive.int.test.ts",
  },
  updateProductAction: {
    input: "id de producto y los campos de la ficha (sin cantidades)",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el producto se busca solo en esa empresa",
    coveredBy: "tests/platform/product-update.int.test.ts",
  },
  createProductAction: {
    input: "clave, nombre, descripción, categoría, marca y código de barras",
    identity:
      "sesión y empresa activa (requireOrganizationContext); el servicio comprueba rol, módulo y cupo",
    coveredBy: "tests/platform/products.int.test.ts",
  },
  provisionAction: {
    input:
      "id de empresa (cualquiera: es personal de plataforma), cupos, módulos, vigencia y motivo",
    identity:
      "sesión con MFA + fila activa en platform_staff (requirePlatformStaff); el servicio lo vuelve a comprobar",
    coveredBy: "tests/platform/provisioning.int.test.ts",
  },
  inviteAction: {
    input: "correo y roles",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/invitations.int.test.ts",
  },
  resendInvitationAction: {
    input: "id de invitación",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/invitations.int.test.ts",
  },
  cancelInvitationAction: {
    input: "id de invitación",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/invitations.int.test.ts",
  },
  assignRolesAction: {
    input: "id de usuario y roles",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/team.int.test.ts",
  },
  disableMemberAction: {
    input: "id de usuario y motivo",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/team-disable.int.test.ts",
  },
  reactivateMemberAction: {
    input: "id de usuario",
    identity: "sesión y empresa activa (requireOrganizationContext)",
    coveredBy: "tests/platform/team-disable.int.test.ts",
  },
  acceptInvitationAction: {
    input: "token de la invitación",
    identity:
      "sesión (requireSession); el correo de la cuenta debe ser el invitado",
    coveredBy: "tests/platform/invitation-accept.int.test.ts",
  },
  joinAsNewUserAction: {
    input: "token de la invitación, nombre y contraseña",
    identity: "el token (un solo uso, vence); el correo sale de la invitación",
    coveredBy: "tests/platform/invitation-accept.int.test.ts",
  },
  invitationSignOutAction: {
    input: "token (solo para volver a la misma pantalla)",
    identity: "sesión propia",
    coveredBy: "tests/platform/session.int.test.ts",
  },
  signInAction: {
    input: "correo y contraseña",
    identity: "ninguna sesión previa",
    coveredBy: "tests/platform/throttle.int.test.ts, session.int.test.ts",
  },
  registerAction: {
    input: "nombre, correo y contraseña",
    identity: "ninguna",
    coveredBy: "tests/platform/register.int.test.ts",
  },
  resendAction: {
    input: "correo",
    identity: "ninguna (respuesta neutral)",
    coveredBy: "tests/platform/register.int.test.ts",
  },
  recoverAction: {
    input: "correo",
    identity: "ninguna (respuesta neutral)",
    coveredBy: "tests/platform/recovery.int.test.ts",
  },
  resetAction: {
    input: "token del correo y contraseña nueva",
    identity: "el token (un solo uso, vence)",
    coveredBy: "tests/platform/recovery.int.test.ts",
  },
  verifyCodeAction: {
    input: "código y método",
    identity: "cookie firmada del desafío MFA",
    coveredBy:
      "tests/platform/mfa-challenge.int.test.ts, mfa-recovery.int.test.ts",
  },
  createOrganizationAction: {
    input: "nombre y zona horaria",
    identity: "sesión (requireSession)",
    coveredBy: "tests/platform/organizations.int.test.ts",
  },
  signOutAction: {
    input: "nada",
    identity: "sesión propia",
    coveredBy: "tests/platform/session.int.test.ts",
  },
  switchOrganizationAction: {
    input: "id de empresa",
    identity: "sesión; membresía activa revisada en servidor",
    coveredBy: "tests/isolation/two-companies.int.test.ts",
  },
  revokeSessionAction: {
    input: "id de sesión",
    identity: "sesión; solo sesiones del mismo usuario",
    coveredBy: "tests/isolation/two-companies.int.test.ts",
  },
  revokeOtherSessionsAction: {
    input: "nada",
    identity: "sesión propia",
    coveredBy: "tests/platform/sessions.int.test.ts",
  },
  mfaSetupAction: {
    input: "contraseña o código",
    identity: "sesión propia (allowMissingMfa solo aquí)",
    coveredBy: "tests/platform/mfa.int.test.ts",
  },
  regenerateBackupCodesAction: {
    input: "contraseña",
    identity: "sesión propia",
    coveredBy: "tests/platform/mfa-recovery.int.test.ts",
  },
  disableMfaAction: {
    input: "contraseña y código",
    identity: "sesión propia; prohibido si la MFA es obligatoria",
    coveredBy: "tests/platform/mfa-recovery.int.test.ts",
  },
};

function actionFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return actionFiles(full);
    return name === "actions.ts" ? [full] : [];
  });
}

function exportedActions(): string[] {
  return actionFiles(path.join(process.cwd(), "src/app"))
    .flatMap((file) => [
      ...readFileSync(file, "utf8").matchAll(
        /^export (?:async function|const) (\w+)/gm,
      ),
    ])
    .map(([, name]) => name!)
    .sort();
}

describe("server actions", () => {
  it("every action has an isolation review", () => {
    expect(exportedActions()).toEqual(Object.keys(REVIEWED).sort());
  });

  it("every review points to existing tests", () => {
    for (const [action, review] of Object.entries(REVIEWED)) {
      for (const ref of review.coveredBy.split(",")) {
        const name = path.basename(ref.trim());
        const found = [
          path.join(process.cwd(), "tests/platform", name),
          path.join(process.cwd(), "tests/isolation", name),
          path.join(process.cwd(), ref.trim()),
        ].some((candidate) => {
          try {
            return statSync(candidate).isFile();
          } catch {
            return false;
          }
        });
        expect(found, `${action}: ${ref}`).toBe(true);
      }
    }
  });
});
