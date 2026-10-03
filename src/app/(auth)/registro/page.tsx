import type { Metadata } from "next";

import { PASSWORD_MIN_LENGTH } from "@/platform/auth";

import { RegisterForm } from "./register-form";

export const metadata: Metadata = {
  title: "Crear cuenta",
  description: "Crea tu cuenta para controlar el inventario de tu negocio.",
};

export default function RegistroPage() {
  return <RegisterForm minLength={PASSWORD_MIN_LENGTH} />;
}
