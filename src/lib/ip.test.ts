import { describe, expect, it } from "vitest";

import { formatIp, isLoopbackHost } from "./ip";

describe("formatIp", () => {
  it.each([
    ["0000:0000:0000:0000:0000:0000:0000:0001", "::1"],
    ["0000:0000:0000:0000:0000:0000:0000:0000", null],
    ["::", null],
    ["2001:0db8:0000:0000:0000:ff00:0042:8329", "2001:db8::ff00:42:8329"],
    ["2001:db8::1", "2001:db8::1"],
    ["0000:0000:0000:0000:0000:ffff:c0a8:0001", "::ffff:c0a8:1"],
    ["::ffff:192.168.1.10", "192.168.1.10"],
    ["0000:0000:0000:0000:0000:ffff:192.168.1.10", "192.168.1.10"],
    ["187.190.10.20", "187.190.10.20"],
    ["", null],
    [null, null],
  ])("%j → %j", (input, expected) => {
    expect(formatIp(input)).toBe(expected);
  });
});

describe("isLoopbackHost", () => {
  it.each([
    ["127.0.0.1", true],
    ["127.1.2.3", true],
    ["localhost", true],
    ["::1", true],
    ["10.0.0.5", false],
    ["db.almacen.mx", false],
    ["127.0.0.1.evil.mx", false],
  ])("%s → %s", (host, expected) => {
    expect(isLoopbackHost(host)).toBe(expected);
  });
});
