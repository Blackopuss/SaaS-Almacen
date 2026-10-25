/**
 * When to send an operations alert (PIL-04). Pure, so it is tested on its
 * own. A check counts once it fails (or recovers) two rounds in a row, so a
 * blip of a minute is not news, and each change is reported once: no
 * repeated emails while something stays down.
 */
export type AlertChanges = { failed: string[]; recovered: string[] };

export function alertChanges(
  current: readonly string[],
  previous: readonly string[],
  notified: readonly string[],
): AlertChanges {
  return {
    failed: current.filter(
      (c) => previous.includes(c) && !notified.includes(c),
    ),
    recovered: notified.filter(
      (c) => !current.includes(c) && !previous.includes(c),
    ),
  };
}

/** What has been reported after applying `changes`. */
export function afterNotice(
  notified: readonly string[],
  changes: AlertChanges,
): string[] {
  return [
    ...notified.filter((c) => !changes.recovered.includes(c)),
    ...changes.failed,
  ];
}
