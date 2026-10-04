import { describe, expect, it } from "vitest";

import { NAV_ITEMS } from "@/components";
import { PERMISSIONS } from "@/platform/authorization";

import { moduleRegistry } from "./index";

// MOD-02: the real registry starts, with Inventario and Compras available
// and Ventas and CRM announced but not contractable.

describe("installed modules", () => {
  it("starts with the four modules of the plan", () => {
    expect(moduleRegistry.all.map((m) => m.id).sort()).toEqual([
      "crm",
      "inventory",
      "purchasing",
      "sales",
    ]);
  });

  it("Inventario is the base; Inventario and Compras can be contracted", () => {
    expect(moduleRegistry.base.id).toBe("inventory");
    expect(moduleRegistry.available.map((m) => m.id)).toEqual([
      "inventory",
      "purchasing",
    ]);
  });

  it("Ventas and CRM are not available and own no permissions yet", () => {
    for (const id of ["sales", "crm"]) {
      expect(moduleRegistry.get(id)).toMatchObject({
        availability: "unavailable",
        permissions: [],
      });
    }
  });

  it("Compras needs Inventario; removing Inventario would break Compras", () => {
    expect(
      moduleRegistry.dependenciesOf("purchasing").map((m) => m.id),
    ).toEqual(["inventory"]);
    expect(
      moduleRegistry
        .dependentsOf("inventory")
        .filter((m) => m.availability === "available")
        .map((m) => m.id),
    ).toEqual(["purchasing"]);
  });

  it("every business permission of the catalog belongs to exactly one module", () => {
    for (const permission of PERMISSIONS) {
      const owner = moduleRegistry.moduleOfPermission(permission);
      if (permission.startsWith("platform.")) {
        expect(owner, permission).toBeNull();
      } else {
        expect(owner?.id, permission).toBe(permission.split(".")[0]);
      }
    }
    const owned = moduleRegistry.all.flatMap((m) => m.permissions);
    expect(owned.length).toBe(
      PERMISSIONS.filter((p) => !p.startsWith("platform.")).length,
    );
  });

  it("every menu section names a registered module", () => {
    for (const item of NAV_ITEMS) {
      if (item.module !== null) {
        expect(moduleRegistry.has(item.module), item.href).toBe(true);
      }
    }
  });

  it("the base declares the product quota", () => {
    expect(moduleRegistry.base.limits.map((l) => l.key)).toEqual([
      "active_products",
    ]);
  });
});
