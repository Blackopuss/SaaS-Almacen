import { inventoryJobHandlers } from "@/modules/inventory";
import type { JobHandlers } from "@/platform/jobs";

/**
 * Background work of every module, by job type (IMP-01). The platform
 * runs the queue but never imports modules: the worker process receives
 * this list. A module adds its handlers here («inventory.import_products»).
 */
export const jobHandlers: JobHandlers = { ...inventoryJobHandlers };
