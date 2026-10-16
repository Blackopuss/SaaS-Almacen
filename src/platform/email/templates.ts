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
