import type { Metadata } from "next";

import { getModuleAccess } from "@/platform/billing";

import { QuoteScreen } from "../quote-screen";

export const metadata: Metadata = { title: "Nueva cotización" };

export default async function NuevaCotizacionPage() {
  const access = await getModuleAccess();
  return <QuoteScreen access={access} quoteId={null} />;
}
