# Revisión de seguridad de la versión candidata (PIL-05) y regresión (PIL-05B)

Fecha: 2026-10-26. Versión revisada: rama `pruebas` con el rediseño KISS,
PIL-07 y lo publicado en producción (`https://18-224-247-13.sslip.io`).

Alcance: lo que cambió desde las revisiones por etapa (`REVISION_*.md`) y las
auditorías 1–3, en especial la **compra en línea** (ADR 0028), que no tenía
revisión propia, y el rediseño de pantallas. Criterio de «Listo cuando»:
matriz ASVS actualizada y sin hallazgos críticos ni altos abiertos.

## Resultado

**Sin hallazgos críticos ni altos abiertos.** Un hallazgo medio, corregido en
esta misma revisión; los demás pendientes son medios o bajos ya conocidos y
anotados con su paso.

## Compra en línea (ADR 0028)

Revisado `src/platform/billing/checkout/*` y `src/app/api/pagos/[proveedor]/webhook`.

| Control | Estado |
| --- | --- |
| El plan se aplica solo con el importe y la moneda exactos | Cumple. `confirmOrder` pregunta al proveedor (nunca confía en el cuerpo del aviso ni en el regreso del navegador) y compara con decimal exacto; si no coincide, lo deja en el registro para revisión y no aplica nada. |
| Firma de los avisos | Cumple. Stripe: HMAC-SHA256 con tolerancia de 5 min y comparación en tiempo constante de todas las firmas. Mercado Pago: HMAC del manifiesto `id;request-id;ts` con antigüedad máxima. PayPal: verificación por su API con el cuerpo tal como llegó. |
| Un aviso repetido no aplica dos veces | Cumple. `payment_event` único por proveedor + id de evento; la empresa se bloquea y `applyPurchase` es idempotente. |
| Precios y totales | Cumple. Solo del servidor (`prices.ts`); el navegador manda plan y meses, no importes. |
| Solo el titular compra; límites contra pruebas de tarjetas | Cumple. `assertOwnerAction` y `reserveAttempt` por persona, empresa e IP antes de abrir un pago o probar un código. |
| Redirección al proveedor | Cumple. Solo a hosts de una lista fija por proveedor (`CHECKOUT_HOSTS`, también en la CSP). |
| Órdenes inmutables | Cumple. Disparadores impiden editar o borrar `checkout_order` pagada. |
| Tamaño del aviso | Cumple. Caddy limita el cuerpo a 12 MB y la ruta rechaza más de 256 KB. |

### Hallazgo PIL-S01 (Medio) — corregido

**Avisos falsos sin límite.** La dirección del webhook es pública (debe
serlo). Cada aviso falso de PayPal con sus cabeceras provocaba una llamada a
la API de PayPal con nuestras credenciales, sin tope: alguien podía gastar el
límite de la cuenta o llenar el registro.

**Corrección:** los avisos cuya firma no se verifica cuentan por IP (30 por
hora; después, 429 sin llegar a verificar). Un proveedor real nunca falla la
firma, así que nunca cuenta. Prueba: `checkout.int.test.ts` («forged
deliveries from one IP are cut off»).

## Rediseño de pantallas (KISS) y PIL-07

Sin cambios en servicios, permisos ni rutas. Revisado lo que se tocó:

- Los enlaces nuevos («Nueva orden» desde un proveedor, volver al producto)
  usan ids leídos de la base; la página de destino vuelve a comprobar
  empresa, permiso y que el proveedor sea de la empresa.
- La acción de columnas de importación ahora redirige: el id pasa por
  `idPath` antes de ir a la dirección.
- `global-error.tsx` y `error.tsx` solo muestran el código de error
  (`digest`), nunca el mensaje interno.
- El filtro de proveedor preseleccionado en «Nueva orden» sale de la lista de
  la empresa (con uno solo), no de la dirección.

## Producción

- Cabeceras verificadas en el sitio: HSTS (`max-age=63072000;
  includeSubDomains`), CSP con nonce y `strict-dynamic`, `X-Frame-Options:
  DENY`, `nosniff`, `Referrer-Policy` y `Permissions-Policy`.
- `npm audit`: 0 vulnerabilidades (producción y desarrollo).

## Pendientes conocidos (ninguno crítico ni alto)

| Id | Gravedad | Qué | Cuándo |
| --- | --- | --- | --- |
| USR-S01 | Media | Transferir la titularidad no pide otra vez la contraseña. | No hay pantalla que la inicie; pedirla al construirla. |
| V11 | Media | Plan de rotación de `BETTER_AUTH_SECRET` (cifra MFA). | Antes de crecer; hoy el secreto vive solo en el servidor. |
| IMP-S06 | Baja | Conservación y borrado de archivos subidos. | Con la política de privacidad (PIL-08, del fundador). |
| V5 | Baja | Límite de frecuencia de exportaciones. | Antes del lanzamiento limitado. |
| Correo | Baja | SPF, DKIM y DMARC del remitente. | Al pasar de Gmail a dominio propio. |
| AUD-3 | Informativa | Separar la cuenta de personal de plataforma de la cuenta de negocio del fundador; revisar protecciones de rama del despliegue manual. | Del fundador, en GitHub y la consola. |

## Regresión integral (PIL-05B)

| Qué | Cómo | Resultado |
| --- | --- | --- |
| Permisos por rol y casos negativos | `negative-by-role`, `navigation`, `policy`, `catalog` | Pasa |
| Aislamiento entre empresas | `tests/isolation` (dos empresas, Server Actions) | Pasa |
| Trabajos en segundo plano | `jobs`, `import-*`, `exit-import`, `order-delivery` | Pasa |
| Cupos y derechos | `quota`, `seats`, `provisioning`, `subscription-states`, `module-guard` | Pasa |
| Recorridos de extremo a extremo | `phase1-cases` (inventario), `purchase-flow` (compras), `checkout` | Pasa |
| Toda la suite | `npm run check` (tipos, lint, límites, formato, 1615 pruebas) y `npm run build` | Pasa |
| Interfaz | `verify:ui` (93) y `verify:a11y` (157) con Chromium | Pasa. `verify:ui` tenía tres expectativas viejas que se corrigieron en el script: `/` ya es el sitio público (ADR 0022), la app abre en `/inicio` (INV-35) y la pantalla de MFA obligatoria se queda, sin pedir nada, cuando la MFA ya está activa (para no ocultar los códigos recién generados). |
