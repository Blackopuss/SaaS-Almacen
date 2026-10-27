import { dec, type Decimal } from "@/lib";

import { formatMoney, parsePrice } from "./pricing";

/**
 * How a sale is paid (VEN-11..13, ADR 0030). Pure: no database. Each
 * payment has its amount (or, when it is the only one, the total); cash
 * may receive more and gives change; cards and transfers carry their
 * reference — the terminal is outside the app; together they pay exactly
 * the total.
 */

export const SALE_MAX_PAYMENTS = 4;
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

export const PAYMENT_METHODS = ["CASH", "CARD", "TRANSFER"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
};

export type PaymentInput = {
  method: string;
  /** What goes to the sale; empty with a single payment = the total. */
  amount?: string;
  /** Cash only: what the customer handed over; empty = exact. */
  received?: string;
  /** Card or transfer: authorization or tracking number. */
  reference?: string;
};

export type Payment = {
  method: PaymentMethod;
  amount: Decimal;
  received: Decimal | null;
  change: Decimal | null;
  reference: string | null;
};

export type PaymentsRead =
  | { ok: true; payments: Payment[] }
  | { ok: false; paymentErrors: Record<number, string>; formError?: string };

const text = (value: unknown, max: number) =>
  typeof value === "string" ? value.slice(0, max) : "";

/** The amount of one payment, or the problem with it. */
function amountOf(
  payment: PaymentInput,
  alone: boolean,
  total: Decimal,
): Decimal | string {
  const typed = text(payment.amount, 20).trim();
  if (typed === "" && alone) return total;
  const parsed = parsePrice(typed);
  if (parsed === null || dec(parsed).isZero()) {
    return typed === ""
      ? "Escribe cuánto se paga así."
      : "Escribe el importe como 150 o 1,250.50.";
  }
  return dec(parsed);
}

/** What the customer handed over in cash; empty = exactly the amount. */
function receivedOf(payment: PaymentInput, amount: Decimal): Decimal | null {
  const given = text(payment.received, 20).trim();
  if (given === "") return amount;
  const parsed = parsePrice(given);
  return parsed === null ? null : dec(parsed);
}

export function readPayments(
  sent: readonly PaymentInput[],
  total: Decimal,
): PaymentsRead {
  if (sent.length === 0) {
    return { ok: false, paymentErrors: {}, formError: "Elige cómo se paga." };
  }
  if (sent.length > SALE_MAX_PAYMENTS) {
    return {
      ok: false,
      paymentErrors: {},
      formError: `Una venta admite hasta ${SALE_MAX_PAYMENTS} formas de pago.`,
    };
  }
  const paymentErrors: Record<number, string> = {};
  const payments: Payment[] = [];
  let cash = 0;
  for (const [index, payment] of sent.entries()) {
    const method = text(payment?.method, 10) as PaymentMethod;
    if (!PAYMENT_METHODS.includes(method)) {
      paymentErrors[index] = "Elige efectivo, tarjeta o transferencia.";
      continue;
    }
    const amount = amountOf(payment, sent.length === 1, total);
    if (typeof amount === "string") {
      paymentErrors[index] = amount;
      continue;
    }
    if (method === "CASH") {
      cash += 1;
      const received = receivedOf(payment, amount);
      if (received === null) {
        paymentErrors[index] = "Escribe el efectivo recibido como 200 o 1,000.";
        continue;
      }
      if (received.lessThan(amount)) {
        paymentErrors[index] =
          `El efectivo recibido no alcanza: faltan ${formatMoney(amount.minus(received))}.`;
        continue;
      }
      payments.push({
        method,
        amount,
        received,
        change: received.minus(amount),
        reference: null,
      });
      continue;
    }
    const reference = text(payment.reference, 100).trim();
    if (reference === "") {
      paymentErrors[index] =
        method === "CARD"
          ? "Escribe el número de autorización del voucher."
          : "Escribe la clave de rastreo o la referencia de la transferencia.";
      continue;
    }
    if (reference.length > 60 || !NO_CONTROL.test(reference)) {
      paymentErrors[index] = "La referencia admite hasta 60 caracteres.";
      continue;
    }
    payments.push({ method, amount, received: null, change: null, reference });
  }
  if (cash > 1) {
    return {
      ok: false,
      paymentErrors: {},
      formError: "El efectivo va en un solo pago; súmalo ahí.",
    };
  }
  if (Object.keys(paymentErrors).length > 0) {
    return { ok: false, paymentErrors };
  }
  const paid = payments.reduce((sum, p) => sum.plus(p.amount), dec(0));
  if (!paid.equals(total)) {
    return {
      ok: false,
      paymentErrors: {},
      formError: paid.lessThan(total)
        ? `Los pagos suman ${formatMoney(paid)} y el total es ${formatMoney(total)}: faltan ${formatMoney(total.minus(paid))}.`
        : `Los pagos suman ${formatMoney(paid)} y el total es ${formatMoney(total)}: sobran ${formatMoney(paid.minus(total))}. El cambio solo sale del efectivo.`,
    };
  }
  return { ok: true, payments };
}

/**
 * What the counter shows while payments are typed, before charging:
 * the change, or how much is missing. Null when there is nothing to say.
 */
export function paymentNote(
  sent: readonly PaymentInput[],
  total: Decimal,
): string | null {
  if (sent.length === 0 || total.isZero()) return null;
  let paid = dec(0);
  let change = dec(0);
  for (const payment of sent) {
    const amount = amountOf(payment, sent.length === 1, total);
    if (typeof amount === "string") return null;
    paid = paid.plus(amount);
    if (payment.method === "CASH") {
      const received = receivedOf(payment, amount);
      if (received === null) return null;
      change = change.plus(received.minus(amount));
    }
  }
  if (change.isNegative()) return `Faltan ${formatMoney(change.negated())}`;
  if (paid.lessThan(total)) return `Faltan ${formatMoney(total.minus(paid))}`;
  if (paid.greaterThan(total)) {
    return `Sobran ${formatMoney(paid.minus(total))}`;
  }
  return change.isZero() ? null : `Cambio: ${formatMoney(change)}`;
}
