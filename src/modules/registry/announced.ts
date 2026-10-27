import { defineModule } from "@/platform/billing";

/**
 * Modules announced in the plan that do not exist yet. They are registered
 * as unavailable so plans and screens can name them, and so nothing can
 * activate them by mistake. Each one gets its own folder, permissions and
 * roles in its stage (Ventas got its own in VEN-02; CRM pending).
 */
export const crmModule = defineModule({
  id: "crm",
  name: "CRM",
  version: "0.1.0",
  availability: "unavailable",
  required: false,
  // Works with contacts alone; it links to Ventas only when contracted.
  dependsOn: [],
  uses: ["contacts"],
  permissions: [],
  limits: [],
});
