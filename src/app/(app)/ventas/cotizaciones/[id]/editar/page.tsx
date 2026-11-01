import type { Metadata } from "next";

import { getModuleAccess } from "@/platform/billing";

import { QuoteScreen } from "../../quote-screen";

export const metadata: Metadata = { title: "Editar cotización" };

export default async function EditarCotizacionPage({
  params,
}: PageProps<"/ventas/cotizaciones/[id]/editar">) {
  const access = await getModuleAccess();
  const { id } = await params;
  return <QuoteScreen access={access} quoteId={id} />;
}
