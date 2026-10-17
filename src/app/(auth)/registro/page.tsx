import type { Metadata } from "next";
import { redirect } from "next/navigation";

import {
  DEFAULT_AFTER_SIGN_IN,
  PASSWORD_MIN_LENGTH,
  getCurrentSession,
} from "@/platform/auth";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Crear cuenta",
  description: "Crea tu cuenta para controlar el inventario de tu negocio.",
};

export default async function RegistroPage() {
  if (await getCurrentSession()) redirect(DEFAULT_AFTER_SIGN_IN);
  return <RegisterForm minLength={PASSWORD_MIN_LENGTH} />;
}
