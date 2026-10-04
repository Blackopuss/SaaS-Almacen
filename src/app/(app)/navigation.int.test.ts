import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { NAV_ITEMS, visibleNavItems } from "@/components";
import {
  ROLES,
  can,
  isPermission,
  type Permission,
  type Subject,
} from "@/platform/authorization";

// USR-09: the menu hides what the person's roles do not allow, and every
// screen asks the server for the same permission before showing anything.

const menuOf = (subject: Subject) =>
  visibleNavItems((permission) => can(subject, permission as Permission)).map(
    (item) => item.label,
  );

const member = (...roles: string[]): Subject => ({ isOwner: false, roles });

describe("menu by role", () => {
  it("every item names a permission of the catalog", () => {
    for (const item of NAV_ITEMS) {
      if (item.permission !== null) {
        expect(isPermission(item.permission), item.href).toBe(true);
      }
    }
  });

  it("titular and administrator see every section", () => {
    const all = NAV_ITEMS.map((item) => item.label);
    expect(menuOf({ isOwner: true, roles: [] })).toEqual(all);
    expect(menuOf(member("administrator"))).toEqual(all);
  });

  it("Almacén does not see Compras", () => {
    expect(menuOf(member("warehouse"))).toEqual([
      "Inventario",
      "Movimientos",
      "Ubicaciones",
      "Conteos",
      "Configuración",
    ]);
  });

  it("Comprador does not see Conteos", () => {
    expect(menuOf(member("buyer"))).toEqual([
      "Inventario",
      "Movimientos",
      "Ubicaciones",
      "Compras",
      "Configuración",
    ]);
  });

  it("Consulta sees every section it can read", () => {
    expect(menuOf(member("viewer"))).toEqual(
      NAV_ITEMS.map((item) => item.label),
    );
  });

  it("a member without roles only sees Configuración", () => {
    expect(menuOf(member())).toEqual(["Configuración"]);
    expect(menuOf(member("cajero"))).toEqual(["Configuración"]);
  });

  it("combined roles see the union", () => {
    expect(menuOf(member("warehouse", "buyer"))).toEqual(
      NAV_ITEMS.map((item) => item.label),
    );
    expect(ROLES.length).toBe(4);
  });
});

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return pages(full);
    return name === "page.tsx" ? [full] : [];
  });
}

describe("screens check on the server", () => {
  const root = path.join(process.cwd(), "src/app/(app)");

  it("every screen of the app resolves the person's access itself", () => {
    const found = pages(root);
    expect(found.length).toBeGreaterThanOrEqual(NAV_ITEMS.length);
    for (const file of found) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toMatch(
        /await (getAccess|getModuleAccess|requirePermission|requireModulePermission)\(/,
      );
    }
  });

  it("every section screen asks for the permission its menu item names", () => {
    for (const item of NAV_ITEMS) {
      if (item.permission === null) continue;
      const source = readFileSync(
        path.join(root, item.href.slice(1), "page.tsx"),
        "utf8",
      );
      expect(source, item.href).toContain(
        `if (!access.can("${item.permission}"))`,
      );
      expect(source, item.href).toContain("<NoAccessState");
      // …and for the module the company must have (MOD-05).
      expect(source, item.href).toContain(
        `if (!access.hasModule("${item.module}"))`,
      );
      expect(item.permission.startsWith(`${item.module}.`), item.href).toBe(
        true,
      );
    }
  });
});
