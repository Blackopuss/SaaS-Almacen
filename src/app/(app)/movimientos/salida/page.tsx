import type { Metadata } from "next";

import { getModuleAccess } from "@/platform/billing";

import { MovementScreen } from "../movement-screen";

export const metadata: Metadata = { title: "Registrar salida" };

/** Exit of stock (INV-19). */
export default async function SalidaPage({
  searchParams,
}: PageProps<"/movimientos/salida">) {
  const access = await getModuleAccess();
  return (
    <MovementScreen kind="exit" access={access} searchParams={searchParams} />
  );
}
