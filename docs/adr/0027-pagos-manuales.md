# ADR 0027 — Pagos manuales y vigencia en la consola

Fecha: 2026-10-25 · Estado: aceptada (puntos a confirmar por el fundador) · Paso: PIL-11

## Contexto

En el piloto el cobro es asistido (ADR 0009): el cliente paga por transferencia SPEI y el personal de plataforma le asigna el plan. Hasta ahora el pago solo quedaba como texto en el motivo de «Asignar plan», y alargar la vigencia significaba volver a capturar todo el plan. El plan pide: pago SPEI → vigencia → derechos, con auditoría. La parte fiscal (CFDI, PIL-10) todavía no está decidida.

## Decisión

- **Tabla `manual_payment`** (empresa, PLT-13, en `TENANT_MODELS`): importe `DECIMAL(12,2)` en MXN, día del pago (`DATE`), clave de rastreo SPEI (mayúsculas, sin espacios), meses que paga (1–12), notas, quién lo registró y la vigencia antes y después. **Inmutable** (disparadores); `CHECK` de importe positivo, meses, moneda y forma de cada tipo.
- **Correcciones por anulación:** un error se corrige con una fila `REVERSAL` que apunta a su pago (una por pago, índice único) y quita los mismos meses; luego se registra el pago bien. Si desde ese pago nada más movió el plan, la anulación devuelve la vigencia exactamente a donde estaba; si no, quita los meses del fin actual. Nunca la lleva antes de hoy ni mueve un plan ya vencido.
- **La vigencia es la del plan asignado** (MOD-09), no una tabla nueva: el fin del límite `active_products` (que «Asignar plan» siempre escribe). Registrar un pago mueve **todos los derechos que terminan en ese mismo momento** (límites y módulos del plan); un módulo quitado antes termina en otro momento y no revive. Sin plan, o con un plan sin fecha de término, el pago se rechaza: primero se asigna una vigencia.
- **Desde cuándo cuenta:** desde el fin actual del plan, o desde hoy si ya venció (no se cobran los días sin plan). Meses de calendario; el día que no existe se ajusta al último del mes (31 ene + 1 = 28/29 feb). Termina al final del día, hora del centro de México (igual que «Asignar plan»). Funciones puras en `src/platform/billing/validity.ts`.
- **Derechos y solo lectura:** como los derechos vuelven a estar vigentes, la empresa sale de solo lectura (MOD-11) en cuanto se confirma; `invalidateEntitlements` después de confirmar.
- **Una transacción** (`LOCKING_TRANSACTION`, empresa bloqueada con `FOR UPDATE`): fin del plan, clave repetida, fila del pago, derechos y bitácora (`payment.recorded` / `payment.reversed`, con el personal como autor). El cliente lo ve en su bitácora.
- **Clave repetida:** una clave de rastreo no se repite entre los pagos no anulados de una empresa. Se comprueba bajo el candado de la empresa, así que dos envíos iguales a la vez registran uno; es también la protección ante reintentos. No hay índice único en la base porque una clave de un pago anulado sí puede volver a usarse (para registrarlo bien).
- **Quién:** solo personal de plataforma (`requirePlatformStaff()` en la acción y `isPlatformStaff` otra vez en el servicio). Una empresa con fila en `subscription` (cobro automático futuro) no acepta pagos manuales.
- **Consola:** la ficha de la empresa (`/interno/empresas/[id]`) muestra la vigencia (o «Venció el …, solo lectura»), el formulario «Registrar pago» y el historial con «Anular pago».

## Lo que no se hace

- **CFDI (PIL-10):** no se emite ni se guarda nada fiscal. Las notas sirven mientras tanto; cuando el fundador decida, los datos fiscales irán en columnas o una tabla nuevas (migración de expansión) ligadas a `manual_payment`.
- No se valida la clave de rastreo contra Banxico (CEP) ni se concilia contra el estado de cuenta: el personal la copia del comprobante.
- No se calcula el importe esperado: los precios no están validados (FUN-06). El importe se guarda tal cual.

## Consecuencias

- «Asignar plan» sigue siendo la forma de cambiar cupos, módulos o vigencia sin pago (cortesías, ajustes). Si se reasigna el plan con otra fecha, los pagos siguientes alargan esa fecha nueva.
- El historial muestra los 100 pagos más recientes por empresa, sin páginas (unos 12 al año).

## Por confirmar con el fundador

- ¿Máximo de 12 meses por pago es suficiente (pagos anuales)?
- ¿Los pagos de días sueltos o prorrateos existen, o siempre son meses completos?
- ¿Se avisa por correo al titular cuando se registra su pago?
- Datos fiscales que necesitará PIL-10 (RFC del cliente, uso de CFDI, folio fiscal).
