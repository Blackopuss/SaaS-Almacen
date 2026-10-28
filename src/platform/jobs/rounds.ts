import "server-only";

import { db } from "@/server";

/**
 * Work the worker does on a schedule for each company that holds a module
 * (PAG-07: reminders of overdue payments). The platform never imports
 * modules: the worker receives the rounds from the registry. A round works
 * with one company at a time, only through `forOrganization`, checks by
 * itself whether the company may use it now, and must be safe to run again.
 */
export type ScheduledRound = {
  /** «sales.overdue_reminders». */
  name: string;
  /** Runs for the companies that hold this module. */
  module: string;
  run(organizationId: string): Promise<unknown>;
};

/** Companies with the module granted now (the round checks the rest). */
export async function organizationsWithModule(
  moduleId: string,
  now: Date = new Date(),
): Promise<string[]> {
  const rows = await db.entitlement.findMany({
    where: {
      kind: "MODULE",
      key: moduleId,
      validFrom: { lte: now },
      OR: [{ validUntil: null }, { validUntil: { gt: now } }],
    },
    select: { organizationId: true },
    orderBy: { organizationId: "asc" },
  });
  return rows.map((row) => row.organizationId);
}

/**
 * Runs every round once for each company. One company that fails does not
 * stop the others; `onError` hears about it.
 */
export async function runScheduledRounds(
  rounds: readonly ScheduledRound[],
  onError: (round: string, organizationId: string, error: unknown) => void,
): Promise<void> {
  for (const round of rounds) {
    for (const organizationId of await organizationsWithModule(round.module)) {
      try {
        await round.run(organizationId);
      } catch (error) {
        onError(round.name, organizationId, error);
      }
    }
  }
}
