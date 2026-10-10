# Matriz OWASP ASVS — iniciada en PLT-16

Objetivo: ASVS 5.0, nivel 2, como guía verificable (no es una certificación). Esta matriz se organiza por capítulo de ASVS 5.0 y nombra cada requisito por su tema; los identificadores exactos se agregan al revisarla contra el texto oficial antes del piloto.

Estados: **Cumple** (con evidencia), **Parcial**, **Pendiente** (con paso del plan), **N/A**.

| Capítulo ASVS 5.0 | Tema | Estado | Evidencia o paso |
| --- | --- | --- | --- |
| V1 Codificación y sanitización | Salida escapada en HTML | Cumple | React escapa por defecto; sin `dangerouslySetInnerHTML` con datos de usuario. |
| V1 | Consultas parametrizadas | Cumple | Prisma; SQL directo solo en `throttle.ts` y `lockRows` (tabla de una lista fija, valores como parámetros); prohibido en el cliente de empresa (`tenant-db.ts`). Comodines de `LIKE` escapados en búsquedas (INV-11, INV-27). |
| V2 Validación y lógica de negocio | Validación en servidor con mensajes claros | Cumple | Zod en servicios (`register.ts`, `recovery.ts`, `organizations.ts`). |
| V2 | Límites anti-automatización | Cumple | `throttle.ts` (cuenta e IP); desafío MFA limitado; pruebas en `throttle.int.test.ts`. |
| V2 | Concurrencia en operaciones críticas | Cumple | Alta de empresa, cupos y equipo con bloqueo de fila; inventario con candado por producto en orden fijo, lectura tras el candado (READ COMMITTED), resta condicionada y `CHECK` (`REVISION_INV.md`). |
| V2 | Operaciones que no se duplican al reintentar | Cumple | Clave de confirmación única por empresa en cada movimiento; conteos aplicados una sola vez (`idempotency.int.test.ts`, `count-apply.int.test.ts`). |
| V2 | Integridad de datos de negocio | Cumple | Saldos derivados de movimientos inmutables; cantidades con decimal exacto y regla por producto; reconciliación `npm run stock:reconcile` (sin programar todavía: INV-S03). |
| V3 Seguridad del frontend web | Cabeceras (framing, nosniff, referrer, HSTS) | Cumple | `next.config.ts`; `verify:ui`. |
| V3 | CSP de scripts con nonce | Pendiente | PLT16-04, antes del piloto. |
| V3 | Cookies seguras | Cumple | ADR 0003 «Sesiones, cookies y CSRF». |
| V3 | CSRF / origen | Cumple | Revisión de origen de Better Auth forzada en todos los entornos; Server Actions con revisión de origen de Next. |
| V4 API y servicios web | Superficie HTTP mínima | Cumple | Lista de permitidos `/api/auth` (`http.ts`, `http-surface.int.test.ts`). |
| V5 Manejo de archivos | Importación y descargas | Parcial | Archivos privados por empresa fuera de la raíz web, tipo y tamaño decididos por el servidor, descarga por enlace firmado de 5 min ligado a sesión y empresa (ADR 0014, `files.int.test.ts`). Lectura como texto sin evaluar fórmulas ni abrir macros, XML con entidades rechazado y tamaños acotados al desempacar (`spreadsheet-reader.int.test.ts`); lo que se escribe neutraliza fórmulas (`buildCsv`/`buildXlsx`). Exportaciones (IMP-11): permiso de exportar más el de lectura de lo exportado, solo filas de la empresa, celdas neutralizadas, descarga `attachment` + `nosniff` + `no-store`, tope de 50,000 filas y registro en bitácora (`exports.int.test.ts`). Falta: límite de frecuencia de exportaciones y exclusión de columnas de costo por permiso (CMP-16). Revisión de la etapa en `REVISION_IMP.md`. Falta además: conservación y borrado de archivos subidos (IMP-S06). |
| V6 Autenticación | Política de contraseñas (12–128, sin reglas de composición, pegar permitido) | Cumple | `register.ts`, `password.ts`. |
| V6 | Almacenamiento de contraseñas | Cumple | scrypt con parámetros OWASP (`password.ts`, ADR 0003). |
| V6 | Sin enumeración de cuentas (mensajes y tiempos) | Cumple | Respuestas neutrales; hash simulado; correos después de responder (PLT16-03). |
| V6 | Recuperación segura | Cumple | Token de un solo uso con vencimiento; cierra sesiones; no quita MFA (`recovery.int.test.ts`). |
| V6 | MFA (TOTP), un solo uso, recuperación | Cumple | `mfa*.int.test.ts`; obligatoria para titulares. |
| V6 | MFA obligatoria para administradores y personal de plataforma | Parcial | Titulares y administradores: `isMfaRequired` + `roles.int.test.ts`; personal de plataforma en MOD-09. |
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
| V12 Comunicación segura | TLS | Pendiente | BAS-09 (HTTPS + HSTS ya configurado para producción). |
| V13 Configuración | Secretos fuera del repositorio; usuarios de base con mínimo privilegio | Cumple | `.env.local` ignorado; `almacen_app` sin DDL. |
| V13 | Páginas de desarrollo cerradas en producción | Cumple | `/correos`, `/sistema-visual` (PLT16-06). |
| V14 Protección de datos | Sin secretos en registros, correos ni bitácora | Cumple | `sanitizeMetadata`; tokens nunca enviados al navegador. |
| V14 | Respaldos cifrados | Pendiente | BAS-11. |
| V15 Codificación segura y arquitectura | Dependencias con versión exacta y auditoría | Cumple | `.npmrc save-exact`; `npm audit --omit=dev` en CI. |
| V16 Registro de seguridad y errores | Bitácora inmutable de cambios sensibles | Cumple | ADR 0006; `audit.int.test.ts`. |
| V16 | Errores sin detalles internos al usuario | Cumple | Mensajes genéricos; detalles solo en el log del servidor. |
| V16 | Monitoreo y alertas | Pendiente | BAS-11. |
| V17 WebRTC | — | N/A | No se usa. |
