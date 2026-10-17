import type { Metadata } from "next";

import { getModuleAccess } from "@/platform/billing";

import { MovementScreen } from "../movement-screen";

export const metadata: Metadata = { title: "Ajustar existencias" };

/** Adjustment of stock to what was counted, with a reason (INV-24). */
export default async function AjustePage({
  searchParams,
}: PageProps<"/movimientos/ajuste">) {
  const access = await getModuleAccess();
  return (
    <MovementScreen
      kind="adjustment"
      access={access}
      searchParams={searchParams}
    />
  );
}
