# 2. Estructura de carpetas

## La raíz del repositorio

```text
SaaS-Almacen/
├── src/                 Código de la aplicación (ver abajo)
├── prisma/              Esquema de la base (schema.prisma) y migraciones versionadas
├── tests/               Pruebas de integración contra MySQL, agrupadas por área
├── scripts/             Comandos de npm: preparar bases, sembrar la cuenta demo, worker,
│                        verificaciones de pantallas y accesibilidad, prueba de carga
├── deploy/              Instalación y despliegue en el servidor (Caddy, systemd, respaldos)
├── docs/                Documentación (índice en docs/README.md)
├── design-system/       Sistema visual (MASTER.md: colores, tipografía, reglas)
├── .github/workflows/   CI (revisión y pruebas) y despliegue
├── .agents/ .claude/    Skills de IA usadas para revisar interfaz y seguridad
├── AGENTS.md            Reglas del proyecto (lo leen las personas y los agentes de IA)
├── MEMORY.md            Decisiones del fundador e historial de cada paso
└── *.config.*           Configuración de Next, TypeScript, ESLint, Prettier, Vitest, Prisma
```

Los archivos de configuración se quedan en la raíz porque cada herramienta los busca ahí.

## `src/`: cinco capas

```text
src/
├── app/         Rutas y pantallas (Next.js App Router)
├── components/  Componentes visuales compartidos
├── lib/         Utilidades puras, sin reglas de negocio
├── server/      Infraestructura: cliente de base de datos, transacciones y candados
├── platform/    Núcleo compartido por todos los módulos
└── modules/     Módulos que se contratan por separado
```

### Quién puede importar a quién

```text
          app  ───────────────┐
           │                  │
           ▼                  ▼
        modules ──────► platform ──────► server
           │                  │             │
           └──────► lib ◄─────┘◄────────────┘
                     ▲
        components ──┘
```

| Desde | Puede importar |
| --- | --- |
| `app` | `modules`, `platform`, `lib` (solo su `index.ts`) y `components` |
| `modules` | otros `modules`, `platform` y `lib` (solo `index.ts`), `server` y `components` |
| `platform` | otra área de `platform` y `lib` (solo `index.ts`), `server`. **Nunca** `modules` |
| `server`, `components` | `lib` (`index.ts`) |

**Por qué:** las dependencias van en una sola dirección, de lo específico a lo general. Así:

- La plataforma no sabe qué módulos existen: se puede agregar o quitar un módulo sin tocar el núcleo.
- Cada área expone una **API pública** (`index.ts`). Lo demás es interno y se puede cambiar sin romper a nadie.
- La regla no depende de la disciplina de nadie: `eslint-plugin-boundaries` la impone en CI y `npm run lint:boundaries` demuestra que detecta las violaciones.

### `src/app/`: pantallas

```text
app/
├── (sitio)/        Sitio público: inicio, funciones, precios, términos, privacidad
├── (auth)/         Registro, inicio de sesión, MFA, crear empresa, invitaciones
├── (app)/          La aplicación con menú (AppShell)
│   ├── inicio/          Panel: lo que pide atención hoy
│   ├── inventario/      Productos, importar, exportar, existencias bajas
│   ├── movimientos/     Entrada, salida, reubicar, ajuste, saldo inicial, historial
│   ├── conteos/         Conteos físicos
│   ├── compras/         Proveedores, órdenes, recepciones, sugerencias, reportes
│   ├── ventas/          Mostrador, caja, historial, cotizaciones, pedidos, cuentas por cobrar
│   ├── ubicaciones/     Zonas, pasillos y estantes
│   └── configuracion/   Cuenta, equipo, plan, ajustes de ventas, bitácora
├── interno/        Consola del personal de la plataforma (empresas, códigos)
├── ticket/         Ticket de venta público (enlace firmado)
├── api/            Rutas HTTP: descargas, webhooks de pago, salud, Better Auth
├── layout.tsx      Layout raíz (tema, fuentes, nonce de la CSP)
└── globals.css     Tokens de diseño (colores claro y oscuro)
```

Los nombres entre paréntesis, como `(app)`, son **grupos de rutas** de Next: ordenan carpetas y comparten un layout sin aparecer en la dirección. Las rutas están en español porque son lo que la persona ve en el navegador.

Cada sección sigue la misma forma:

```text
movimientos/
├── page.tsx           Server Component: revisa acceso y lee datos con los servicios
├── actions.ts         Server Actions ("use server"): traducen FormData ↔ servicio
├── *-form.tsx         Componentes cliente ("use client") con useActionState
├── loading.tsx        Estado de carga
├── error.tsx          Estado de error
└── entrada/page.tsx   Subpantallas
```

### `src/platform/`: el núcleo

| Área | Responsabilidad |
| --- | --- |
| `auth` | Cuentas, sesiones, contraseñas (scrypt), MFA, recuperación, límite de intentos |
| `tenancy` | Empresas y «empresa activa» de cada sesión (`requireOrganizationContext`) |
| `authorization` | Roles, permisos, equipo, invitaciones, titularidad, acceso de soporte |
| `billing` | Contrato de módulos, registro, guardas de módulo, precios, vigencia, compra en línea |
| `entitlements` | Qué puede usar cada empresa (módulos y cupos) y contadores de cupo |
| `audit` | Bitácora de empresa y eventos de seguridad (solo agregar) |
| `catalog` | Productos, unidades, presentaciones y conversión de cantidades |
| `locations` | Ubicaciones y su jerarquía |
| `contacts` | Proveedores y clientes (una tabla, dos facetas) |
| `files` | Archivos privados, lectura y escritura de Excel/CSV, PDF propio |
| `jobs` | Cola de trabajos y rondas periódicas |
| `email` | Envío de correo y plantillas |
| `legal` | Versiones de términos y su aceptación |
| `ops` | Salud del sistema y alertas |

### `src/modules/`: lo que se contrata

| Módulo | Contenido |
| --- | --- |
| `inventory` | Movimientos y saldos, conteos, importaciones, exportaciones, costo promedio, mínimos |
| `purchasing` | Relación producto-proveedor, órdenes de compra y sus estados, recepciones, devoluciones, sugerencias, reportes |
| `sales` | Precios, IVA, carrito y cobro, caja, descuentos, ticket, devoluciones, cotizaciones, pedidos, ventas a plazos, cuentas por cobrar, reportes |
| `registry` | **Punto de composición**: reúne los contratos de todos los módulos, sus trabajos de fondo y sus rondas periódicas |

Cada módulo tiene un `contract.ts` (su nombre, dependencias y permisos) y un `index.ts` (su API pública).

### `src/server/`, `src/lib/` y `src/components/`

- **`server/`**: `db.ts` (cliente Prisma) y `tenant-db.ts` (`forOrganization`, `lockRows`, `LOCKING_TRANSACTION`). El cliente generado de Prisma vive en `server/generated/` y no se sube a git.
- **`lib/`**: decimales, UUIDv7, errores, logs, IP del cliente, CSP. Código puro y fácil de probar.
- **`components/`**: el menú (`app-shell/`), estados comunes (`states.tsx`), campos de formulario, tema claro/oscuro y los componentes base de shadcn (`ui/`).

## `tests/`

| Carpeta | Qué prueba |
| --- | --- |
| `isolation/` | Que una empresa nunca vea ni cambie datos de otra; revisión de cada Server Action |
| `platform/` | Núcleo: cuentas, MFA, roles, equipo, cupos, productos, ubicaciones, archivos, correo |
| `inventory/`, `purchasing/`, `sales/` | Cada módulo, incluidos recorridos completos y concurrencia |
| `billing/` | Proveedores de pago (con respuestas simuladas) |
| `server/` | Capa de datos por empresa, llaves compuestas, transacciones |
| `setup/` | Preparación de la base de pruebas y ayudantes (empresas, planes, ventas) |

Las pruebas unitarias de código puro viven junto al archivo que prueban (`tax.ts` → `tax.test.ts`).

## Dónde va cada cosa nueva

| Si vas a agregar… | Va en… |
| --- | --- |
| Una pantalla | `src/app/(app)/<sección>/…/page.tsx` + `actions.ts` |
| Una regla de negocio | Un servicio en `src/modules/<módulo>/` o `src/platform/<área>/`, nunca en un componente |
| Una tabla | `prisma/schema.prisma` + migración; si tiene `organizationId`, también en `TENANT_MODELS` |
| Un permiso | `docs/producto/MATRIZ_ROLES_PERMISOS.md` + `src/platform/authorization/catalog.ts` |
| Un trabajo en segundo plano | Su manejador en `src/modules/registry/jobs.ts` |
| Una prueba que toca la base | `tests/<área>/<nombre>.int.test.ts` |
| Una decisión importante | Un ADR nuevo en `docs/adr/` |
