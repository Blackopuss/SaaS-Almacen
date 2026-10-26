# ADR 0028 — Compra del plan en línea (Stripe, PayPal, Mercado Pago y códigos)

Fecha: 2026-10-25 · Estado: aceptada (puntos a confirmar por el fundador) · Pasos: adelanta BIL-03, BIL-05, BIL-06A/B (sin suscripción recurrente)

## Contexto

El fundador pidió que los planes se puedan comprar en línea con los medios más usados (PayPal, Google Pay y los demás), por 1, 3, 6 o 12 meses, a los precios publicados; que solo compre el titular y que su equipo use el mismo plan; un ID de transacción y un correo con la compra y los términos de reembolso; que la compra no sirva para probar tarjetas robadas («checkers»); y una forma de probar el pago sin cobrar: códigos como `PEPITOGRATIS`, creados desde una sección propia de la consola interna. Eligió Stripe, PayPal y Mercado Pago, y todavía no tiene cuentas de prueba. **Google Play** no aplica (es para apps de Android y cobra 15–30 %); Google Pay y Apple Pay llegan por Stripe Checkout.

## Decisión

- **Pago por adelantado, no suscripción recurrente.** Una compra es una orden (`checkout_order`) por N meses; al pagarse, alarga la vigencia con la misma regla que los pagos manuales (`extendValidity`, ADR 0027). La renovación automática, el prorrateo y el cambio de nivel a medio periodo quedan para BIL-08/09: mientras el plan está vigente solo se renueva igual (mismo nivel y módulos); para cambiar, se escribe a contacto.
- **Precios en el servidor.** `src/platform/billing/prices.ts` es la única lista (el sitio público la usa también): nivel × módulos × meses, menos el descuento del código. **El IVA va incluido** en los precios publicados y no se muestra aparte (decisión del fundador, 2026-10-26): las órdenes nuevas guardan `tax = 0` (nada cobrado encima) y `total = subtotal − descuento`; las anteriores conservan el IVA que se les sumó. Cuando haya facturación (PIL-10), el IVA trasladado se desglosa del total. Decimales exactos, centavos redondeados una vez por paso. El navegador nunca manda un importe.
- **Páginas de pago alojadas.** Stripe Checkout (tarjetas, Google Pay, Apple Pay, OXXO, Link), PayPal Orders v2 y Mercado Pago Checkout Pro. Nunca vemos una tarjeta (sin alcance PCI más allá de SAQ A). Cada proveedor es un adaptador (`src/platform/billing/checkout/<proveedor>.ts`) de la interfaz `PaymentProvider` (`provider.ts`), con `fetch` y sin SDK; el núcleo no conoce a ninguno. Un proveedor sin llaves no se ofrece.
- **Lo que concede el plan es la confirmación del proveedor**, nunca el regreso del navegador: un aviso firmado (webhook en `/api/pagos/<proveedor>/webhook`, firma verificada sobre el cuerpo crudo, evento guardado en `payment_event` antes de responder, repetido sin efecto) o la consulta al proveedor (`fetchStatus`) cuando el titular vuelve a la página de estado. En los dos casos se pregunta al proveedor el estado autoritativo y se compara **importe y moneda exactos** con la orden; si no coinciden no se concede y queda en el log (`checkout_amount_mismatch`) para revisión. Aplicar la orden bloquea la empresa (`LOCKING_TRANSACTION`): aunque lleguen el aviso y el regreso a la vez, se aplica una vez.
- **Solo el titular** compra (`assertOwnerAction(…, "platform.subscription.create")`, sesión con correo confirmado y verificación en dos pasos, que para titulares es obligatoria). El plan es de la empresa: los invitados lo usan sin comprar.
- **Contra «checkers» de tarjetas:** además de lo anterior, cada intento de abrir un pago o probar un código cuenta antes de crear nada (`reserveAttempt`: 10 por persona, 20 por empresa y 40 por IP cada hora); una empresa tiene como máximo 3 compras sin terminar; la página del proveedor debe estar en sus dominios (`checkoutHosts`); y cada intento pasa por el antifraude del proveedor (Radar en Stripe; el fundador debe activar sus reglas). Un bot necesitaría cuentas de titular confirmadas con MFA, y aun así se topa con los límites.
- **Códigos** (`promo_code`, de plataforma, no de empresa): los crea solo el personal de plataforma en `/interno/codigos`, con porcentaje (100 = gratis), usos máximos y caducidad, y se desactivan. Un código que no existe, venció o se agotó responde lo mismo («no es válido o ya no está vigente»). Con 100 % la orden queda pagada al momento sin proveedor (`provider = CODE`, total 0; un `CHECK` exige las dos cosas juntas); el uso se cuenta con un `UPDATE` condicionado bajo el candado de la empresa, así que el último uso no se gasta dos veces.
- **ID de transacción** `AL-XXXXXXXX` (8 caracteres sin 0/O/1/I/L), único. **Correo de compra** (`planPurchaseEmail`, por la cola: `billing.purchase_receipt`) con ID, plan, meses, subtotal, descuento (y el IVA solo en órdenes anteriores al cambio), total, forma de pago, vigencia y los **términos de reembolso** (`REFUND_TERMS` en `refunds.ts`, también en `/terminos`).
- **La base cuida lo cobrado:** disparadores impiden cambiar importes, plan o proveedor de una orden, sacarla de un estado final o borrarla; `CHECK` de meses (1/3/6/12), importes (`total = subtotal − descuento + IVA`) y moneda.
- **Bitácora:** `plan.purchased` con el titular como autor.

## Lo que no se hace (todavía)

- Reembolsos desde el sistema: se hacen en el panel del proveedor y el personal ajusta la vigencia con una anulación manual (ADR 0027). Un registro de reembolso propio vendrá con BIL-12/13.
- Renovación automática, prorrateo, cambio de nivel o de módulos con plan vigente (BIL-08..11).
- CFDI (PIL-10/BIL-14).
- Barrido periódico de órdenes vencidas: una orden se marca vencida cuando el proveedor lo dice o cuando alguien la consulta.

## Consecuencias

- Términos subieron a la versión `2026-10-25` (sección «Reembolsos» y forma de pago): todas las cuentas aceptan otra vez (PIL-09). Los textos siguen sujetos a la revisión legal (PIL-08).
- Variables nuevas por proveedor en `.env.example` y `deploy/plantillas/env.production`; sin llaves, solo funcionan los códigos.
- La política de contenido (`form-action`) permite los dominios de pago de los proveedores, para que el envío sin JavaScript también llegue.
