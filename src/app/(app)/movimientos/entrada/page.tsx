import type { Metadata } from "next";

import { getModuleAccess } from "@/platform/billing";

import { MovementScreen } from "../movement-screen";

export const metadata: Metadata = { title: "Registrar entrada" };

/** Entry of stock (INV-16/17). */
export default async function EntradaPage({
  searchParams,
}: PageProps<"/movimientos/entrada">) {
  const access = await getModuleAccess();
  return (
    <MovementScreen kind="entry" access={access} searchParams={searchParams} />
  );
}
