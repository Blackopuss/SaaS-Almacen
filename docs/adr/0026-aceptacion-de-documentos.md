# ADR 0026: Aceptación versionada de términos y aviso de privacidad

- **Estado:** aceptada.
- **Fecha:** 2026-10-25.
- **Paso:** PIL-09 (depende de PIL-08: los textos definitivos aún no los revisa un profesional).

## Contexto

- PIL-09 pide guardar **versión, fecha y usuario** de cada aceptación de los términos y condiciones y del aviso de privacidad.
- Los textos viven en `src/app/(sitio)/terminos` y `privacidad` y van a cambiar cuando los revise el abogado (PIL-08). Publicar un texto nuevo no debe pedir más que cambiar la página y subir una versión.
- Las cuentas nacen por dos caminos: el registro (`registerUser`, que llama a Better Auth) y la invitación con cuenta nueva (`acceptInvitationAsNewUser`, en una transacción propia).

## Decisión

- **Versiones en código:** `LEGAL_DOCUMENTS` de `src/platform/legal/documents.ts` (`terms`, `privacy`), cada una con su versión `AAAA-MM-DD` = fecha en que el texto entra en vigor. Las páginas públicas muestran «Versión … · vigente desde el …» a partir de esa constante (se quitó `SITE.legalUpdatedAt`, que era un segundo dato que había que acordarse de cambiar).
- **Tabla `legal_acceptance`** (una fila por persona, documento y versión): `userId`, `document`, `version`, `acceptedAt`, IP (`clientIp`) y navegador.
  - **Por persona, no por empresa:** los documentos se aceptan una vez por cuenta, aunque la persona trabaje en varias empresas. Por eso **no** está en `TENANT_MODELS` ni lleva `organizationId`; se usa con `db`, como `security_event` y `session`.
  - **Sin llave foránea y solo agregar** (disparadores que rechazan `UPDATE` y `DELETE`, igual que la bitácora): es la prueba del consentimiento y debe sobrevivir a la cuenta.
  - **Única por (persona, documento, versión):** la primera aceptación de una versión es la que cuenta; aceptar dos veces (doble clic, dos pestañas) no agrega filas (`skipDuplicates`). Una versión nueva es una fila nueva; las anteriores se conservan.
- **Al crear la cuenta**, una casilla obligatoria (`LegalConsent`, enlaces a los dos documentos en otra pestaña) validada con Zod en el servicio (`legalConsentSchema`):
  - **Invitación:** `recordLegalAcceptance(tx, …)` dentro de la misma transacción que crea cuenta y membresía: existen las tres cosas o ninguna.
  - **Registro:** Better Auth crea la cuenta en su propia transacción y no deja escribir otras tablas dentro de ella. La aceptación la guarda el gancho `databaseHooks.user.create.after` de `auth.ts`, que Better Auth corre justo después de confirmar, solo para `/sign-up/email` (que solo alcanza `registerUser`, con la casilla ya validada: el HTTP de registro está cerrado desde PLT-15). Un registro con un correo que ya existe no crea usuario, así que no registra nada a nombre del dueño real.
  - Si esa escritura falla, se registra en el log y la cuenta queda sin aceptación: la compuerta de abajo se la pide al primer inicio de sesión. Nadie usa la aplicación sin una aceptación guardada.
- **Compuerta en `requireSession`:** si a la persona le falta aceptar la versión vigente de algún documento (`pendingLegalDocuments`, una consulta por la llave única), se la manda a `/acepta-terminos`. Esa pantalla y su acción pasan `allowPendingLegal` y `allowMissingMfa`, así que la compuerta de MFA y esta nunca se mandan una a la otra: primero se aceptan los documentos y después, si aplica, se activa MFA. La pantalla ofrece «Cerrar sesión» para quien no esté de acuerdo.
  - Aplica a todo lo que pasa por `requireSession`: pantallas de la app, `/crear-empresa`, `/activa-dos-pasos`, `/interno` y las rutas `GET` de descargas (redirigen igual que con MFA). No aplica a las pantallas sin sesión ni a los enlaces de correo.
- **Cuenta demo:** `npm run db:seed` guarda su aceptación de las versiones vigentes para que `verify:ui` entre directo; tras subir una versión hay que volver a sembrar. `npm run test:company` no la guarda: esa cuenta pasa por la pantalla, como una persona real.

## Cómo publicar un texto nuevo

1. Cambiar la página (`terminos/page.tsx` o `privacidad/page.tsx`).
2. Subir su `version` en `LEGAL_DOCUMENTS` a la fecha en que entra en vigor.
3. Desplegar. Cada persona verá `/acepta-terminos` en su siguiente pantalla; las aceptaciones anteriores quedan guardadas.

Avisar por correo antes de un cambio importante (lo prometen los propios textos) queda fuera de este paso.

## Consecuencias

- Una consulta pequeña más por cada `requireSession` (memorizada por petición con `cache`).
- Al subir una versión, todos (titulares, equipo y personal de plataforma) se detienen una vez; la invitación que alguien acepte en ese momento se pierde y hay que volver a abrir el enlace.
- Agregar un documento = una entrada en `LEGAL_DOCUMENTS` (la tabla no limita los nombres).
