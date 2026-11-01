import type { Metadata } from "next";

import { getModuleAccess } from "@/platform/billing";

import { ReturnScreen } from "../return-screen";

export const metadata: Metadata = { title: "Devolver productos" };

export default async function DevolverPage({
  params,
}: PageProps<"/ventas/[id]/devolver">) {
  const access = await getModuleAccess();
  const { id } = await params;
  return <ReturnScreen access={access} saleId={id} mode="return" />;
}
