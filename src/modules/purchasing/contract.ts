import { PERMISSIONS } from "@/platform/authorization";
import { defineModule } from "@/platform/billing";

/**
 * Compras (MOD-02): needs Inventario (receipts become stock entries) and
 * the shared contacts (suppliers). Its permissions are the `purchasing.*`
 * entries of the approved catalog.
 */
export const purchasingModule = defineModule({
  id: "purchasing",
  name: "Compras",
  version: "1.0.0",
  availability: "available",
  required: false,
  dependsOn: ["inventory"],
  uses: ["catalog", "contacts"],
  permissions: PERMISSIONS.filter((permission) =>
    permission.startsWith("purchasing."),
  ),
  limits: [],
});
