import { formatDateTime } from "@/lib";
import type { CashSessionView } from "@/modules/sales";

/** What a register has had: float, sales by method, money in and out. */
export function CashSummary({
  session,
  timeZone,
}: {
  session: CashSessionView;
  timeZone: string;
}) {
  const rows = [
    ["Fondo", session.totals.float],
    ["Ventas en efectivo", session.totals.cashSales],
    ["Dinero que entró", session.totals.cashIn],
    [
      "Dinero que salió",
      session.totals.cashOut === "$0.00"
        ? "$0.00"
        : `-${session.totals.cashOut}`,
    ],
  ] as const;
  return (
    <section
      aria-label="Resumen de la caja"
      className="space-y-3 rounded-xl border bg-card p-4 sm:p-5"
    >
      <p className="text-sm text-muted-foreground">
        {session.cashier} · abierta el{" "}
        {formatDateTime(session.openedAt, timeZone)}
      </p>
      <dl className="space-y-1 text-sm tabular-nums">
        {rows.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-3">
            <dt className="text-muted-foreground">{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-3 border-t pt-2 font-medium">
          <dt>Efectivo que debe haber</dt>
          <dd>{session.totals.expectedCash}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Tarjeta</dt>
          <dd>{session.totals.card}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Transferencias</dt>
          <dd>{session.totals.transfer}</dd>
        </div>
      </dl>
      {session.movements.length > 0 && (
        <ul className="divide-y border-t text-sm">
          {session.movements.map((movement, index) => (
            <li key={index} className="flex justify-between gap-3 py-2">
              <span className="min-w-0 [overflow-wrap:anywhere]">
                {movement.reason}
              </span>
              <span className="shrink-0 tabular-nums">
                {movement.direction === "IN" ? "+" : "-"}
                {movement.amount}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
