# Revisión de amenazas — etapa MOD (MOD-01 a MOD-11)

Fecha: 2026-10-04. Complementa `REVISION_PLT.md` y `REVISION_USR.md`. Hecha por la misma IA que implementó la etapa; falta una revisión independiente (Codex) antes del piloto.

## Qué se agregó

- Contrato y registro de módulos (ADR 0007).
- Modelo comercial con precios versionados e inmutables (ADR 0008).
- Derechos efectivos por empresa con caché corta; guard de servidor rol → módulo → límite.
- Activar y desactivar módulos con dependencias; contador de cupo de productos; cupo de usuarios.
- Personal de plataforma y consola interna `/interno` (ADR 0009).
- Pantalla «Mi plan»; estados de suscripción (vencido → solo lectura y exportación).

## Amenazas consideradas y control

| Amenaza | Control | Prueba |
| --- | --- | --- |
| Usar un módulo no contratado llamando la acción directamente | `assertModulePermission` / `requireModulePermission`: rol y después módulo | `module-guard.int.test.ts` |
| Un cliente se concede módulos, cupos o vigencia | No hay acción de cliente que escriba derechos; solo `provisionCompany` (personal) y el sembrado de desarrollo | `provisioning.int.test.ts`, `negative-by-role.int.test.ts` |
| Titular o administrador usa la consola interna | `requirePlatformStaff` (sesión + MFA activa + fila en `platform_staff`) en layout, páginas y acción; el servicio lo comprueba otra vez; 404 para los demás | `provisioning.int.test.ts`, `verify:ui` |
| Alguien se nombra personal de plataforma | No existe pantalla ni acción; solo `npm run staff` con acceso a la base | Revisión de código |
| Rebasar el cupo con solicitudes simultáneas | Un `UPDATE` condicional por lugar (productos); conteo bajo bloqueo de la empresa (usuarios) | `quota.int.test.ts`, `seats.int.test.ts` |
| Dejar un módulo sin su dependencia | Registro valida al arrancar; activar/quitar bajo bloqueo de la empresa | `registry.int.test.ts`, `module-activation.int.test.ts` |
| Cambiar precios o cupos de quien ya contrató | Versiones de plan inmutables por disparadores | `commercial-schema.int.test.ts` |
| Seguir operando con el plan vencido | La vigencia se evalúa en cada lectura, aun con caché; vencido = solo lectura y exportación | `entitlements.int.test.ts`, `subscription-states.int.test.ts` |
| Perder datos al vencer o bajar de plan | Nada se borra: los derechos se cierran, los cupos solo bloquean altas | `subscription-states.int.test.ts`, `quota.int.test.ts`, `seats.int.test.ts` |
| Ver el plan o los derechos de otra empresa | Tablas de empresa con `forOrganization` y llaves compuestas | `two-companies.int.test.ts`, pruebas de cada servicio |
| Borrar el rastro de un cambio de plan | `plan.provisioned`, `module.activated/deactivated` en la bitácora solo-agregar de la empresa | `provisioning.int.test.ts`, `module-activation.int.test.ts` |

## Hallazgos

| ID | Severidad | Hallazgo | Estado |
| --- | --- | --- | --- |
| MOD-S01 | Media | Leer el límite por otra conexión dentro de una transacción que tiene bloqueada la empresa agotaba las conexiones (seis invitaciones simultáneas se quedaban esperando hasta el tiempo límite). Un atacante autenticado podía provocar lentitud en su propia empresa. | **Corregido en MOD-08:** `readLimit` usa la misma transacción; regla en `AGENTS.md`. |
| MOD-S02 | Media | Una cuenta del personal de plataforma comprometida puede cambiar derechos de cualquier empresa (no leer ni cambiar sus datos de negocio). | Mitigado: MFA obligatoria y activa, alta solo por línea de comandos, bitácora en cada empresa. Pendiente: avisar por correo al titular cuando cambie su plan y registro propio de accesos del personal. |
| MOD-S03 | Baja | La caché de derechos vive en cada proceso: con varios procesos de servidor, un cambio de plan tarda hasta 15 s en verse en los demás. Los vencimientos no se retrasan. | Aceptado. Anotado para el despliegue (BAS-09). |
| MOD-S04 | Baja | El módulo de un permiso se deduce de su prefijo; un permiso mal nombrado quedaría sin módulo. | Mitigado: el contrato rechaza permisos sin el prefijo del módulo y una prueba exige que cada permiso de negocio tenga dueño. |
| MOD-S05 | Baja | El personal ve nombre de la empresa y nombre y correo del titular de todas las empresas. | Aceptado: mínimo necesario para identificar a quién se le asigna el plan. Mencionarlo en el aviso de privacidad (PIL). |
| MOD-S06 | Informativa | Una empresa nueva no tiene módulos ni cupos hasta que el personal le asigna plan. | Decisión del fundador pendiente: prueba automática al registrarse o alta asistida. |
| MOD-S07 | Informativa | En solo lectura siguen disponibles equipo, bitácora y plan; no se pueden sumar personas porque el cupo de usuarios también venció. | Correcto por diseño. |

## Siguiente revisión

Al cerrar la etapa INV (primeras tablas de negocio: productos, existencias y movimientos).
