# 4. Recorrido por el código importante

Este documento sigue dos operaciones reales de principio a fin, para ver cómo trabajan juntas las piezas de [Patrones](03-patrones.md). Al final hay una tabla de los archivos que más conviene conocer.

## 4.1 Una petición, de la pantalla a la base: «Registrar entrada»

```text
Navegador                   Servidor (Next.js)                              MySQL
─────────                   ──────────────────                              ─────
GET /movimientos/entrada ─► proxy.ts: ¿hay cookie? (si no → /ingresar)
                            entrada/page.tsx  ──► getModuleAccess()  ─────► sesión, empresa,
                                                   (¿permiso? ¿módulo?)      roles, derechos
                            MovementScreen pinta el formulario
                            con una idempotencyKey nueva (newId())
◄── HTML ──────────────────
Escribe cantidad, «Guardar»
  POST (Server Action) ────► actions.ts › registerEntryAction
                              requireOrganizationContext() ──────────────► sesión + empresa activa
                              registerEntry(actor, input)   (servicio)
                               └─ post():
                                   1. Zod valida la entrada
                                   2. forOrganization(id).$transaction ───► BEGIN
                                   3. lockRows(product), lockRows(location) ► SELECT … FOR UPDATE
                                   4. ¿la clave ya se usó? → responde igual
                                   5. lee producto y ubicación (activos)
                                   6. resolveConversion: 3 cajas × 100 = 300
                                   7. saldo nuevo = anterior ± cantidad (≥ 0)
                                   8. costo promedio (VAL)
                                   9. inserta movimiento + línea ─────────► INSERT (inmutables)
                                  10. actualiza stock_balance ────────────► UPDATE
                                                                           COMMIT
                              redirect / revalidatePath
◄── pantalla actualizada ──
```

### Paso por paso en el código

**1. Revisión rápida: `src/proxy.ts`.** Si la ruta es protegida y no hay cookie de sesión, redirige a `/ingresar`. También pone la CSP con nonce. No valida nada contra la base: una cookie sola no prueba nada.

**2. La pantalla: `src/app/(app)/movimientos/entrada/page.tsx`.**

```tsx
export default async function EntradaPage({ searchParams }) {
  const access = await getModuleAccess(); // sesión + empresa + roles + módulos
  return <MovementScreen kind="entry" access={access} searchParams={searchParams} />;
}
```

`getModuleAccess()` (`src/platform/billing/guard.ts`) responde qué puede hacer esta persona: `access.can("inventory.movement.create")`, `access.hasModule("inventory")` y `access.moduleState(...)` (contratado, solo lectura o sin módulo). `MovementScreen` es la pantalla compartida por entrada, salida y saldo inicial. Muestra el formulario solo si hay permiso y genera la `idempotencyKey`.

**3. El formulario: `entrada/entry-form.tsx` (`"use client"`).** Usa `useActionState` con la Server Action. Solo manda lo tecleado: id del producto, ubicación, cantidad, `capture` (`base` o `p:<id de presentación>`) y la clave. **Nunca** manda factores, existencias ni la empresa.

**4. La acción: `src/app/(app)/movimientos/actions.ts`.** Es deliberadamente delgada:

```ts
const { user, organization } = await requireOrganizationContext(); // identidad del servidor
result = await registerEntry(
  { organizationId: organization.id, userId: user.id },   // nunca del formulario
  { productId, locationId, quantity, idempotencyKey, ...captureFields(capture) },
);
if (!result.ok) return { fieldErrors: result.fieldErrors, values }; // vuelve lo escrito
```

**5. El servicio: `src/modules/inventory/movements.ts` › `post()`.** Aquí viven las reglas. Entradas, salidas y saldo inicial comparten este núcleo; cada una solo cambia su configuración en `KINDS`.

```ts
return await forOrganization(organizationId).$transaction(async (tx) => {
  const [productId] = await lockRows(tx, "product", [data.productId]); // nadie más mueve este producto
  if (data.idempotencyKey) {
    const replay = await findReplay(tx, data.idempotencyKey);         // ¿doble clic? responde lo mismo
    if (replay) return answerReplay(replay, type, userId, data);
  }
  const resolved = await resolveConversion(tx, product.id, capture);  // factor leído en el servidor
  const balance = kind.direction === "IN" ? before.plus(base) : before.minus(base);
  if (balance.isNegative()) return reject("invalid", "quantity", `Solo hay …`);
  await tx.stockMovement.create({ … });       // el historial
  await tx.stockMovementLine.create({ … });   // capturado, factor, versión de la presentación, base
  // … y el saldo en stock_balance, en la misma transacción
}, LOCKING_TRANSACTION);
```

Qué cuidar aquí:

- `forOrganization` agrega `organizationId` a cada consulta. No hay forma de leer otra empresa.
- `lockRows` hace `SELECT … FOR UPDATE` con el filtro de empresa, en orden por id.
- Las cantidades son `Decimal` (`dec(...)`), nunca `number`.
- Los fallos esperados vuelven como `{ ok: false, reason, fieldErrors }`, con el mensaje ligado a su campo.

**6. La base.** Los disparadores impiden editar o borrar movimientos y líneas, y un `CHECK` impide un saldo negativo aunque hubiera un defecto en el servicio.

**7. La prueba.** `tests/inventory/entries.int.test.ts` llama al servicio real contra MySQL y termina con `expect(await reconcileStock(organizationId)).toEqual([])`: el saldo debe ser igual a la suma del historial.

## 4.2 Una operación entre módulos: «Cobrar una venta»

`registerSale` (`src/modules/sales/sales.ts`) muestra cómo Ventas usa Inventario sin duplicar reglas:

1. `assertModulePermission(org, user, "sales.sale.create")`: permiso del rol, módulo Ventas contratado y vigente.
2. Abre una transacción y bloquea, en orden, **productos → caja de quien cobra**.
3. Busca la `idempotencyKey`. Una clave repetida solo es reintento si coinciden persona, productos y cantidades.
4. `priceLines` vuelve a poner precio con lo vigente; **nunca** usa un importe que mande el navegador.
5. `readTaxRule` lee el IVA de la empresa y `saleTotals` calcula subtotal + IVA = total (redondeo una sola vez).
6. `readPayments` valida los pagos: efectivo con cambio, tarjeta con referencia, y que sumen exacto el total.
7. Escribe venta, líneas y pagos, y llama a **`postSaleExit` de Inventario** (por su `index.ts`), que escribe el movimiento `SALE` al costo promedio. Todo en la misma transacción: o se guarda la venta con su salida, o nada.
8. El número consecutivo de venta se resuelve reintentando si dos cajeros chocan (`P2002`, índice único).

Ventas depende de Inventario y no al revés. La plataforma no conoce a ninguno de los dos.

## 4.3 Iniciar sesión y entrar a una empresa

| Paso | Archivo | Qué hace |
| --- | --- | --- |
| Formulario | `src/app/(auth)/ingresar/` | Server Action `signIn` |
| Límite de intentos | `src/platform/auth/throttle.ts` | `reserveAttempt` aparta el intento **antes** de verificar (atómico en MySQL); luego `settleFailure` o `refundAttempt` |
| Contraseña | `src/platform/auth/password.ts` | scrypt con parámetros de OWASP, comparación en tiempo constante |
| Segundo paso | `src/platform/auth/mfa.ts`, `/verificar-codigo` | Código TOTP de un solo uso o código de recuperación |
| Sesión válida | `src/platform/auth/session.ts` › `requireSession()` | Valida contra la base; manda a aceptar términos o a activar MFA si hace falta |
| Empresa activa | `src/platform/tenancy/context.ts` › `requireOrganizationContext()` | Sesión + empresa guardada en la sesión + membresía activa, revalidada en cada petición |
| Permisos | `src/platform/authorization/access.ts` | Lee roles de la base y decide con `can()` de `policy.ts` |

## 4.4 Trabajo en segundo plano: importar un Excel

1. **Subir:** `storeFile` (`src/platform/files`) guarda el archivo fuera de la carpeta pública, con un nombre propio (nunca el del usuario).
2. **Revisar:** `readSpreadsheet` lee celdas sin evaluar fórmulas. `validateImportRows` da errores por fila y columna, y la clasificación dice qué es nuevo y qué ya existe. Esta revisión no escribe nada.
3. **Confirmar:** en una transacción se aparta el cupo del plan (`reserveQuota`), se fijan las filas y se llama a `enqueueJob(tx, …)`.
4. **Worker** (`scripts/worker.mts` → `runWorker` de `src/platform/jobs/queue.ts`): toma el trabajo y aplica lotes con `applyImport`, volviendo a comprobar el permiso antes de cada lote. Si falla en definitiva, `onFailed` devuelve el cupo.
5. **Pantalla:** mientras hay algo en camino, el componente llama `router.refresh()` cada pocos segundos.

## 4.5 Pagar el plan en línea

`src/platform/billing/checkout/`:

1. Solo el titular compra (`assertOwnerAction`). El precio sale de `prices.ts`, nunca del navegador.
2. Se crea una `checkout_order` y se redirige al proveedor (Stripe, PayPal o Mercado Pago, cada uno un `PaymentProvider`).
3. El proveedor avisa a `/api/pagos/<proveedor>/webhook` (firmado). `confirmOrder` comprueba importe y moneda exactos, bloquea la empresa, extiende la vigencia y escribe los derechos de la empresa (`entitlement`: cupo de productos, usuarios y módulos comprados) en la misma transacción, con su bitácora.
4. El regreso del navegador solo muestra el estado; no activa nada por sí mismo.

## Archivos que conviene conocer primero

| Archivo | Por qué es importante |
| --- | --- |
| `prisma/schema.prisma` | Todas las tablas y relaciones (81 modelos) |
| `src/server/tenant-db.ts` | `forOrganization`, `lockRows`, `TENANT_MODELS`: el aislamiento entre empresas |
| `src/proxy.ts` | Redirección sin sesión y política de scripts (CSP) |
| `src/platform/auth/session.ts` | `requireSession`: la puerta de toda pantalla protegida |
| `src/platform/tenancy/context.ts` | `requireOrganizationContext`: de dónde sale la empresa |
| `src/platform/authorization/policy.ts` y `catalog.ts` | La única decisión de permisos y el catálogo de roles |
| `src/platform/billing/guard.ts` | Guardas de módulo, solo lectura y cupos |
| `src/platform/billing/contract.ts` + `src/modules/registry/index.ts` | Cómo se declara y registra un módulo |
| `src/platform/catalog/conversion.ts` | Presentaciones y conversión de cantidades |
| `src/modules/inventory/movements.ts` | El corazón del inventario: movimientos y saldos |
| `src/modules/inventory/average-cost.ts` | Reglas puras del costo promedio |
| `src/modules/sales/sales.ts` | Cobro en mostrador |
| `src/modules/sales/tax.ts`, `pricing.ts`, `payments.ts` | IVA, precios y pagos (puras, con pruebas unitarias) |
| `src/platform/jobs/queue.ts` + `scripts/worker.mts` | Cola de trabajos y worker |
| `src/components/app-shell/nav.ts` | Menú: secciones, permiso y módulo de cada una |
| `src/app/globals.css` | Tokens de diseño (claro y oscuro) |
| `tests/isolation/` | Pruebas de que una empresa nunca toca a otra |
