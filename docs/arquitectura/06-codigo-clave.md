# 6. Código clave, explicado

Las 14 piezas de código más importantes del sistema, con fragmentos reales (recortados donde dice `// …`). De cada una se explica qué hace, por qué está hecha así y cómo se comprueba.

| # | Pieza | Archivo | Protege |
| --- | --- | --- | --- |
| 1 | Aislamiento entre empresas | `src/server/tenant-db.ts` | Que una empresa vea datos de otra |
| 2 | Bloqueo de filas | `src/server/tenant-db.ts` | Dos operaciones simultáneas sobre lo mismo |
| 3 | Sesión | `src/platform/auth/session.ts` | Entrar sin cuenta válida, términos o MFA |
| 4 | Decisión de permisos | `src/platform/authorization/policy.ts` | Hacer algo que el rol no permite |
| 5 | Guarda de módulo | `src/platform/billing/guard.ts` | Usar un módulo no contratado o vencido |
| 6 | Registrar un movimiento | `src/modules/inventory/movements.ts` | Existencias incorrectas |
| 7 | Reglas en la base | `prisma/migrations/…/migration.sql` | Defectos del código o cambios a mano |
| 8 | Conversión de presentaciones | `src/platform/catalog/conversion-service.ts` | Factores falsos desde el navegador |
| 9 | Costo promedio | `src/modules/inventory/average-cost.ts` | Valor del inventario incorrecto |
| 10 | IVA de una venta | `src/modules/sales/tax.ts` | Centavos que no cuadran |
| 11 | Estados de una orden | `src/modules/purchasing/order-states.ts` | Saltos de estado ilegales |
| 12 | Cola de trabajos | `src/platform/jobs/queue.ts` | Trabajos perdidos o duplicados |
| 13 | Límite de intentos | `src/platform/auth/throttle.ts` | Adivinar contraseñas |
| 14 | Política de scripts (CSP) | `src/lib/csp.ts` + `src/proxy.ts` | Scripts inyectados |

---

## 1. Aislamiento entre empresas: `forOrganization`

**Archivo:** `src/server/tenant-db.ts`

Todas las empresas comparten las mismas tablas. Para que una nunca vea datos de otra, el código de negocio no usa el cliente de base de datos directo: pide `forOrganization(organizationId)`. Es una extensión de Prisma que intercepta **cada** consulta y le pone el filtro de empresa.

```ts
function scopedArgs(model: string, operation: string, args: Row, organizationId: string): Row {
  if (!tenantModels.has(model)) {
    throw new TenantScopeError(`${model} no es un dato de empresa; usa su servicio de plataforma.`);
  }
  const next: Row = { ...args };
  if (FILTERED.has(operation)) {                 // find, count, update, delete…
    next.where = scopeWhere(args.where, organizationId, model);   // agrega organizationId
  }
  if (WRITES_DATA.has(operation)) {
    checkUpdate(args.data, organizationId, model);                // no se cambia de empresa
  }
  if (CREATES.has(operation)) {
    next.data = scopeCreate(args.data, organizationId, model);    // se crea en la empresa activa
  } else if (!FILTERED.has(operation)) {
    throw new TenantScopeError(`${model}.${operation} no está permitido.`);
  }
  return next;
}

function extend(organizationId: string) {
  return db.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          return query(scopedArgs(model, operation, args ?? {}, organizationId));
        },
      },
    },
  });
}
```

Además, un `Proxy` envuelve al cliente y lanza un error si alguien intenta SQL directo (`$queryRaw`, `$executeRaw`…).

**Por qué así:** olvidar un `where organizationId = …` es el error más grave de un SaaS, y aquí no se puede olvidar. Lo que no está permitido se rechaza (denegar por defecto): un modelo desconocido, una operación no prevista, un filtro con otra empresa.

**Cómo se comprueba:**
- `TENANT_MODELS` lista las 64 tablas de empresa, y `tenant-db.test.ts` falla si una tabla del esquema con `organizationId` no está en la lista.
- `tests/isolation/two-companies.int.test.ts` crea dos empresas e intenta leer y cambiar datos cruzados en cada tabla.
- Como última defensa, las relaciones usan llaves compuestas `(organizationId, id)`: MySQL rechaza apuntar a una fila de otra empresa incluso con SQL a mano.

---

## 2. Bloqueo de filas: `lockRows`

**Archivo:** `src/server/tenant-db.ts`

Cuando dos personas venden la última pieza al mismo tiempo, las dos leerían «hay 1» y las dos restarían. `lockRows` bloquea las filas hasta que termina la transacción, así la segunda espera a la primera y después lee el valor ya actualizado.

```ts
export async function lockRows(tx: object, model: keyof typeof LOCKABLE, ids: readonly string[]) {
  const scope = tx[TRANSACTION];                       // solo dentro de una transacción de empresa
  if (!scope) throw new TenantScopeError("lockRows necesita el cliente de una transacción de empresa.");
  const table = LOCKABLE[model];                       // lista fija de tablas: nunca texto del usuario
  const unique = [...new Set(ids.map(String))].sort(); // SIEMPRE en el mismo orden
  if (unique.length === 0) return [];
  const rows = await scope.client.$queryRawUnsafe(
    `SELECT id FROM \`${table}\` WHERE organizationId = ? AND id IN (${unique.map(() => "?").join(", ")})
     ORDER BY id FOR UPDATE`,
    scope.organizationId, ...unique,                   // todo como parámetro
  );
  return rows.map((row) => row.id);                    // solo los ids que existen en ESTA empresa
}

export const LOCKING_TRANSACTION = { isolationLevel: "ReadCommitted" } as const;
```

**Por qué así:**
- **Orden fijo (por id):** si una transacción bloquea A y luego B, y otra B y luego A, se esperan para siempre (interbloqueo). Ordenando, nunca pasa.
- **`READ COMMITTED`:** con el nivel por defecto de MySQL, una transacción que esperó el candado seguiría viendo los datos de antes de esperar. Con este nivel lee lo vigente.
- **Filtro de empresa incluido:** es la única excepción al «nada de SQL directo», y aun así no puede tocar otra empresa.

**Cómo se comprueba:** `tests/inventory/exit-concurrency.int.test.ts` y las pruebas de ventas y recepciones lanzan operaciones simultáneas con `Promise.all` sobre el mismo producto y verifican que el saldo nunca queda negativo ni se descuenta dos veces.

---

## 3. Sesión: `requireSession`

**Archivo:** `src/platform/auth/session.ts`

Es la puerta de toda pantalla y acción protegida.

```ts
export async function requireSession(options = {}) {
  const session = await getCurrentSession();                 // valida la cookie CONTRA LA BASE
  if (!session) redirect("/ingresar");
  const mfaEnabled = Boolean(session.user.twoFactorEnabled);
  if (!options.allowPendingLegal && (await pendingLegalDocuments(id)).length > 0) {
    redirect(LEGAL_ACCEPTANCE_PATH);                         // falta aceptar términos vigentes
  }
  if (!mfaEnabled && !options.allowMissingMfa && (await isMfaRequired(id))) {
    redirect(MFA_SETUP_PATH);                                // titular o administrador sin MFA
  }
  return { user: { id, name, email }, sessionId: session.session.id, mfaEnabled };
}
```

Encima de esta función, `requireOrganizationContext()` (`src/platform/tenancy/context.ts`) agrega la empresa activa guardada en la sesión y revisa que la membresía siga activa.

**Por qué así:** `src/proxy.ts` solo mira si existe la cookie, para redirigir rápido, pero una cookie sola no prueba nada. La validación real se hace en el servidor en cada petición. Por eso una sesión cerrada, una persona desactivada o un cambio de términos tienen efecto inmediato.

---

## 4. Decisión de permisos: `can`

**Archivo:** `src/platform/authorization/policy.ts`

Una sola función pura (sin base de datos) decide si alguien puede hacer algo.

```ts
export type Subject = { isOwner: boolean; roles: readonly string[]; support?: boolean };

export function permissionsOf(subject: Subject): ReadonlySet<Permission> {
  const granted = new Set<Permission>();
  if (subject.isOwner === true) {
    for (const permission of OWNER_PERMISSIONS) granted.add(permission);
  }
  for (const role of knownRoles(subject.roles)) {              // roles desconocidos se ignoran
    for (const permission of ROLE_PERMISSIONS[role]) granted.add(permission);   // los roles se suman
  }
  if (subject.support === true) {                              // soporte: solo lectura
    return new Set([...granted].filter((p) => p.endsWith(".read")));
  }
  return granted;
}

export function can(subject: Subject, permission: Permission): boolean {
  if (!isPermission(permission)) return false;                 // denegar por defecto
  return permissionsOf(subject).has(permission);
}
```

**Por qué así:** una función pura se prueba de forma exhaustiva, sin base ni sesión. El catálogo (`catalog.ts`) se genera de la matriz aprobada por el fundador (`docs/producto/MATRIZ_ROLES_PERMISOS.md`), y `catalog.test.ts` falla si no coinciden. Los permisos tienen forma `modulo.recurso.accion` (`inventory.movement.create`), lo que permite deducir de qué módulo son y si solo leen.

**Cómo se comprueba:** `policy.test.ts` prueba cada rol contra cada permiso; `tests/platform/negative-by-role.int.test.ts` prueba los casos prohibidos de la matriz contra los servicios reales.

---

## 5. Guarda de módulo: `assertModulePermission`

**Archivo:** `src/platform/billing/guard.ts`

Cada servicio de un módulo empieza llamándola. Revisa, en orden, el permiso del rol y que la empresa tenga el módulo contratado y vigente.

```ts
export function isReadOrExport(permission: string): boolean {
  const [, resource, action] = permission.split(".");
  return action === "read" || action === "export" || resource === "export";
}

export function entitles(entitlements: Entitlements, permission: string): boolean {
  const moduleId = moduleOfPermission(permission);         // "sales.sale.create" → "sales"
  if (moduleId === null) return true;                      // permisos de plataforma
  const state = entitlements.moduleState(moduleId);
  return state === "active" || (state === "read_only" && isReadOrExport(permission));
}

export async function assertModulePermission(organizationId, userId, permission) {
  if (!isPermission(permission)) throw denied(String(permission));
  if (!(await isAllowed(organizationId, userId, permission))) throw denied(permission);   // rol
  const entitlements = await getEntitlements(organizationId);
  if (!entitles(entitlements, permission)) throw notEntitled(entitlements, permission);  // módulo
}
```

**Por qué así:**
- Con el plan vencido, el módulo queda en **solo lectura**: se deja leer y exportar (para que el cliente nunca pierda acceso a sus datos) y se bloquea lo que escribe.
- La pantalla oculta botones con `getModuleAccess()`, pero el servicio **vuelve a revisar**: esconder un botón no es seguridad.

**Cómo se comprueba:** `tests/sales/module-guard.int.test.ts` y `tests/purchasing/module-guard.int.test.ts` llaman **cada función exportada** del módulo en una empresa sin el módulo y otra con el módulo vencido. Si alguien agrega un servicio sin guarda, la prueba falla.

---

## 6. Registrar un movimiento: `post`

**Archivo:** `src/modules/inventory/movements.ts`

Es el núcleo del inventario: entradas, salidas y saldo inicial pasan por aquí. Todo ocurre en una transacción.

```ts
return await forOrganization(organizationId).$transaction(async (tx) => {
  // 1. Nadie más mueve este producto (ni archiva la ubicación) hasta terminar.
  const [productId] = await lockRows(tx, "product", [data.productId]);
  if (data.locationId) await lockRows(tx, "location", [data.locationId]);

  // 2. ¿Esta confirmación ya se hizo (doble clic, reintento)? Responde lo mismo.
  if (data.idempotencyKey) {
    const replay = await findReplay(tx, data.idempotencyKey);
    if (replay) return answerReplay(replay, type, userId, data);
  }

  // 3. Producto y ubicación siguen activos.
  // …
  // 4. Conversión con el factor guardado en el servidor: 3 cajas × 100 = 300.
  const resolved = await resolveConversion(tx, product.id, capture);
  if (!resolved.ok) return reject("invalid", "quantity", resolved.error);
  const base = resolved.conversion.baseQuantity;

  // 5. Saldo nuevo con decimales exactos; nunca negativo.
  const before = dec(current?.quantity.toString() ?? 0);
  const balance = kind.direction === "IN" ? before.plus(base) : before.minus(base);
  if (balance.isNegative()) {
    return reject("invalid", "quantity",
      `Solo hay ${formatStock(before, unitCode)} en ${location.name}: no pueden salir ${formatStock(base, unitCode)}.`);
  }

  // 6. Costo promedio, leído bajo el candado.
  const costs = await openCostBook(tx, organizationId, [product.id]);
  const unitCost = kind.direction === "IN" ? costs.entry(product.id, base, …) : costs.exit(product.id, base);

  // 7. El historial: movimiento + línea (con lo capturado, factor y versión de la presentación).
  await tx.stockMovement.create({ data: { id: movementId, organizationId, type, reason, idempotencyKey, createdByUserId: userId } });
  await tx.stockMovementLine.create({ data: { /* … */ baseQuantity: base.toString(), unitCost: lineCost(unitCost) } });
  await costs.save();

  // 8. El saldo cambia en la MISMA transacción (una salida resta con condición quantity >= base).
  // …
}, LOCKING_TRANSACTION);
```

**Por qué así:**
- El **historial** es la verdad; el saldo es un resumen que se puede verificar.
- Las líneas guardan lo que la persona capturó **y** la versión de la presentación. Si mañana «Caja» cambia de 100 a 120 piezas, el pasado no se reescribe.
- Los fallos esperados se devuelven como `{ ok: false, reason, fieldErrors }` con el mensaje en español, ligado a su campo.

**Cómo se comprueba:** cada prueba de inventario termina con `expect(await reconcileStock(organizationId)).toEqual([])`, que verifica saldo = suma del historial. En cualquier base: `npm run stock:reconcile`.

---

## 7. Reglas repetidas en la base de datos

**Archivo:** `prisma/migrations/20261004150000_stock_movements/migration.sql` (y otras)

El servicio es la primera barrera; la base, la última.

```sql
-- El saldo nunca es negativo, aunque dos salidas lleguen a la vez.
ALTER TABLE `stock_balance` ADD CONSTRAINT `stock_balance_quantity_check` CHECK (`quantity` >= 0);

-- Un movimiento confirmado no se edita ni se borra: se corrige con una reversa.
CREATE TRIGGER `stock_movement_no_update` BEFORE UPDATE ON `stock_movement` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movement is immutable: reverse it instead';
CREATE TRIGGER `stock_movement_no_delete` BEFORE DELETE ON `stock_movement` FOR EACH ROW
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'stock_movement is immutable: reverse it instead';
```

Lo mismo protege las líneas de venta, pagos, recepciones, devoluciones, la bitácora y los pagos del plan.

**Por qué así:** ni un defecto futuro del código ni alguien con acceso a la base puede alterar el historial sin que la base lo rechace. Además, la aplicación se conecta con un usuario (`almacen_app`) que no puede quitar disparadores ni cambiar tablas.

---

## 8. Conversión de presentaciones: `resolveConversion`

**Archivo:** `src/platform/catalog/conversion-service.ts`

El navegador solo dice «3» y «la presentación X». El servidor busca cuántas piezas trae esa presentación **hoy** y calcula.

```ts
export async function resolveConversion(client, productId, capture) {
  const product = await client.product.findFirst({
    where: { id: String(productId), status: "ACTIVE" },
    select: { id: true, unitCode: true, quantityStep: true },
  });
  if (!product) return { ok: false, error: "Este producto ya no existe o está archivado." };

  if (capture.kind === "presentation") {
    // Solo presentaciones de ESTE producto; la versión más reciente de su contenido.
    const row = await client.productPresentation.findFirst({
      where: { id: String(capture.presentationId), productId: product.id },
      select: { id: true, name: true, versions: { orderBy: { version: "desc" }, take: 1,
                select: { id: true, version: true, factor: true } } },
    });
    // …
  }
  // … convertCapture(): valida la cantidad con la regla del producto (paso, decimales)
}
```

**Por qué así:** si el factor viniera del navegador, alguien podría registrar «1 caja = 1,000,000 piezas». El contenido de una presentación se versiona: cambiarlo crea una versión nueva y cada movimiento guarda con cuál se hizo.

---

## 9. Costo promedio: `valueEntry` y `valueExit`

**Archivo:** `src/modules/inventory/average-cost.ts`

El precio promedio móvil (como SAP): cada entrada con costo recalcula el promedio y cada salida se lleva el valor al costo vigente.

```ts
export function valueEntry(state: CostState | null, onHand, quantity, unitCost): Valued {
  const before = dec(onHand);
  const added = dec(quantity);
  const after = before.plus(added);
  if (unitCost === null) {
    // Entrada sin costo: entra al precio actual, que no cambia.
    if (!state) return { state: null, unitCost: null };
    return { state: { averageCost: state.averageCost,
                      stockValue: round(state.stockValue.plus(added.times(state.averageCost))) },
             unitCost: state.averageCost };
  }
  const cost = round(dec(unitCost));
  const valueBefore = state ? state.stockValue : before.times(cost);   // el primer costo valúa lo que no tenía
  const stockValue = round(valueBefore.plus(added.times(cost)));
  return {
    state: { averageCost: after.isZero() ? cost : round(stockValue.dividedBy(after)), stockValue },
    unitCost: cost,
  };
}
// Ejemplo: 10 a $85 + 10 a $95 → promedio $90.
```

**Por qué así:** es una función **pura** (sin base). Las reglas contables se prueban con ejemplos exactos en `average-cost.test.ts`, y los servicios solo la llaman dentro de su transacción, después de bloquear el producto. `npm run stock:reconcile` comprueba además que valor = existencias × costo promedio.

---

## 10. IVA de una venta: `saleTotals`

**Archivo:** `src/modules/sales/tax.ts`

```ts
const cents = (amount: Decimal) => amount.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

export function saleTotals(amounts: readonly DecimalInput[], rule: TaxRule): SaleTotals {
  const sum = amounts.reduce((total, amount) => total.plus(cents(dec(amount))), dec(0));
  const rate = dec(rule.rate).dividedBy(100);
  if (rule.pricesIncludeTax) {
    const subtotal = cents(sum.dividedBy(rate.plus(1)));       // se desglosa del total
    return { subtotal, tax: sum.minus(subtotal), total: sum };
  }
  const tax = cents(sum.times(rate));                           // se suma al cobrar
  return { subtotal: sum, tax, total: sum.plus(tax) };
}
```

**Por qué así:** el IVA se redondea **una sola vez sobre toda la venta**, no por línea. Así subtotal + IVA = total siempre, al centavo, y el ticket nunca tiene una diferencia de $0.01. Es la única función que calcula IVA en todo el sistema.

---

## 11. Estados de una orden de compra

**Archivos:** `src/modules/purchasing/order-states.ts` y su disparador en `prisma/migrations/20261016090000_purchase_order_close/migration.sql`

```ts
export const PURCHASE_ORDER_TRANSITIONS: Record<PurchaseOrderStatus, readonly PurchaseOrderStatus[]> = {
  DRAFT:     ["SENT", "CANCELLED"],
  SENT:      ["PARTIAL", "RECEIVED", "CANCELLED"],
  PARTIAL:   ["RECEIVED", "CLOSED"],
  RECEIVED:  [],
  CANCELLED: [],
  CLOSED:    [],
};
export const canTransition = (from, to) => PURCHASE_ORDER_TRANSITIONS[from].includes(to);
```

La misma tabla, repetida en MySQL:

```sql
CREATE TRIGGER `purchase_order_transition` BEFORE UPDATE ON `purchase_order` FOR EACH ROW
BEGIN
    IF NEW.`status` <> OLD.`status` AND NOT (
        (OLD.`status` = 'DRAFT' AND NEW.`status` IN ('SENT', 'CANCELLED'))
        OR (OLD.`status` = 'SENT' AND NEW.`status` IN ('PARTIAL', 'RECEIVED', 'CANCELLED'))
        OR (OLD.`status` = 'PARTIAL' AND NEW.`status` IN ('RECEIVED', 'CLOSED'))
    ) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'purchase_order: invalid state transition';
    END IF;
END;
```

**Por qué así:** la pantalla pregunta `canTransition` para mostrar solo los botones posibles; el servicio la usa para validar, y la base la impone. Cotizaciones (`quote-states.ts`) y pedidos (`sales-order-states.ts`) siguen el mismo patrón. `order-transitions.int.test.ts` comprueba que las transiciones ilegales se rechazan tanto en el servicio como, de última defensa, en la base.

---

## 12. Cola de trabajos: `enqueueJob`

**Archivo:** `src/platform/jobs/queue.ts` (y el proceso `scripts/worker.mts`)

```ts
/**
 * `client` es el cliente de empresa o, mejor, la transacción que hace el
 * cambio al que sigue el trabajo: así el trabajo existe solo si el cambio existió.
 */
export async function enqueueJob(client, organizationId, input: EnqueueInput) {
  if (!TYPE.test(input.type) || input.type.length > 64) throw new Error(`Invalid job type: ${input.type}`);
  const payload = JSON.stringify(input.payload ?? {});        // ids y opciones, nunca secretos
  if (Buffer.byteLength(payload) > MAX_PAYLOAD_BYTES) throw new Error(`Payload of ${input.type} is too large`);
  const jobId = newId();
  await client.job.create({
    data: { id: jobId, organizationId, type: input.type, payload: JSON.parse(payload),
            maxAttempts, runAt: input.runAt ?? new Date(), createdByUserId: input.createdByUserId ?? null },
  });
  return { jobId };
}
// Reintentos con espera creciente: 5 s, 10 s, 20 s… hasta 15 min.
```

El worker toma un trabajo a la vez (varios workers nunca toman el mismo), ejecuta su manejador (registrado en `src/modules/registry/jobs.ts`) y, si falla en definitiva, llama `onFailed` para devolver lo que se apartó (por ejemplo, cupo del plan).

**Por qué así:** no hace falta Redis ni otro servicio. Encolar dentro de la misma transacción evita los dos errores clásicos: un trabajo sin su cambio o un cambio sin su trabajo. Como un trabajo puede correr dos veces (si el worker se reinicia a la mitad), cada manejador es idempotente.

---

## 13. Límite de intentos: `reserveAttempt`

**Archivo:** `src/platform/auth/throttle.ts`

```ts
export async function reserveAttempt(keys: ThrottleKey[]): Promise<number> {
  const sorted = [...keys].sort((a, b) => (a.key < b.key ? -1 : 1));   // orden fijo
  return db.$transaction(async (tx) => {
    // ¿Alguna llave (cuenta, IP) está bloqueada? Se leen con candado.
    const blocked = await tx.$queryRawUnsafe(
      `SELECT TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), blockedUntil) AS wait
         FROM auth_throttle WHERE \`key\` IN (…) ORDER BY \`key\` FOR UPDATE`, …);
    const wait = Math.max(0, ...blocked.map((row) => Number(row.wait ?? 0)));
    if (wait > 0) return wait;
    // Aparta el intento ANTES de verificar la contraseña, de forma atómica.
    for (const { key, rule } of sorted) {
      await tx.$executeRawUnsafe(`INSERT INTO auth_throttle … ON DUPLICATE KEY UPDATE count = …`, …);
    }
    // …
  });
}
```

Después de verificar, el llamador llama `settleFailure` (si falló) o `refundAttempt` (si no era un intento de adivinar).

**Por qué así:** la forma ingenua (revisar si está bloqueado, verificar y contar al final) deja pasar 50 peticiones simultáneas antes de que cualquiera cuente. Se encontró en la auditoría 1 y se corrigió apartando el intento primero.

---

## 14. Política de scripts (CSP) con nonce

**Archivos:** `src/lib/csp.ts` y `src/proxy.ts`

```ts
export function contentSecurityPolicy(nonce: string, options: { development: boolean; https: boolean }) {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.development ? " 'unsafe-eval'" : ""}`,
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    `form-action 'self' ${CHECKOUT_HOSTS}`,     // solo nuestras páginas y las de pago
    "frame-ancestors 'none'",                   // nadie nos mete en un iframe
    // …
  ];
  return directives.join("; ");
}

export function newNonce(): string {           // 128 bits nuevos en cada petición
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}
```

**Por qué así:** si alguien lograra inyectar un `<script>` (por ejemplo, en el nombre de un producto), el navegador no lo ejecutaría porque no lleva el nonce de esa petición. Es una defensa más, además de que React ya escapa el texto.

---

## Cómo leer el código por tu cuenta

1. Empieza por una pantalla (`src/app/(app)/<sección>/page.tsx`) y su `actions.ts`.
2. Sigue la llamada al servicio en `src/modules/…` o `src/platform/…`.
3. Busca su prueba en `tests/<área>/`: describe con casos concretos lo que el servicio garantiza.
4. Si una regla parece extraña, busca su clave (`INV-19B`, `CMP-07`…) en `MEMORY.md` o el ADR del tema: ahí está la razón.
