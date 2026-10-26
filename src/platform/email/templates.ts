import type { EmailAttachment, EmailMessage } from "./send";

/** Spanish email copy. Plain text first: readable in every client. */

export function verificationEmail(input: {
  to: string;
  name: string;
  url: string;
  hours: number;
}): EmailMessage {
  return {
    to: input.to,
    subject: "Confirma tu correo para Almacén",
    actionUrl: input.url,
    text: [
      `Hola, ${input.name}:`,
      "",
      "Para activar tu cuenta de Almacén, abre este enlace y entra con la contraseña que elegiste:",
      input.url,
      "",
      `El enlace vence en ${input.hours} horas.`,
      "Si no creaste esta cuenta, ignora este mensaje: sin la contraseña nadie puede activarla.",
    ].join("\n"),
  };
}

export function existingAccountEmail(input: {
  to: string;
  name: string;
  signInUrl: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: "Alguien intentó crear una cuenta con tu correo",
    actionUrl: input.signInUrl,
    text: [
      `Hola, ${input.name}:`,
      "",
      "Recibimos un intento de crear una cuenta nueva de Almacén con este correo, pero ya tienes una.",
      "Si fuiste tú, inicia sesión con tu cuenta actual:",
      input.signInUrl,
      "Si no recuerdas su contraseña (o no la elegiste tú), usa «¿Olvidaste tu contraseña?» en esa pantalla.",
      "",
      "Si no fuiste tú, no necesitas hacer nada: tu cuenta no cambió.",
    ].join("\n"),
  };
}

export function passwordResetEmail(input: {
  to: string;
  name: string;
  url: string;
  minutes: number;
}): EmailMessage {
  return {
    to: input.to,
    subject: "Restablece tu contraseña de Almacén",
    actionUrl: input.url,
    text: [
      `Hola, ${input.name}:`,
      "",
      "Recibimos una solicitud para restablecer la contraseña de tu cuenta de Almacén. Elige una nueva con este enlace:",
      input.url,
      "",
      `El enlace vence en ${input.minutes} minutos y solo funciona una vez.`,
      "Si no lo pediste, ignora este mensaje: tu contraseña no cambiará.",
    ].join("\n"),
  };
}

export function passwordChangedEmail(input: {
  to: string;
  name: string;
  recoverUrl: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: "Tu contraseña de Almacén cambió",
    actionUrl: input.recoverUrl,
    text: [
      `Hola, ${input.name}:`,
      "",
      "La contraseña de tu cuenta de Almacén se acaba de cambiar y cerramos todas tus sesiones abiertas.",
      "",
      "Si no fuiste tú, restablécela de inmediato con este enlace:",
      input.recoverUrl,
    ].join("\n"),
  };
}

export function mfaEnabledEmail(input: {
  to: string;
  name: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: "Activaste la verificación en dos pasos",
    text: [
      `Hola, ${input.name}:`,
      "",
      "Tu cuenta de Almacén ahora pide un código de tu app de autenticación además de tu contraseña.",
      "",
      "Si no fuiste tú, cambia tu contraseña de inmediato y escríbenos.",
    ].join("\n"),
  };
}

export function backupCodeUsedEmail(input: {
  to: string;
  name: string;
  left: number;
}): EmailMessage {
  return {
    to: input.to,
    subject: "Entraste con un código de recuperación",
    text: [
      `Hola, ${input.name}:`,
      "",
      "Se inició sesión en tu cuenta de Almacén con un código de recuperación. Ese código ya no sirve.",
      input.left === 1
        ? "Te queda 1 código de recuperación."
        : `Te quedan ${input.left} códigos de recuperación.`,
      "Si perdiste tu teléfono, genera códigos nuevos en Configuración → Seguridad.",
      "",
      "Si no fuiste tú, cambia tu contraseña de inmediato.",
    ].join("\n"),
  };
}

export function backupCodesRegeneratedEmail(input: {
  to: string;
  name: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: "Generaste nuevos códigos de recuperación",
    text: [
      `Hola, ${input.name}:`,
      "",
      "Se generaron nuevos códigos de recuperación para tu cuenta de Almacén. Los anteriores ya no sirven.",
      "",
      "Si no fuiste tú, cambia tu contraseña de inmediato.",
    ].join("\n"),
  };
}

export function mfaDisabledEmail(input: {
  to: string;
  name: string;
}): EmailMessage {
  return {
    to: input.to,
    subject: "Desactivaste la verificación en dos pasos",
    text: [
      `Hola, ${input.name}:`,
      "",
      "Tu cuenta de Almacén ya no pide un código de tu app al iniciar sesión.",
      "",
      "Si no fuiste tú, cambia tu contraseña de inmediato y vuelve a activarla en Configuración → Seguridad.",
    ].join("\n"),
  };
}

export function invitationEmail(input: {
  to: string;
  organizationName: string;
  inviterName: string;
  roleLabels: string[];
  url: string;
  days: number;
}): EmailMessage {
  return {
    to: input.to,
    // Names are written by people: one line, bounded (security audit).
    subject: `${oneLine(input.inviterName, 60)} te invitó a ${oneLine(input.organizationName, 80)} en Almacén`,
    actionUrl: input.url,
    text: [
      "Hola:",
      "",
      `${input.inviterName} te invitó a trabajar en «${input.organizationName}» en Almacén como ${input.roleLabels.join(" y ")}.`,
      "Acepta la invitación con este enlace:",
      input.url,
      "",
      `El enlace vence en ${input.days} días y solo funciona una vez.`,
      "Si no esperabas esta invitación, ignora este mensaje.",
    ].join("\n"),
  };
}

/** A name as it may go into a subject: one line, without control characters. */
const oneLine = (text: string, max: number) =>
  text
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

/**
 * A purchase order for a supplier, with its PDF (CMP-06B). The supplier
 * is not a user of the system: the message says who sends it and answers
 * go to that person, never to the system.
 */
export function purchaseOrderEmail(input: {
  to: string;
  /** Who is greeted: the contact person, or the supplier. */
  greeting: string;
  organizationName: string;
  orderNumber: string;
  /** «20 de octubre de 2026», when the order says it. */
  expectedOn?: string | null;
  sender: { name: string; email: string };
  pdf: EmailAttachment;
}): EmailMessage {
  const company = oneLine(input.organizationName, 100);
  return {
    to: input.to,
    replyTo: input.sender.email,
    subject: `Orden de compra ${oneLine(input.orderNumber, 20)} de ${company}`,
    attachments: [input.pdf],
    text: [
      `Hola, ${oneLine(input.greeting, 120)}:`,
      "",
      `${company} te envía su orden de compra ${input.orderNumber}. Va adjunta en PDF.`,
      ...(input.expectedOn
        ? [`La esperamos para el ${input.expectedOn}.`]
        : []),
      "",
      `Para confirmarla o si tienes dudas, responde a este correo: le llega a ${oneLine(input.sender.name, 120)} (${input.sender.email}).`,
      "",
      `Este mensaje se envió desde Almacén a nombre de ${company}. Si no esperabas esta orden, ignora el mensaje.`,
    ].join("\n"),
  };
}

/** Operations alert for whoever runs the server (PIL-04). */
export function operationsAlertEmail(input: {
  to: string;
  server: string;
  failed: string[];
  recovered: string[];
  stillFailing: string[];
}): EmailMessage {
  const list = (items: string[]) => items.map((item) => `- ${item}`);
  return {
    to: input.to,
    subject:
      input.failed.length > 0
        ? `Almacén: falla en el servidor (${input.server})`
        : `Almacén: el servidor se recuperó (${input.server})`,
    text: [
      ...(input.failed.length > 0
        ? ["Empezó a fallar:", ...list(input.failed), ""]
        : []),
      ...(input.recovered.length > 0
        ? ["Ya funciona otra vez:", ...list(input.recovered), ""]
        : []),
      ...(input.stillFailing.length > 0
        ? ["Sigue fallando:", ...list(input.stillFailing), ""]
        : []),
      "Estado en el servidor: curl -s localhost:3000/api/salud",
      "Registros: journalctl -u almacen-web -u almacen-worker -u almacen-respaldo -n 100",
      "",
      "Avisamos cuando algo empieza a fallar y cuando se recupera, no mientras siga igual.",
    ].join("\n"),
  };
}

/** Receipt of a plan bought online (ADR 0028), to the titular. */
export function planPurchaseEmail(input: {
  to: string;
  name: string;
  organizationName: string;
  transactionId: string;
  /** "1,000 productos · Inventario + Compras". */
  planText: string;
  months: number;
  /** Already formatted: "$1,214.52". */
  subtotal: string;
  discount: string | null;
  /** VAT charged on top; null when the price already included it. */
  tax: string | null;
  total: string;
  /** "Tarjeta (Stripe)", "PayPal", "Mercado Pago", "Código PEPITOGRATIS". */
  paidWith: string;
  /** "31 de enero de 2027". */
  validUntil: string;
  refundTerms: readonly string[];
  planUrl: string;
}): EmailMessage {
  const company = oneLine(input.organizationName, 100);
  return {
    to: input.to,
    subject: `Tu compra en Almacén (${input.transactionId})`,
    actionUrl: input.planUrl,
    text: [
      `Hola, ${oneLine(input.name, 80)}:`,
      "",
      `Gracias por tu compra. El plan de ${company} ya está activo.`,
      "",
      `ID de transacción: ${input.transactionId}`,
      `Plan: ${input.planText}`,
      `Meses: ${input.months}`,
      `Subtotal: ${input.subtotal}`,
      ...(input.discount ? [`Descuento: −${input.discount}`] : []),
      ...(input.tax ? [`IVA (16%): ${input.tax}`] : []),
      `Total pagado: ${input.total} MXN`,
      `Forma de pago: ${input.paidWith}`,
      `Vigente hasta: ${input.validUntil}`,
      "",
      "Todas las personas de tu equipo usan este mismo plan; no necesitan comprar nada.",
      `Ve tu plan en: ${input.planUrl}`,
      "",
      "Reembolsos:",
      ...input.refundTerms.map((line) => `- ${line}`),
      "",
      "Guarda este correo: el ID de transacción es tu comprobante para cualquier aclaración.",
    ].join("\n"),
  };
}
