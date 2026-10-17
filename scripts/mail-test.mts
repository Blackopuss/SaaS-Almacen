// Sends one test email with the configured driver (ADR 0023), to check the
// provider before opening the service.
// Usage: npm run correo:prueba -- tu@correo.mx
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const to = (process.argv[2] ?? "").trim();
if (!to) {
  console.error("Uso: npm run correo:prueba -- tu@correo.mx");
  process.exit(1);
}

// Imported after the environment is loaded.
const { sendEmail } = await import("@/platform/email");

try {
  await sendEmail({
    to,
    subject: "Prueba de correo de Almacén",
    text: [
      "Hola:",
      "",
      `Este es un correo de prueba enviado con MAIL_DRIVER=${process.env.MAIL_DRIVER ?? "log"}.`,
      "Si te llegó, el servidor ya puede mandar confirmaciones, recuperaciones e invitaciones.",
    ].join("\n"),
  });
  console.log(`Correo enviado a ${to}. Revisa también la carpeta de spam.`);
} catch (error) {
  console.error("No se pudo enviar:", (error as Error).message);
  process.exit(1);
}
