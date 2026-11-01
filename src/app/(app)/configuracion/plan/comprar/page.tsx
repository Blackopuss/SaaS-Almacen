import { ChevronLeft, CircleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { NoAccessState, PageContainer, PageHeader } from "@/components";
import { formatDate } from "@/lib";
import { getAccess } from "@/platform/authorization";
import {
  ADD_ON_MODULES,
  ADD_ON_SUMMARIES,
  CONTACT_EMAIL,
  SOLD_MODULE_NAMES,
  formatMxn,
  getCheckoutOptions,
  planText,
} from "@/platform/billing";

import { CheckoutForm, type TierCard } from "./checkout-form";
import { quoteTable } from "./quotes";

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
  // Every combination priced on the server; the browser only looks up.
  const quotes = quoteTable(0, options.carry);
  const tiers: TierCard[] = options.tiers.map((tier) => ({
    id: tier.id,
    products: tier.productLimit.toLocaleString("es-MX"),
    users: tier.users,
    addOnMonthly: Object.fromEntries(
      ADD_ON_MODULES.map((module) => [
        module,
        formatMxn(tier.addOnMonthly[module]),
      ]),
    ),
  }));
  const addOns = ADD_ON_MODULES.map((module) => ({
    id: module,
    name: SOLD_MODULE_NAMES[module],
    summary: ADD_ON_SUMMARIES[module],
  }));

  // A live plan can be renewed or changed (BIL-08..10); one with no end or
  // made by hand by staff is not bought online (the service decides too).
  const live = current?.live === true;
  const unlimited = live && current?.validUntil === null;
  const special = live && current?.validUntil !== null && !current?.tierId;
  const currentText =
    current && current.productLimit !== null
      ? planText(current.productLimit, current.addOns)
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
      ) : special ? (
        <Note>
          Tu plan es especial y no se renueva en línea. Escríbenos a{" "}
          {CONTACT_EMAIL} para renovarlo.
        </Note>
      ) : (
        <>
          {options.carry && (
            <Note>
              Puedes renovar o cambiar tu plan. Los meses que compres se suman a
              los días que te quedan. Si eliges un plan mayor, empieza al pagar
              y pagas la diferencia de esos días; si eliges uno menor, también
              empieza al pagar y la diferencia no se devuelve.
            </Note>
          )}
          <CheckoutForm
            tiers={tiers}
            addOns={addOns}
            changeUntil={
              options.carry && current?.validUntil
                ? formatDate(current.validUntil)
                : null
            }
            months={[...options.months]}
            quotes={quotes}
            providers={options.providers}
            refundTerms={[...options.refundTerms]}
            initial={{
              tier: (live && current?.tierId) || options.tiers[0]?.id || "",
              months: "1",
              modules: live && current ? [...current.addOns] : [],
              code: "",
            }}
          />
        </>
      )}
    </PageContainer>
  );
}
