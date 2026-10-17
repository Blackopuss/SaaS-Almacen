# ADR 0023: Correo real por SMTP

- **Estado:** aceptada.
- **Fecha:** 2026-10-16.

## Contexto

Hasta ahora solo existían dos formas de correo:
- `log`, para desarrollo;
- `memory`, para pruebas.

Producción se niega a arrancar sin un proveedor real (ADR 0003, «Requisitos de producción» 1). Sin correo no hay confirmación de cuenta, recuperación, invitaciones ni envío de órdenes. El servidor será un VPS (KVM 2 de Hostinger), y el proveedor todavía no está elegido.

## Decisión

- **Nuevo modo de envío `MAIL_DRIVER=smtp`, con `nodemailer` 10.0.13.**
  - Versión exacta, publicada hace más de dos semanas.
  - SMTP lo ofrecen todos los proveedores: Resend, Amazon SES, Brevo, Postmark y el correo del propio hosting. Cambiar de proveedor es cambiar variables, no código.
- **Variables:**
  - `SMTP_HOST`.
  - `SMTP_PORT`: por omisión 587, o 465 con `tls`.
  - `SMTP_SECURITY`: `starttls` (por omisión), `tls` o `none`.
  - `SMTP_USER` y `SMTP_PASSWORD`, siempre juntas.
  - `MAIL_FROM`, por ejemplo `Almacén <avisos@dominio.mx>`.
  - `smtpSettings()` valida todas al enviar.
- **Siempre cifrado:**
  - Se exige TLS 1.2 o superior y un certificado válido.
  - `none` solo se acepta hacia la misma máquina (un relay local o una prueba).
- **Lo que no cambia:**
  - Las validaciones de `sendEmail`: sin saltos de línea en las cabeceras, adjuntos acotados y destinatario válido. Corren antes de conectar.
  - El mensaje se arma solo con texto y `Buffer`. Se desactivan el acceso a archivos y a URLs de `nodemailer`.
- **Fallos:** un fallo de conexión o del proveedor se lanza como error.
  - El worker reintenta los envíos de órdenes (CMP-06B).
  - Los correos de cuenta muestran su error genérico.
- **`npm run correo:prueba -- correo@dominio`** manda un correo de prueba con la configuración actual.

## Consecuencias

- Para producción hay que elegir un proveedor y verificar el dominio (SPF, DKIM y DMARC), o los correos irán a spam. Los pasos están en `docs/DESPLIEGUE.md`.
- El texto de los correos sigue siendo texto plano. Una versión HTML queda para después.
- Prueba: `tests/platform/email-smtp.int.test.ts`. Un servidor SMTP mínimo en la misma máquina recibe el mensaje real (remitente, `Reply-To`, asunto y adjunto). También comprueba que nunca se mande sin cifrar por la red.
