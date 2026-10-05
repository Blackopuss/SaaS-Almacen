import type { Metadata } from "next";

import { MovementScreen } from "../movement-screen";

export const metadata: Metadata = { title: "Registrar entrada" };

/** Entry of stock (INV-16/17). */
export default function EntradaPage({
  searchParams,
}: PageProps<"/movimientos/entrada">) {
  return <MovementScreen kind="entry" searchParams={searchParams} />;
}
