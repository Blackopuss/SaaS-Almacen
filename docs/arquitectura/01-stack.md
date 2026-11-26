# 1. Stack: qué usamos y por qué

Cada fila resume una decisión. El detalle (contexto, alternativas y consecuencias) está en el ADR enlazado, en [`docs/adr/`](../adr/).

## Resumen en una frase

Una sola aplicación **Next.js + React + TypeScript** (interfaz y servidor en el mismo proyecto) sobre **MySQL** con **Prisma**, organizada como **monolito modular**: un núcleo compartido (`platform`) y módulos contratables (`modules`: Inventario, Compras, Ventas), más un **worker** aparte para el trabajo en segundo plano.

## Aplicación

| Tecnología | Versión | Para qué | Por qué se eligió | Descartado | ADR |
| --- | --- | --- | --- | --- | --- |
| **Next.js** (App Router) | 16.4.3 | Pantallas, rutas, Server Components y Server Actions | Interfaz y servidor en un solo proyecto y un solo despliegue: lo puede mantener una persona. Las Server Actions evitan escribir y versionar una API REST para cada formulario. | Backend aparte (Express/Nest) + SPA: dos despliegues y un contrato más que mantener. Microservicios: demasiada operación antes de validar el producto. | [0001](../adr/0001-stack-aplicacion.md) |
| **React** | 19.2.8 | Componentes de interfaz | Lo exige Next; `useActionState` simplifica formularios con validación en servidor. | — | 0001 |
| **TypeScript** estricto | 5.9.3 | Todo el código | Errores atrapados al compilar. Modo estricto más `noUncheckedIndexedAccess`: un arreglo puede no tener el elemento que se pide. | JavaScript sin tipos. | 0001 |
| **Node.js** | ≥ 24 | Servidor y worker | Versión LTS vigente; `process.loadEnvFile` y `registerHooks` nativos. | — | 0001 |
| **npm** con versiones exactas | — | Dependencias | `save-exact` + `overrides`: lo que se prueba es exactamente lo que se instala en producción, y las dependencias vulnerables se fuerzan a versiones corregidas. | Rangos `^`: una actualización silenciosa puede romper producción. | 0001 |

## Datos

| Tecnología | Versión | Para qué | Por qué se eligió | Descartado | ADR |
| --- | --- | --- | --- | --- | --- |
| **MySQL** (InnoDB, utf8mb4) | 9.4 | Base de datos | Elección del fundador (la que ya usa). Tiene lo que exige un inventario: transacciones, bloqueo de filas (`FOR UPDATE`), `DECIMAL` exacto, `CHECK` y disparadores. | PostgreSQL: igual de válido, pero el fundador eligió MySQL. | [0002](../adr/0002-base-de-datos.md) |
| **Prisma** + `@prisma/adapter-mariadb` | 7.10.1 | Acceso a datos y migraciones | Tipos generados del esquema, migraciones versionadas y soporte directo en Better Auth. Permite una extensión propia (`forOrganization`) que obliga a filtrar por empresa. | Drizzle: más cercano a SQL, pero menos maduro en migraciones. | 0002 |
| **decimal.js** | 10.6.0 | Cantidades y dinero | `0.1 + 0.2 ≠ 0.3` con `number`. En inventario y caja un centavo o una pieza perdida es un defecto. | `number` de JavaScript. | 0002 |
| **UUIDv7** (`uuid`) | 14.0.2 | Identificadores | Únicos sin preguntar a la base y ordenados por tiempo: inserciones secuenciales en el índice y orden estable en listas. | Autoincrementales: revelan volumen y obligan a esperar a la base. | 0002 |
| **Zod** | 4.6.7 | Validación de entradas | Un esquema valida y da el tipo a la vez; mensajes en español listos para mostrar. | Validación a mano. | 0001 |

## Seguridad y cuentas

| Tecnología | Versión | Para qué | Por qué se eligió | ADR |
| --- | --- | --- | --- | --- |
| **Better Auth** | 1.7.7 | Registro, sesiones, verificación de correo, recuperación, MFA (TOTP) | Guarda todo en nuestra propia base (sin servicio externo ni costo por usuario) y es extensible. Se endureció: hash scrypt con parámetros de OWASP, superficie HTTP cerrada salvo los enlaces de correo, límite de intentos propio. | [0003](../adr/0003-autenticacion.md) |
| **CSP con nonce** (`src/proxy.ts`) | — | Política de scripts | Cada petición lleva un nonce: un script inyectado no se ejecuta. | 0003 |
| **uqr** | 0.1.3 | Código QR para activar MFA | Sin dependencias; se dibuja como SVG en React, sin servicios externos. | [0004](../adr/0004-interfaz.md) |

## Interfaz

| Tecnología | Versión | Para qué | Por qué se eligió | ADR |
| --- | --- | --- | --- | --- |
| **Tailwind CSS** | 4.3.3 | Estilos | Tokens de diseño en un solo archivo (`globals.css`) con modo claro y oscuro; una prueba verifica el contraste WCAG de cada color. | [0004](../adr/0004-interfaz.md) |
| **shadcn/ui** (Radix) | 4.22.1 | Componentes base (diálogos, menús, botones) | El código queda en el proyecto (`src/components/ui`) y se ajusta: 44 px táctiles, textos en español. Radix da accesibilidad de teclado y lector de pantalla. | 0004 |
| **motion** (Framer Motion) | 14.0.0 | Animación de la app | Animaciones cortas que respetan «reducir movimiento». | 0004 |
| **lucide-react** | 1.50.0 | Íconos | Consistentes y ligeros. | 0004 |
| **sonner** | 2.0.8 | Avisos («Guardado») | Simple y accesible. | 0004 |
| **anime.js** + **three.js** | 4.5.0 / 0.186.1 | Solo el sitio público | Efectos del sitio de ventas; three.js se carga bajo demanda solo en el encabezado. | [0022](../adr/0022-sitio-publico.md) |

## Servicios y operación

| Tecnología | Para qué | Por qué se eligió | ADR |
| --- | --- | --- | --- |
| **Cola de trabajos en MySQL** + worker (`npm run worker`) | Importaciones, correos, recordatorios | Sin Redis ni servicio extra: el trabajo se encola en la **misma transacción** que lo origina, así nunca queda un trabajo sin su cambio ni al revés. | [0013](../adr/0013-cola-de-trabajos.md) |
| **Nodemailer** (SMTP) | Correos | Proveedor intercambiable; en pruebas los correos quedan en memoria y en desarrollo en `/correos`. | [0023](../adr/0023-correo-smtp.md) |
| **PDF propio** (`@/platform/files`) | Órdenes, cotizaciones, estados de cuenta | Unas 360 líneas propias, sin dependencias: sin contenido activo ni superficie de ataque de una librería grande. | [0019](../adr/0019-pdf-propio.md) |
| **Stripe, PayPal, Mercado Pago** (con `fetch`, sin SDK) | Compra del plan en línea | Una interfaz común (`PaymentProvider`); el plan se activa solo cuando el proveedor confirma importe y moneda. | [0028](../adr/0028-compra-en-linea.md) |
| **Servidor Ubuntu + Caddy + systemd** | Producción | Caddy da HTTPS automático; web y worker como servicios; MySQL en Docker solo en local; respaldos cifrados con `age`; despliegue desde GitHub Actions con vuelta automática si falla la salud. | [0024](../adr/0024-despliegue-vps.md) |

## Calidad

| Herramienta | Para qué |
| --- | --- |
| **Vitest** 5 | Pruebas unitarias (código puro) y de integración (contra una base MySQL real de pruebas). |
| **ESLint** 9 + **eslint-plugin-boundaries** | Reglas de código y **límites de arquitectura**: un import que cruza capas indebidamente no compila en CI. |
| **Prettier** 3 | Formato uniforme. |
| **Playwright** + **axe-core** | Verificación de pantallas: foco visible, tamaños táctiles, desbordamiento y accesibilidad WCAG 2.1 AA. |
| **GitHub Actions** | CI en cada push (`npm run check` + `npm run build` + `npm audit`) y despliegue. |
