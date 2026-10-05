import type { Metadata } from "next";

import { MovementScreen } from "../movement-screen";

export const metadata: Metadata = { title: "Registrar salida" };

/** Exit of stock (INV-19). */
export default function SalidaPage({
  searchParams,
}: PageProps<"/movimientos/salida">) {
  return <MovementScreen kind="exit" searchParams={searchParams} />;
}
