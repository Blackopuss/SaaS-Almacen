import { redirect } from "next/navigation";

/**
 * Old landing of Better Auth's verification link. Links now go to
 * /confirmar-correo and the email is confirmed by signing in with the
 * password there (security audit 2); old links end up here.
 */
export default function CorreoVerificadoPage() {
  redirect("/ingresar");
}
