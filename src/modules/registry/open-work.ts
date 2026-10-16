import { purchasingOpenWork } from "@/modules/purchasing";

/**
 * What each module would leave halfway if a company stopped having it
 * (CMP-17), in sentences for the platform console. A module without
 * unfinished work does not appear. The console warns with it before
 * removing a module; the platform never imports modules, so it receives
 * this function.
 */
const OPEN_WORK: Record<string, (organizationId: string) => Promise<string[]>> =
  {
    purchasing: purchasingOpenWork,
  };

export async function moduleOpenWork(
  moduleId: string,
  organizationId: string,
): Promise<string[]> {
  const find = OPEN_WORK[moduleId];
  return find ? find(organizationId) : [];
}
