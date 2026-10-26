import { ChevronLeft, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { NoAccessState, PageContainer, PageHeader } from "@/components";
import { formatDate } from "@/lib";
import { getAccess } from "@/platform/authorization";
import {
  CONTACT_EMAIL,
  PLAN_TIERS,
  formatMxn,
  getCheckoutOptions,
  planText,
} from "@/platform/billing";

import { CheckoutForm, type TierCard } from "./checkout-form";
import { quoteKey, showQuote, type ShownQuote } from "./quotes";

export const metadata: Metadata = { title: "Comprar plan" };

const backLink = (
  <Link
    href="/configuracion/plan"
    className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
  >
    <ChevronLeft aria-hidden="true" className="size-4" />
    Mi plan
  </Link>
);

function Note({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 rounded-xl border bg-card p-4 text-sm sm:p-5"
    >
      <CircleAlert
        aria-hidden="true"
        className="mt-0.5 size-4 shrink-0 text-warning"
      />
      <p>{children}</p>
    </div>
  );
}

/** «Comprar plan» (ADR 0028): only the titular buys, for the whole team. */
export default async function BuyPlanPage({
  searchParams,
}: PageProps<"/configuracion/plan/comprar">) {
  const access = await getAccess();
  if (!access.can("platform.subscription.create")) {
    return (
      <PageContainer>
        {backLink}
        <NoAccessState
          title="Solo el titular compra el plan"
          description="Solo el titular de la empresa compra el plan; tu equipo usa el mismo plan."
        />
      </PageContainer>
    );
  }

  const { cancelada } = await searchParams;
  const options = await getCheckoutOptions({
    organizationId: access.organization.id,
    userId: access.user.id,
  });
  const { current } = options;
  const quotes: Record<string, ShownQuote> = {};
  for (const tier of options.tiers) {
    for (const each of tier.quotes) {
      quotes[quoteKey(tier.id, each.months, false)] = showQuote(each.inventory);
      quotes[quoteKey(tier.id, each.months, true)] = showQuote(
        each.withPurchasing,
      );
    }
  }
  const tiers: TierCard[] = options.tiers.map((tier) => ({
    id: tier.id,
    products: tier.productLimit.toLocaleString("es-MX"),
    users: tier.users,
    purchasingMonthly: formatMxn(
      PLAN_TIERS.find((t) => t.id === tier.id)?.prices.purchasing ?? "0",
    ),
  }));

  // While the plan is live it can only be renewed as it is (the service decides).
  const renewalOnly = current?.live === true && current.validUntil !== null;
  const unlimited = current?.live === true && current.validUntil === null;
  // A live plan offers only itself: the other tiers would just be refused.
  const lockedTier = renewalOnly ? (current?.tierId ?? null) : null;
  const currentText =
    current && current.productLimit !== null
      ? planText(current.productLimit, current.purchasing ? ["purchasing"] : [])
      : null;

  return (
    <PageContainer>
      {backLink}
      <PageHeader
        title="Comprar plan"
        description="Elige tu plan y por cuántos meses. Aplica para toda tu empresa: tu equipo usa el mismo plan."
      />

      {cancelada === "1" && (
        <Note>
          No se completó el pago y no se te cobró nada. Puedes intentarlo otra
          vez.
        </Note>
      )}
      {currentText && current && (
        <p className="rounded-xl border bg-card p-4 text-sm sm:p-5">
          <span className="font-medium">Tu plan actual:</span> {currentText}
          {" · "}
          {!current.live
            ? "ya venció"
            : current.validUntil
              ? `vigente hasta el ${formatDate(current.validUntil)}`
              : "sin fecha de término"}
        </p>
      )}

      {unlimited ? (
        <Note>Tu plan no tiene fecha de término: no necesitas comprarlo.</Note>
      ) : renewalOnly && !lockedTier ? (
        <Note>
          Tu plan es especial y no se renueva en línea. Escríbenos a{" "}
          {CONTACT_EMAIL} para renovarlo.
        </Note>
      ) : (
        <>
          {renewalOnly && (
            <Note>
              Mientras tu plan esté vigente puedes renovarlo igual; los meses
              nuevos empiezan al terminar los que ya tienes. Para cambiar de
              nivel o de módulos escríbenos a {CONTACT_EMAIL}.
            </Note>
          )}
          <CheckoutForm
            tiers={
              lockedTier ? tiers.filter((t) => t.id === lockedTier) : tiers
            }
            lockPurchasing={renewalOnly}
            months={[...options.months]}
            quotes={quotes}
            providers={options.providers}
            refundTerms={[...options.refundTerms]}
            initial={{
              tier:
                (renewalOnly && current?.tierId) || options.tiers[0]?.id || "",
              months: "1",
              purchasing: renewalOnly ? current!.purchasing : false,
              code: "",
            }}
          />
        </>
      )}
    </PageContainer>
  );
}
