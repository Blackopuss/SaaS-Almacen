import type { EmailMessage } from "./send";

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
      "Para activar tu cuenta de Almacén, confirma tu correo con este enlace:",
      input.url,
      "",
      `El enlace vence en ${input.hours} horas y solo funciona una vez.`,
      "Si no creaste esta cuenta, ignora este mensaje.",
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
    subject: `${input.inviterName} te invitó a ${input.organizationName} en Almacén`,
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
