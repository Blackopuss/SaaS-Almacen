import { ChevronLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import {
  NoAccessState,
  NoModuleState,
  PageContainer,
  PageHeader,
  ReadOnlyNotice,
} from "@/components";
import {
  MAX_INSTALLMENT_TERMS,
  getInstallmentTerms,
  getSalesSettings,
} from "@/modules/sales";
import { getModuleAccess } from "@/platform/billing";

import { InstallmentTermsForm } from "./installment-terms-form";
import { SalesSettingsForm } from "./sales-settings-form";

export const metadata: Metadata = { title: "Ventas" };

/** «16.00» → «16», «12.50» → «12.5». */
const plain = (value: string) => value.replace(/\.?0+$/, "");

/** How the company sells (VEN-04, VEN-14): only the titular, with Ventas. */
export default async function VentasConfigPage() {
  const access = await getModuleAccess();
  const back = (
    <Link
      href="/configuracion"
      className="inline-flex min-h-11 items-center gap-1 rounded-lg text-sm font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      Configuración
    </Link>
  );
  if (!access.can("sales.settings.update")) {
    return (
      <PageContainer>
        {back}
        <NoAccessState />
      </PageContainer>
    );
  }
  const moduleState = access.moduleState("sales");
  if (moduleState !== "active") {
    return (
      <PageContainer>
        {back}
        {moduleState === "none" ? (
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
  const [settings, terms] = await Promise.all([
    getSalesSettings(actor),
    getInstallmentTerms(actor),
  ]);

  return (
    <PageContainer>
      {back}
      <PageHeader title="Ventas" />
      <SalesSettingsForm
        taxMode={settings.pricesIncludeTax ? "included" : "added"}
        taxRate={plain(settings.rate)}
        caps={{
          cashier: plain(settings.caps.cashier),
          cash_manager: plain(settings.caps.cash_manager),
          administrator: plain(settings.caps.administrator),
        }}
      />
      <InstallmentTermsForm
        terms={terms.map((term) => ({
          months: String(term.months),
          interest: plain(term.interestPercent),
        }))}
        maxTerms={MAX_INSTALLMENT_TERMS}
      />
    </PageContainer>
  );
}
