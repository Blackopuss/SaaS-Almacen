import "server-only";

import { dec } from "@/lib";
import { forOrganization } from "@/server";

import { formatMoney } from "./pricing";
import { creditedOf } from "./receivables";

/**
 * What would be left halfway if Ventas is taken away from a company
 * (VEN-26): registers still open, orders waiting to be delivered, accounts
 * on installments with a balance and mails on their way. The platform
 * console shows it before removing the module; nothing is cancelled or
 * closed — everything stays as it is, readable and exportable, and goes on
 * if the module comes back.
 *
 * Not a service a person calls: the console of the platform asks for it,
 * for any company, after checking that the caller is platform staff.
 */
export async function salesOpenWork(organizationId: string): Promise<string[]> {
  const client = forOrganization(organizationId);
  const [registers, orders, accounts, mails] = await Promise.all([
    client.cashSession.count({ where: { isOpen: true } }),
    client.salesOrder.count({ where: { status: { in: ["OPEN", "PARTIAL"] } } }),
    client.salesReceivable.findMany({
      where: { status: "OPEN" },
      select: {
        owed: true,
        payments: { select: { amount: true } },
        credits: { select: { credited: true } },
      },
    }),
    Promise.all([
      client.salesQuoteDelivery.count({ where: { status: "QUEUED" } }),
      client.salesStatementDelivery.count({ where: { status: "QUEUED" } }),
      client.salesReceivableReminder.count({ where: { status: "QUEUED" } }),
    ]).then((counts) => counts.reduce((sum, n) => sum + n, 0)),
  ]);
  const lines: string[] = [];
  if (registers > 0) {
    lines.push(
      `${registers === 1 ? "1 caja sigue abierta" : `${registers} cajas siguen abiertas`}: haz su corte antes, después ya no se podrá cerrar.`,
    );
  }
  if (orders > 0) {
    lines.push(
      `${orders === 1 ? "1 pedido espera" : `${orders} pedidos esperan`} entrega: lo que falta ya no se podrá entregar ni cobrar.`,
    );
  }
  const owed = accounts.reduce(
    (sum, account) =>
      sum
        .plus(account.owed.toString())
        .minus(
          account.payments.reduce(
            (paid, payment) => paid.plus(payment.amount.toString()),
            dec(0),
          ),
        )
        .minus(creditedOf(account.credits)),
    dec(0),
  );
  if (accounts.length > 0) {
    lines.push(
      `${accounts.length === 1 ? "1 cuenta a plazos debe" : `${accounts.length} cuentas a plazos deben`} ${formatMoney(owed)}: sus abonos ya no se podrán registrar.`,
    );
  }
  if (mails > 0) {
    lines.push(
      `${mails === 1 ? "1 envío por correo" : `${mails} envíos por correo`} en camino: no saldrá${mails === 1 ? "" : "n"}.`,
    );
  }
  return lines;
}
