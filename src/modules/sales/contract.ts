import { PERMISSIONS } from "@/platform/authorization";
import { defineModule } from "@/platform/billing";

/**
 * Ventas (VEN-02, ADR 0030): mostrador, caja, cotizaciones y ventas a
 * plazos. Needs Inventario (a sale is an exit) and the shared catalog and
 * contacts (customers). Its permissions are the `sales.*` entries of the
 * approved matrix. Contracted like the other modules, on top of
 * Inventario (VEN-27).
 */
export const salesModule = defineModule({
  id: "sales",
  name: "Ventas",
  version: "1.0.0",
  availability: "available",
  required: false,
  dependsOn: ["inventory"],
  uses: ["catalog", "contacts"],
  permissions: PERMISSIONS.filter((permission) =>
    permission.startsWith("sales."),
  ),
  limits: [],
});
