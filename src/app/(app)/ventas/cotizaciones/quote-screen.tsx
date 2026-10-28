import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import {
  QUOTE_MAX_LINES,
  defaultQuoteValidity,
  describeTerms,
  getInstallmentTerms,
  getQuote,
  getSaleProduct,
} from "@/modules/sales";
import type { getModuleAccess } from "@/platform/billing";

import { QuoteForm, type QuoteFormDraft } from "./quote-form";

/**
 * «Nueva cotización» and «Editar cotización» (COT-02): the same form, empty
 * or with a draft's customer, validity, discount, notes and lines.
 */
export async function QuoteScreen({
  access,
  quoteId,
}: {
  access: Awaited<ReturnType<typeof getModuleAccess>>;
  /** Null for a new quote. */
  quoteId: string | null;
}) {
  const backHref = quoteId
    ? `/ventas/cotizaciones/${encodeURIComponent(quoteId)}`
    : "/ventas/cotizaciones";
  const back = (
    <Link
      href={backHref}
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      {quoteId ? "Cotización" : "Cotizaciones"}
    </Link>
  );
  if (!access.can("sales.quote.create")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const state = access.moduleState("sales");
  if (state !== "active") {
    return (
      <PageContainer>
        {back}
        {state === "none" ? (
          <NoModuleState module="Ventas" />
        ) : (
          <ReadOnlyNotice module="Ventas" />
        )}
      </PageContainer>
    );
  }
  const actor = {
    organizationId: access.organization.id,
    userId: access.user.id,
  };

  let draft: QuoteFormDraft;
  let title = "Nueva cotización";
  let missing: string[] = [];
  if (quoteId) {
    const quote = await getQuote(actor, quoteId);
    if (!quote) notFound();
    title = `Editar cotización ${quote.number}`;
    if (quote.status !== "DRAFT") {
      return (
        <PageContainer>
          {back}
          <PageHeader title={title} />
          <p className="text-sm">
            Esta cotización ya se envió: ya no se puede cambiar.
          </p>
        </PageContainer>
      );
    }
    const products = await Promise.all(
      quote.lines.map((line) => getSaleProduct(actor, line.productId)),
    );
    missing = quote.lines
      .filter((_, index) => !products[index])
      .map((line) => line.productName);
    draft = {
      customer: quote.customer,
      validUntil: quote.validUntil,
      notes: quote.notes ?? "",
      discountPercent: quote.discount?.percent ?? "",
      discountReason: quote.discount?.reason ?? "",
      planMonths: quote.plan ? String(quote.plan.months) : "",
      planDownPayment: quote.plan?.downPayment ?? "",
      lines: quote.lines.flatMap((line, index) => {
        const product = products[index];
        return product
          ? [{ product, quantity: line.quantity, capture: line.capture }]
          : [];
      }),
    };
  } else {
    draft = {
      customer: null,
      validUntil: await defaultQuoteValidity(actor),
      notes: "",
      discountPercent: "",
      discountReason: "",
      planMonths: "",
      planDownPayment: "",
      lines: [],
    };
  }
  const terms = await getInstallmentTerms(actor);

  return (
    <PageContainer>
      {back}
      <PageHeader title={title} />
      {missing.length > 0 && (
        <p role="status" className="text-sm">
          Ya no se pueden cotizar: {missing.join(", ")}. Se quitarán al guardar.
        </p>
      )}
      <QuoteForm
        quoteId={quoteId}
        draft={draft}
        maxLines={QUOTE_MAX_LINES}
        terms={terms.map((term) => ({
          value: String(term.months),
          label: describeTerms([term]),
        }))}
        canCreateCustomer={access.allows("sales.customer.create")}
        cancelHref={backHref}
      />
    </PageContainer>
  );
}
