import { PERMISSIONS } from "@/platform/authorization";
import { defineModule } from "@/platform/billing";

/**
 * Inventario: the base every company has (MOD-02). Its permissions are the
 * `inventory.*` entries of the approved catalog; the product quota is
 * shared by every module (the catalog belongs to the core).
 */
export const inventoryModule = defineModule({
  id: "inventory",
  name: "Inventario",
  version: "1.0.0",
  availability: "available",
  required: true,
  dependsOn: [],
  uses: ["catalog"],
  permissions: PERMISSIONS.filter((permission) =>
    permission.startsWith("inventory."),
  ),
  limits: [{ key: "active_products", label: "Productos activos" }],
});
