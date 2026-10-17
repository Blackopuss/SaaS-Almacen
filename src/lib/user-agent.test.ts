import { describe, expect, it } from "vitest";

import { describeUserAgent } from "./user-agent";

describe("describeUserAgent", () => {
  it.each([
    [
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0",
      "Edge en Windows",
      false,
    ],
    [
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
      "Safari en macOS",
      false,
    ],
    [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
      "Safari en iPhone",
      true,
    ],
    [
      "Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36",
      "Chrome en Android",
      true,
    ],
    [
      "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
      "Firefox en Linux",
      false,
    ],
  ])("%s → %s", (ua, label, mobile) => {
    const info = describeUserAgent(ua);
    expect(info.label).toBe(label);
    expect(info.mobile).toBe(mobile);
  });

  it("handles missing or unknown agents", () => {
    expect(describeUserAgent(null).label).toBe("Navegador");
    expect(describeUserAgent("curl/8.0").label).toBe("Navegador");
  });
});
