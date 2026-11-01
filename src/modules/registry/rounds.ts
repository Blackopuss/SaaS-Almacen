import { scheduleOverdueReminders } from "@/modules/sales";
import type { ScheduledRound } from "@/platform/jobs";

/**
 * Work each module does on a schedule, company by company (PAG-07). The
 * worker runs these once an hour; a module adds its rounds here.
 */
export const scheduledRounds: readonly ScheduledRound[] = [
  {
    name: "sales.overdue_reminders",
    module: "sales",
    run: scheduleOverdueReminders,
  },
];
