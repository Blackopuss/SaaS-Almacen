# ADR 0008 — Modelo comercial con precios versionados

Fecha: 2026-10-04 · Estado: aceptada · Paso: MOD-03

## Contexto

El precio depende del nivel de capacidad (productos activos), de los módulos contratados y de los usuarios adicionales. Los precios son todavía hipótesis (FUN-06) y van a cambiar; cambiar el catálogo comercial no debe alterar lo que un cliente ya contrató.

## Decisión

Tablas (migración `commercial_model`):

| Tabla | Alcance | Qué guarda |
| --- | --- | --- |
| `plan_version` | Global | Condiciones de un nivel (`tier`) en una versión: cupo de productos, usuarios incluidos, moneda y precio del usuario adicional. Única por `(tier, version)`. |
| `plan_module_price` | Global | Precio mensual de cada módulo en esa versión. |
| `plan_offer` | Global | Qué versión de cada nivel se ofrece hoy a clientes nuevos (un puntero que sí cambia). |
| `subscription` | Empresa (una por empresa) | Versión contratada, estado, periodo y usuarios adicionales. |
| `subscription_item` | Empresa | Módulo contratado con el precio acordado al agregarlo y su vigencia. |
| `entitlement` | Empresa | Derechos efectivos: módulo (`MODULE`) o límite con valor (`LIMIT`), con vigencia. Única por `(empresa, tipo, clave)`. |

- **Versiones inmutables.** `plan_version` y `plan_module_price` no se pueden modificar ni borrar (disparadores de MySQL, igual que la bitácora): un precio o cupo nuevo es otra versión, y publicar es mover `plan_offer`. Las suscripciones existentes conservan su versión.
- **Dinero exacto:** `DECIMAL(12,2)`; en código, `Decimal` de `@/lib`. Precios antes de impuestos.
- **Estados de suscripción:** `TRIAL`, `ACTIVE`, `PAST_DUE`, `GRACE`, `SUSPENDED`, `CANCELLED`. Su efecto se define en MOD-11.
- **Los derechos son la única fuente para autorizar** módulos y límites (MOD-04/05). Los escribe el servidor desde la suscripción o el personal de plataforma (MOD-09); nunca el cliente. Pueden existir sin suscripción (cobro asistido del piloto).
- **Restricciones en la base** (`CHECK`): cupos y usuarios ≥ 1, precios ≥ 0, periodo válido, un módulo no lleva valor y un límite sí, vigencia que no termina antes de empezar.
- Las tablas de empresa siguen el patrón de llaves compuestas (PLT-13) y están en `TENANT_MODELS`.
- Los ids de módulo se guardan como texto y se validan contra el registro (`src/modules/registry`) en los servicios; no hay `CHECK` por módulo para no exigir una migración por cada módulo nuevo.

## Consecuencias

- No hay datos de planes sembrados: los niveles y precios se cargan cuando el fundador los valide (FUN-06) desde la consola interna (MOD-09).
- Corregir un error de captura en una versión publicada exige una versión nueva.
- Requisito de producción ya conocido (ADR 0006): crear disparadores con binlog activo necesita `log_bin_trust_function_creators=1`.
