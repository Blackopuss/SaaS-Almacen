# ADR 0029 — Acceso de soporte temporal y auditado

Fecha: 2026-10-26 · Estado: aceptada (canal y horario de soporte a definir por el fundador) · Paso: PIL-12

## Contexto

Para ayudar a un cliente del piloto («no me cuadra un saldo», «no encuentro la orden») el personal de plataforma necesita ver lo mismo que ve el cliente. Hasta ahora la consola interna (ADR 0009) solo administra planes y pagos: para mirar dentro de una empresa habría que pedir la contraseña del cliente (prohibido) o consultar la base a mano (sin registro). El plan pide un acceso temporal y registrado.

## Decisión

- **Lo abre el titular, nadie más.** En Configuración › Soporte, «Permitir acceso» abre una ventana de 24 horas (`SUPPORT_ACCESS_HOURS`); «Quitar acceso» la cierra en el momento. Permiso nuevo `platform.support.grant`, solo del titular (queda en `OWNER_ONLY_PERMISSIONS`; ningún rol lo concede). Pedirlo dos veces no alarga la ventana abierta.
- **Tabla `support_access`** (empresa, PLT-13, en `TENANT_MODELS`): quién la abrió, hasta cuándo, y quién y cuándo la cerró. Es un registro: no se borra (disparador), solo se cierra una vez, y su fin nunca cambia; `CHECK` de que dura más de cero y como mucho 7 días.
- **Solo personal de plataforma** (`platform_staff` activo, con MFA obligatoria) puede entrar, y solo mientras la ventana esté abierta. La consola lista las empresas con acceso abierto («Piden soporte») con «Entrar como soporte».
- **Entrar no crea membresía.** Se guarda la empresa como activa en la sesión del personal; `resolveActiveOrganization` la acepta sin membresía solo si hay ventana abierta, y en cada petición lo vuelve a comprobar: cerrar el acceso o llegar a su hora lo termina en el siguiente clic.
- **Solo lectura.** Sin membresía, `loadSubject` da a soporte el rol Consulta marcado `support`, y la política (`permissionsOf`) le deja solo los permisos que terminan en `.read`: no escribe, no exporta (no saca archivos con datos del cliente), no ve costos y no tiene poderes de titular. Todas las pantallas y servicios ya preguntan por permisos, así que no hubo que tocar ninguno.
- **Todo queda en la bitácora de la empresa**, que el titular ve: `support.granted`, `support.revoked`, `support.entered` y `support.left`, con el autor real.
- **Siempre visible.** Mientras soporte está dentro, la app muestra la franja «Modo soporte: solo lectura en … hasta …» con «Salir» (vuelve a la consola).

## Lo que no se hace

- Soporte no puede actuar a nombre del cliente («impersonar»): si algo hay que corregir, lo hace el cliente o se registra por los caminos normales (reversas, ajustes) con su autorización.
- No hay registro de cada pantalla que mira soporte, solo de la entrada y la salida (lo mismo que un miembro con Consulta). Si hiciera falta, se agrega después.
- El canal y el horario de soporte (correo, WhatsApp, horas) los define el fundador; el texto de Configuración no los menciona hasta entonces.

## Consecuencias

- Una persona de plataforma que también es miembro de la empresa la ve como miembro, no como soporte.
- Si el personal de plataforma pierde ese estado (`disabledAt`), pierde también cualquier acceso de soporte abierto.
- Pruebas: `tests/platform/support-access.int.test.ts` y el caso `support` de `policy.test.ts`.
