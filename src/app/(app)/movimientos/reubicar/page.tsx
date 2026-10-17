import type { Metadata } from "next";

import { getModuleAccess } from "@/platform/billing";

import { MovementScreen } from "../movement-screen";

export const metadata: Metadata = { title: "Reubicar" };

/** Relocation of stock between two locations (INV-23). */
export default async function ReubicarPage({
  searchParams,
}: PageProps<"/movimientos/reubicar">) {
  const access = await getModuleAccess();
  return (
    <MovementScreen
      kind="transfer"
      access={access}
      searchParams={searchParams}
    />
  );
}
