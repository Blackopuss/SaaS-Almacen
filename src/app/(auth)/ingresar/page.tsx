import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { getCurrentSession, safeRedirectPath } from "@/platform/auth";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Iniciar sesión",
  description: "Entra a tu inventario.",
};

export default async function IngresarPage({
  searchParams,
}: PageProps<"/ingresar">) {
  const { siguiente } = await searchParams;
  const next = safeRedirectPath(siguiente);
  // Already signed in (validated against the database): go straight in.
  if (await getCurrentSession()) redirect(next);
  return <SignInForm next={next} />;
}
