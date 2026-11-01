import { describe, expect, it } from "vitest";

import { dec } from "@/lib";

import { paymentNote, readPayments } from "./payments";

const total = dec("504.50");

describe("readPayments", () => {
  it("a single payment without amount pays the total", () => {
    const read = readPayments([{ method: "CASH", received: "600" }], total);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.payments[0]?.amount.toFixed(2)).toBe("504.50");
    expect(read.payments[0]?.change?.toFixed(2)).toBe("95.50");
  });

  it("exact cash gives no change", () => {
    const read = readPayments([{ method: "CASH" }], total);
    expect(read.ok && read.payments[0]?.change?.toFixed(2)).toBe("0.00");
  });

  it("mixed payments add up exactly", () => {
    expect(
      readPayments(
        [
          { method: "CASH", amount: "4.50", received: "10" },
          { method: "TRANSFER", amount: "500", reference: "ABC" },
        ],
        total,
      ).ok,
    ).toBe(true);
    expect(
      readPayments(
        [
          { method: "CARD", amount: "500", reference: "1" },
          { method: "TRANSFER", amount: "10", reference: "2" },
        ],
        total,
      ),
    ).toMatchObject({
      ok: false,
      formError: expect.stringMatching(/sobran \$5\.50/),
    });
  });

  it("refuses unknown methods and unreadable amounts", () => {
    expect(
      readPayments(
        [
          { method: "BITCOIN" },
          { method: "CARD", amount: "abc", reference: "1" },
          { method: "CASH", amount: "1", received: "x" },
        ],
        total,
      ),
    ).toEqual({
      ok: false,
      paymentErrors: {
        0: expect.any(String),
        1: expect.any(String),
        2: expect.any(String),
      },
    });
  });
});

describe("paymentNote", () => {
  it("says the change or what is missing", () => {
    expect(paymentNote([{ method: "CASH", received: "600" }], total)).toBe(
      "Cambio: $95.50",
    );
    expect(paymentNote([{ method: "CASH", received: "500" }], total)).toBe(
      "Faltan $4.50",
    );
    expect(paymentNote([{ method: "CASH" }], total)).toBeNull();
    expect(
      paymentNote(
        [
          { method: "CASH", amount: "200", received: "200" },
          { method: "CARD", amount: "250" },
        ],
        total,
      ),
    ).toBe("Faltan $54.50");
    expect(paymentNote([{ method: "CARD" }], dec(0))).toBeNull();
  });
});
