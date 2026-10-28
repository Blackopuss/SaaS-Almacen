import { SALE_MAX_PAYMENTS } from "@/modules/sales";

/** The payments as a form sends them: their fields as text, cut short. */
export function readPaymentFields(payments: unknown) {
  const sent = Array.isArray(payments)
    ? payments.slice(0, SALE_MAX_PAYMENTS + 1)
    : [];
  return sent.map((payment) => {
    const fields =
      payment && typeof payment === "object"
        ? (payment as Record<string, unknown>)
        : {};
    const field = (name: string) =>
      typeof fields[name] === "string" ? fields[name].slice(0, 100) : "";
    return {
      method: field("method"),
      amount: field("amount"),
      received: field("received"),
      reference: field("reference"),
    };
  });
}
