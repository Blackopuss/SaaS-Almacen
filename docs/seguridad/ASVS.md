# Matriz OWASP ASVS — iniciada en PLT-16, revisada en PIL-05 (2026-10-26)

Objetivo: ASVS 5.0, nivel 2, como guía verificable (no es una certificación). Esta matriz se organiza por capítulo de ASVS 5.0 y nombra cada requisito por su tema; los identificadores exactos se agregan al revisarla contra el texto oficial antes del piloto.

Estados: **Cumple** (con evidencia), **Parcial**, **Pendiente** (con paso del plan), **N/A**.

| Capítulo ASVS 5.0 | Tema | Estado | Evidencia o paso |
| --- | --- | --- | --- |
| V1 Codificación y sanitización | Salida escapada en HTML | Cumple | React escapa por defecto; sin `dangerouslySetInnerHTML` con datos de usuario. |
| V1 | Consultas parametrizadas | Cumple | Prisma; SQL directo solo en `throttle.ts` y `lockRows` (tabla de una lista fija, valores como parámetros); prohibido en el cliente de empresa (`tenant-db.ts`). Comodines de `LIKE` escapados en búsquedas (INV-11, INV-27). |
| V2 Validación y lógica de negocio | Validación en servidor con mensajes claros | Cumple | Zod en servicios (`register.ts`, `recovery.ts`, `organizations.ts`). Fechas de reportes de Compras validadas antes de calcular con ellas (CMP-S10, `reports.int.test.ts`). |
| V2 | Límites anti-automatización | Cumple | `throttle.ts` (cuenta e IP); avisos de pago con firma inválida limitados por IP (PIL-S01); el intento se aparta antes de verificar (`reserveAttempt`), así que las peticiones simultáneas no pasan del tope; IP tomada desde el final de `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`); desafío MFA limitado; pruebas en `throttle.int.test.ts` (ráfaga de 20). Auditoría 1 (`AUDITORIA_1.md`). |
| V2 | Concurrencia en operaciones críticas | Cumple | Alta de empresa, cupos y equipo con bloqueo de fila; inventario con candado por producto en orden fijo, lectura tras el candado (READ COMMITTED), resta condicionada y `CHECK` (`REVISION_INV.md`); recepciones y devoluciones con candados productos → ubicaciones → orden y límites acumulados repetidos por disparadores (`REVISION_CMP.md`). |
| V2 | Operaciones que no se duplican al reintentar | Cumple | Clave de confirmación única por empresa en cada movimiento, recepción y devolución, comparada con lo pedido; conteos aplicados una sola vez; sugerencias que cuentan lo ya pedido (`idempotency.int.test.ts`, `count-apply.int.test.ts`, `receipts.int.test.ts`, `returns.int.test.ts`, `suggestions.int.test.ts`). |
| V2 | Integridad de datos de negocio | Cumple | Saldos derivados de movimientos inmutables; cantidades con decimal exacto y regla por producto; reconciliación `npm run stock:reconcile` (sin programar todavía: INV-S03). |
| V3 Seguridad del frontend web | Cabeceras (framing, nosniff, referrer, HSTS) | Cumple | `next.config.ts`; `verify:ui`. |
| V3 | CSP de scripts con nonce | Cumple | PLT16-04: `src/proxy.ts` (nonce por petición, `strict-dynamic`, sin `unsafe-inline`/`unsafe-eval` en producción); `src/lib/csp.test.ts`. |
| V3 | Cookies seguras | Cumple | ADR 0003 «Sesiones, cookies y CSRF». |
| V3 | CSRF / origen | Cumple | Revisión de origen de Better Auth forzada en todos los entornos; Server Actions con revisión de origen de Next. |
| V4 API y servicios web | Superficie HTTP mínima | Cumple | Lista de permitidos `/api/auth` (`http.ts`, `http-surface.int.test.ts`). |
| V5 Manejo de archivos | Importación y descargas | Parcial | Archivos privados por empresa fuera de la raíz web, tipo y tamaño decididos por el servidor, descarga por enlace firmado de 5 min ligado a sesión y empresa (ADR 0014, `files.int.test.ts`). Lectura como texto sin evaluar fórmulas ni abrir macros, XML con entidades rechazado y tamaños acotados al desempacar, análisis en una sola pasada con búsquedas simples y conteo de filas y celdas escritas (auditoría 1: un .xlsx de 784 B bloqueaba el servidor 2 s; `spreadsheet-reader.int.test.ts`); lo que se escribe neutraliza fórmulas (`buildCsv`/`buildXlsx`). Exportaciones (IMP-11): permiso de exportar más el de lectura de lo exportado, solo filas de la empresa, celdas neutralizadas, descarga `attachment` + `nosniff` + `no-store`, tope de 50,000 filas y registro en bitácora (`exports.int.test.ts`). Columnas de costo omitidas según `purchasing.cost.read` en reportes y archivos de Compras (CMP-15/16, `reports.int.test.ts`, `tests/purchasing/module-guard.int.test.ts`). Falta: límite de frecuencia de exportaciones. Revisión de la etapa en `REVISION_IMP.md`. Falta además: conservación y borrado de archivos subidos (IMP-S06). |
| V6 Autenticación | Política de contraseñas (12–128, sin reglas de composición, pegar permitido) | Cumple | `register.ts`, `password.ts`. |
| V6 | Almacenamiento de contraseñas | Cumple | scrypt con parámetros OWASP (`password.ts`, ADR 0003). |
| V6 | Sin enumeración de cuentas (mensajes y tiempos) | Cumple | Respuestas neutrales; hash simulado; correos después de responder (PLT16-03). |
| V6 | Recuperación segura | Cumple | Token de un solo uso con vencimiento; cierra sesiones; no quita MFA (`recovery.int.test.ts`). |
| V6 | MFA (TOTP), un solo uso, recuperación | Cumple | `mfa*.int.test.ts`; obligatoria para titulares. |
| V6 | MFA obligatoria para administradores y personal de plataforma | Cumple | `isMfaRequired` incluye titulares, administradores y personal de plataforma activo (`mfa-policy.ts`, `roles.int.test.ts`, MOD-09). |
| V6 | Avisos de cambios de seguridad | Cumple | Correos de contraseña, MFA y códigos de recuperación. |
| V7 Gestión de sesiones | Sesión en servidor, revocación inmediata | Cumple | `cookieCache` apagado; `sessions.int.test.ts`. |
| V7 | Nueva sesión al autenticarse y al elevar (MFA) | Cumple | Better Auth + rotación al activar/desactivar MFA. |
| V7 | Ver y cerrar sesiones propias | Cumple | Configuración → Seguridad. |
| V7 | Cierre de sesiones al cambiar contraseña | Cumple | `revokeSessionsOnPasswordReset`. |
| V8 Autorización | Denegar por defecto y aislamiento entre empresas | Cumple | `requireOrganizationContext`, `forOrganization`, llaves compuestas, `tests/isolation`. |
| V8 | Permisos por rol | Cumple | Decisión central `can` (denegar por defecto), guardas `requirePermission`/`assertOwnerAction`, reglas de equipo y pantallas que comprueban en servidor (USR-02 a USR-10); `policy.test.ts`, `negative-by-role.int.test.ts`, `navigation.int.test.ts`. Revisión en `REVISION_USR.md`. |
| V8 | Trabajos en segundo plano con la autoridad de quien los pidió | Cumple | El worker actúa en la empresa de la fila del trabajo y vuelve a comprobar los permisos de quien confirmó antes de cada lote (`import-release.int.test.ts`, `exit-import.int.test.ts`); importar exige cada permiso de lo que el archivo hace (`importPermissions`). |
| V8 | Reautenticación en operaciones críticas (transferir titularidad) | Pendiente | Hallazgo USR-S01. |
| V8 | Derechos contratados y límites en servidor | Cumple | Guard rol → módulo → límite (`assertModulePermission`, `assertWithinLimit`), cupos con control de concurrencia y consola interna solo para personal con MFA (MOD-05 a MOD-09); `module-guard`, `quota`, `seats`, `provisioning` y `subscription-states` (`*.int.test.ts`). Revisión en `REVISION_MOD.md`. |
| V9 Tokens autocontenidos | — | N/A | No se usan JWT de sesión. |
| V10 OAuth/OIDC | — | N/A | Sin inicio de sesión con terceros. |
| V11 Criptografía | Secretos MFA cifrados; aleatoriedad segura | Cumple | Cifrado de Better Auth con `BETTER_AUTH_SECRET`; `crypto.randomInt` para códigos de recuperación. |
| V11 | Rotación del secreto | Pendiente | Plan de rotación antes de producción (ADR 0003, requisito 3). |
| V12 Comunicación segura | TLS | Cumple | Producción detrás de Caddy con HTTPS automático; HSTS `max-age=63072000; includeSubDomains` verificado en el sitio (PIL-05, `REVISION_PIL.md`). |
| V13 Configuración | Secretos fuera del repositorio; usuarios de base con mínimo privilegio | Cumple | `.env.local` ignorado; `almacen_app` sin DDL. |
| V13 | Páginas de desarrollo cerradas en producción | Cumple | `/correos`, `/sistema-visual` (PLT16-06). |
| V5 | Correo saliente sin inyección de cabeceras | Cumple | `sendEmail` rechaza destinatario, «responder a» y asunto con saltos de línea o más de un destinatario, y adjuntos con nombre o tipo fuera de lo permitido; el destinatario de una orden sale de la ficha del proveedor, con límites diarios (CMP-06B, ADR 0020). Pendiente al elegir proveedor de correo: SPF, DKIM y DMARC. |
| V14 Protección de datos | Sin secretos en registros, correos ni bitácora | Cumple | `sanitizeMetadata`; tokens nunca enviados al navegador. |
| V14 | Consentimiento del aviso de privacidad y de los términos | Cumple | PIL-09 (ADR 0026): casilla obligatoria al crear cuenta (registro e invitación); versión, fecha, persona, IP y navegador en `legal_acceptance` (solo agregar, disparadores); una versión nueva detiene a cada persona en `/acepta-terminos` desde `requireSession` (`legal-acceptance.int.test.ts`). Los textos siguen en revisión profesional (PIL-08). |
| V14 | Respaldos cifrados | Cumple | `deploy/bin/respaldo`: restauración de prueba antes de guardar y cifrado con `age`; configuración solo-root en `/etc/almacen` (ADR 0024, auditoría 3). Respaldo continuo y simulacro medido: PIL-02/03. |
| V15 Codificación segura y arquitectura | Dependencias con versión exacta y auditoría | Cumple | `.npmrc save-exact`; `npm audit --omit=dev` en CI. |
| V16 Registro de seguridad y errores | Bitácora inmutable de cambios sensibles | Cumple | ADR 0006; `audit.int.test.ts`. |
| V16 | Errores sin detalles internos al usuario | Cumple | Mensajes genéricos; detalles solo en el log del servidor. |
| V16 | Monitoreo y alertas | Cumple | `/api/salud` y alertas por correo de cambios de estado (PIL-04, ADR 0025). |
| V17 WebRTC | — | N/A | No se usa. |
| V2 | Pagos en línea | Cumple | Plan aplicado solo tras confirmar con el proveedor importe y moneda exactos; avisos firmados e idempotentes; precios solo del servidor (ADR 0028, `REVISION_PIL.md`, `checkout.int.test.ts`, pruebas de cada proveedor). |
| V8 | Ventas: precios, descuentos, caja y cancelaciones en servidor | Cumple | Precios e IVA calculados al confirmar; topes de descuento por rol con autorización por contraseña; caja propia bloqueada; cancelar con permiso y motivo; enlace de ticket con HMAC (VEN, COT; `REVISION_VEN.md`). Falta revisión independiente. |
