import { describe, expect, it } from "vitest";

import { afterNotice, alertChanges } from "./alert-rules";

describe("alertChanges (PIL-04)", () => {
  it("waits for a second failing round before alerting", () => {
    expect(alertChanges(["queue"], [], [])).toEqual({
      failed: [],
      recovered: [],
    });
    expect(alertChanges(["queue"], ["queue"], [])).toEqual({
      failed: ["queue"],
      recovered: [],
    });
  });

  it("does not repeat an alert while the check stays down", () => {
    expect(alertChanges(["queue"], ["queue"], ["queue"])).toEqual({
      failed: [],
      recovered: [],
    });
  });

  it("reports a recovery once it holds two rounds", () => {
    expect(alertChanges([], ["queue"], ["queue"]).recovered).toEqual([]);
    expect(alertChanges([], [], ["queue"]).recovered).toEqual(["queue"]);
  });

  it("ignores a blip that never got reported", () => {
    expect(alertChanges([], ["errors"], [])).toEqual({
      failed: [],
      recovered: [],
    });
  });

  it("keeps track of what was reported", () => {
    expect(
      afterNotice(["web", "backup"], { failed: ["queue"], recovered: ["web"] }),
    ).toEqual(["backup", "queue"]);
  });
});
