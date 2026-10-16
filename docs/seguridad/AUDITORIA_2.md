# Auditoría de seguridad 2 (skill `security-audit`)

Segunda corrida de la skill sobre el commit `4830ff8`, que ya incluía las correcciones de la auditoría 1 (`AUDITORIA_1.md`).

- **Perfil:** quick.
- **Revisión:** 14 revisores de solo lectura, uno por cada área del proyecto. Cada uno intentó saltarse las seis correcciones anteriores y buscó brechas nuevas.
- **Verificación:** verificadores independientes reprodujeron en local, contra `almacen_test`, cada hallazgo nuevo. Trabajaron sobre una copia fija del commit.
- **Cobertura:** una crítica final la dio por cerrada, sin áreas faltantes.
- **Codex:** revisó por su cuenta las seis correcciones de la auditoría 1 y confirmó que están en el código.
- **Reporte completo:** está fuera del repositorio, en `~/security-audit-skill/SaaS-Almacen/run-2/`.

**Resistieron sin fallas:**
- las seis correcciones de la auditoría 1;
- el aislamiento entre empresas;
- los permisos y los cupos;
- la consola interna;
- los archivos y las exportaciones;
- la cola de trabajos y el correo;
- el SQL;
- la interfaz y las redirecciones;
- los proveedores y las ubicaciones.

## Hallazgos y corrección

| Severidad | Hallazgo | Corrección | Prueba |
| --- | --- | --- | --- |
| Alta | **CSV cuadrático.** El lector de CSV hacía `cell.trim()` por cada comilla dentro de una celda sin comillas, y cada vez copiaba la celda entera. 160 KB tardaron 4.7 s y 10 MB serían horas. Es la misma falla que tenía XLSX, pero en el otro formato. | Se usa una bandera `filled` en lugar de `trim()`, y la celda deja de crecer al pasar el tope de `clean`. | `spreadsheet-reader.int.test.ts` («costs one pass on a long cell full of quotes») |
| Baja | **Correos de verificación sin límite.** `sendOnSignIn` mandaba un enlace en cada intento de inicio de sesión sobre una cuenta sin verificar, y el intento se devolvía: 25 intentos dieron 25 correos. Lo introdujo la corrección del límite de intentos de la auditoría 1. | `sendOnSignIn: false`. El reenvío pasa por `resendVerification` (con límite) y el intento ya no se devuelve por IP. | `auth.int.test.ts` |
| Baja | **MFA del extraño sobrevive a la recuperación.** Este es el residuo del robo anticipado de cuenta. El dueño del buzón confirmaba la cuenta de un extraño con solo abrir el enlace. Después, el extraño entraba con su contraseña, creaba una empresa y activaba su MFA. La recuperación no quitaba ese factor, así que el dueño quedaba fuera de su propio correo. | Confirmar el correo exige el enlace y la contraseña: `/confirmar-correo` guarda el token en ese navegador y `signIn` confirma solo si ahí se escribe la contraseña correcta, con un token de ese mismo correo. `GET /api/auth/verify-email` quedó cerrado. | `auth.int.test.ts` («a stranger's registration cannot be activated…»), `http-surface.int.test.ts`, `http.test.ts` |
| Solo desarrollo | **`/correos` con `dev:red`.** Con `npm run dev:red`, alguien en la misma red podía leer `/correos` mandando una cabecera `Host: localhost` falsa. Este caso no se reprodujo de forma independiente: se corrigió antes de comprobarlo. | `dev:red` arranca con `DEV_OUTBOX_DISABLED` y la página responde 404. | — |

## Sugerencias anotadas (no son vulnerabilidades)

Quedan para revisar antes del piloto, con su razón en el reporte completo:

- **Datos:**
  - Cambiar la unidad de un producto sin movimientos pero con presentaciones u órdenes abiertas.
  - Las presentaciones no bloquean el producto.
  - Las capturas de conteo no se revalidan contra la precisión del producto.
  - La comprobación del saldo inicial lee como máximo 500 líneas.
- **Cola y caché:**
  - Un envío de orden puede marcarse como fallido mientras todavía se manda (reclamo a los 30 min).
  - La caché de derechos es por proceso: un cambio tarda hasta su vencimiento en llegar a los demás procesos.
- **Cuentas y equipo:**
  - El personal de plataforma podría activar su MFA en la misma sesión en la que entra solo con contraseña.
  - Al aceptar una invitación no se vuelve a revisar el límite de personas.
  - Al invitar, el permiso de quien invita se lee antes de tomar el candado.
- **Better Auth:**
  - Guarda los tokens de restablecimiento sin hash (`verification.storeIdentifier`).
  - Activar la MFA no cierra las otras sesiones.
- **Límites de intentos:**
  - Los límites por correo pueden usarse para bloquear el reenvío o la recuperación de una persona durante 15 min a 1 h.
  - `x-real-ip` sirve como respaldo cuando no llega `X-Forwarded-For`.
- **Archivos y exportaciones:**
  - Los motivos de devolución a proveedor aparecen en el historial de movimientos.
  - La cantidad de `<si>` en XLSX solo está acotada por los 80 MB.
  - La búsqueda de la consola interna no escapa `%` ni `_`.
- **Pendientes ya aceptados:** la CSP de scripts con nonce (PLT16-04) y que los límites por IP dependen del proxy.
