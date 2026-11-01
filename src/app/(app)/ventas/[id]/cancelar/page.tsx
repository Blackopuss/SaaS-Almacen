import type { Metadata } from "next";

import { getModuleAccess } from "@/platform/billing";

import { ReturnScreen } from "../return-screen";

export const metadata: Metadata = { title: "Cancelar venta" };

export default async function CancelarPage({
  params,
}: PageProps<"/ventas/[id]/cancelar">) {
  const access = await getModuleAccess();
  const { id } = await params;
  return <ReturnScreen access={access} saleId={id} mode="cancel" />;
}
