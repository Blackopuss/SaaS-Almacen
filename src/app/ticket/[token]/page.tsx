import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublicTicket } from "@/modules/sales";

import { PrintButton } from "../print-button";
import { TicketView } from "../ticket-view";

export const metadata: Metadata = {
  title: "Ticket",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * A sale's ticket for the customer (VEN-15): opened from its signed link
 * without signing in. Only what the printed ticket says.
 */
export default async function TicketPage({
  params,
}: PageProps<"/ticket/[token]">) {
  const { token } = await params;
  const ticket = await getPublicTicket(token);
  if (!ticket) notFound();
  return (
    <main className="min-h-dvh bg-background px-4 py-8 print:p-0">
      <TicketView ticket={ticket} />
      <div className="mx-auto mt-4 flex max-w-sm justify-center print:hidden">
        <PrintButton />
      </div>
    </main>
  );
}
