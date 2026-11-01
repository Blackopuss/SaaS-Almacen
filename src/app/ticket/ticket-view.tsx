import type { Ticket } from "@/modules/sales";

/**
 * A sale's ticket (VEN-15): on screen as a card and, printed, 80 mm wide
 * for a thermal printer. Not a tax receipt.
 */
export function TicketView({ ticket }: { ticket: Ticket }) {
  return (
    <article
      aria-label={`Ticket de la venta ${ticket.number}`}
      className="mx-auto w-full max-w-sm space-y-3 rounded-xl border bg-card p-5 text-sm tabular-nums print:mx-0 print:w-[72mm] print:max-w-none print:rounded-none print:border-0 print:p-0 print:text-[11px] print:text-black"
    >
      <header className="space-y-0.5 text-center">
        <p className="text-base font-semibold">{ticket.company}</p>
        <p>Venta {ticket.number}</p>
        <p className="text-muted-foreground print:text-black">{ticket.date}</p>
        {ticket.cashier && (
          <p className="text-muted-foreground print:text-black">
            Le atendió {ticket.cashier}
          </p>
        )}
        {ticket.customer && <p>Cliente: {ticket.customer}</p>}
        {ticket.cancelled && (
          <p className="pt-1 font-semibold text-destructive print:text-black">
            VENTA CANCELADA
          </p>
        )}
      </header>

      <ul className="space-y-2 border-y border-dashed py-3">
        {ticket.lines.map((line, index) => (
          <li key={index}>
            <p className="font-medium [overflow-wrap:anywhere]">{line.name}</p>
            <p className="flex justify-between gap-2">
              <span className="text-muted-foreground print:text-black">
                {line.quantity} × {line.unitPrice}
              </span>
              <span>{line.amount}</span>
            </p>
          </li>
        ))}
      </ul>

      <dl className="space-y-1">
        {ticket.discount && <Row label="Descuento" value={ticket.discount} />}
        {!ticket.taxLabel.startsWith("IVA incluido") && (
          <Row label="Subtotal" value={ticket.subtotal} />
        )}
        <Row label={ticket.taxLabel} value={ticket.tax} />
        <div className="flex justify-between gap-2 border-t pt-1 text-base font-semibold">
          <dt>Total</dt>
          <dd>{ticket.total}</dd>
        </div>
      </dl>

      <dl className="space-y-1 border-t border-dashed pt-2">
        {ticket.payments.map((payment, index) => (
          <div key={index}>
            <Row label={payment.method} value={payment.amount} />
            {payment.detail && (
              <p className="text-right text-muted-foreground print:text-black">
                {payment.detail}
              </p>
            )}
          </div>
        ))}
      </dl>

      <p className="text-center text-xs text-muted-foreground print:text-black">
        Este ticket no es un comprobante fiscal. Gracias por su compra.
      </p>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
