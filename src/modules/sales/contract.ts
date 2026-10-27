import { PERMISSIONS } from "@/platform/authorization";
import { defineModule } from "@/platform/billing";

/**
 * Ventas (VEN-02, ADR 0030): mostrador, caja, cotizaciones y ventas a
 * plazos. Needs Inventario (a sale is an exit) and the shared catalog and
 * contacts (customers). Its permissions are the `sales.*` entries of the
 * approved matrix. It stays unavailable — nobody can contract it — until
 * a sale can be made end to end.
 */
export const salesModule = defineModule({
  id: "sales",
  name: "Ventas",
  version: "0.2.0",
  availability: "unavailable",
  required: false,
  dependsOn: ["inventory"],
  uses: ["catalog", "contacts"],
  permissions: PERMISSIONS.filter((permission) =>
    permission.startsWith("sales."),
  ),
  limits: [],
});
