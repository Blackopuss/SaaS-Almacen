# Memoria del proyecto

Actualizada: 2026-10-02, zona America/Mexico_City.

## Requisitos confirmados por el usuario

- Crear un SaaS web de almacén/inventario para pymes, tienditas y almacenes que hoy usan Excel y no pueden pagar una solución empresarial costosa.
- Comercialización por suscripción mensual y módulos elegidos según las necesidades del cliente, inspirado en la modularidad de Odoo.
- Stack sencillo y frontend con libertad para diseñar una interfaz de estética Apple.
- Preferencia por MySQL; aclaración: es la base de datos, no todo el backend.
- Plan de trabajo dividido en pequeñas etapas de aproximadamente un día.
- Incluir seguridad, autenticación, términos y condiciones y requisitos necesarios para vender.
- Guardar la planeación en memoria y hacer preguntas para completarla.
- Mercado inicial: México; segmento inicial: ferreterías, con expansión posterior a operaciones de almacén más grandes.
- Prioridad explícita: sencillez de uso y buen UI/UX.
- Primera versión exclusivamente de inventario: qué hay, cuánto hay, dónde está y descripción del producto.
- SAP es la referencia confirmada, simplificado para ferreterías. No se ha pedido equivalencia funcional con un ERP completo ni una edición específica de SAP.
- Alcance físico inicial confirmado: una ferretería con zonas, pasillos y estantes.
- Unidades y conversiones incluidas desde v1: piezas, kilos, metros y otras unidades necesarias; el tendero configura el contenido de las presentaciones, por ejemplo una caja de 100 piezas.
- Operación exclusivamente con internet en la primera versión, para mantenerla sencilla.
- El fundador estima aproximadamente 1,000 productos para la primera ferretería; es una estimación de ese cliente, no una cifra validada para todas las ferreterías.
- El plan contratado debe limitar la cantidad de productos que se pueden agregar. El servicio debe atender desde negocios con unos 100 productos hasta negocios con miles.
- Se conserva la modularidad funcional además de la capacidad por plan.
- ~~Un solo tipo de usuario~~ (2026-10-02, reemplazado el mismo día): **varios usuarios con roles predefinidos**. Usuarios incluidos por plan + usuario adicional con costo.
- Inventario es siempre la base obligatoria; los módulos (Compras, Ventas, CRM…) se contratan individualmente encima de ella. Ejemplo del fundador: tienda de 500 productos + Ventas + CRM.
- El precio de los módulos escala con el nivel de capacidad.
- Primer lanzamiento vendible: Inventario + Compras. Ventas = punto de venta primero, después cotizaciones/pedidos. Luego CRM.
- Equipo: fundador + IA (Claude y Codex), medio tiempo (~3–4 h/día). Pasos de ~3 horas.
- Pasarela de cobro: decidir con análisis comparativo (BIL-01), no por preferencia.
- El usuario autorizó iniciar y continuar la primera fase del plan y permite preguntas si son necesarias.
- El usuario pidió un cuestionario para personas de almacén que permita adaptar el proyecto a necesidades reales del sector.

## Propuestas, aún no confirmadas

- Monolito modular: Next.js + React + TypeScript; Tailwind CSS y shadcn/ui; backend Node.js dentro del mismo proyecto; Prisma + MySQL administrado.
- Better Auth como candidato de autenticación; comprobar mantenimiento, avisos de seguridad y compatibilidad antes de fijar versiones.
- Funciones propuestas para cubrir ese inventario: catálogo, existencias por ubicación interna, entradas/salidas, reubicaciones, conteos, historial e importación/exportación de Excel/CSV.
- Base obligatoria más módulos mensuales opcionales. Seguridad, respaldos y exportación incluidos para todos.
- Propuesta de niveles de capacidad, sin precios ni aprobación definitiva: 100, 500, 1,000, 3,000 y 10,000 productos activos por empresa. Más capacidad se cotiza solo tras validar operación y rendimiento.
- Definición propuesta: un producto activo/SKU ocupa un cupo; sus piezas físicas, presentaciones y ubicaciones no multiplican cupos. Archivar libera cupo si no queda stock ni operaciones pendientes; reactivar consume cupo.
- Cuotas verificadas en servidor para altas, reactivaciones e importaciones; cambios de plan sin borrado automático, cargos no consentidos ni pérdida del historial.
- Ubicaciones internas incluidas en la base; multi-almacén entre instalaciones pasa a expansión posterior.
- Español, MXN y una moneda por empresa son propuestas aún no confirmadas explícitamente. México y operación con internet ya están confirmados.
- Diseño propuesto para conversiones: una unidad base por producto, presentaciones específicas por producto con factor directo a esa unidad, cantidades decimales exactas y factor histórico conservado en cada movimiento. No duplicar stock entre cajas y piezas.
- Stripe Billing es candidato para cobro recurrente; depende del país, métodos de pago, requisitos fiscales y costos reales.
- 64 jornadas de unas 6 horas efectivas para una persona con experiencia full-stack: las 60 originales más U01–U04 para unidades y conversiones después de D23. Reservar 25–35% adicional y tiempo de pilotos/revisiones externas. No es promesa de entrega.
- Objetivo de verificación: controles aplicables de OWASP ASVS nivel 2, con evidencia. No afirmar certificación ni seguridad absoluta.
- Interpretación propuesta del perfil único: acceso completo a funciones contratadas de su propia empresa. Empezar con la cuenta que crea el negocio y diferir invitaciones; número de cuentas por empresa pendiente, no asumir que «un tipo» confirma «una cuenta».

## Estado real

- Fase 1 en ejecución: definición e investigación preparadas y prototipo local implementado. No hay aplicación de producción, backend, MySQL, login, cobro ni despliegue público.
- Plan completo: `docs/PLAN_IMPLEMENTACION.md`.
- Se consultaron fuentes oficiales de Next.js, shadcn/ui, Prisma, Better Auth, Stripe, OWASP y legislación mexicana; enlaces en el plan.
- No se han contratado proveedores, fijado precios, redactado contratos finales ni validado cumplimiento legal.
- Plan actualizado a v0.6 (2026-10-02): modelo modular revisado en tres rondas Claude + Codex. 224 pasos de ~3 h con IDs por fase (FUN, BAS, PLT, USR, MOD, INV, IMP, CMP, PIL, BIL, VEN, COT, CRM); 148 hasta el lanzamiento limitado (PIL-17) con cobro asistido. Precios por nivel en la sección 4 son hipótesis para validar en FUN-06. Los IDs D07–D60/U01–U04 quedan reemplazados.
- Entregables de D01–D06: `docs/FASE_01_DEFINICION.md` y `prototype/`. Cero entrevistas realizadas; cinco por agendar. No marcar D02 ni la validación de D05 como completadas.
- Prototipo: HTML/CSS/JS, 8 productos ficticios, 4 ubicaciones y capacidad de ejemplo de 1,000; búsqueda, ficha, altas, entrada/salida/reubicación, conversiones, historial e importación mediante pegado desde Excel. Reinicia al recargar; no usar datos reales.
- Ejecutar `python prototype/serve.py` para abrir `http://127.0.0.1:4173`; servidor ligado solo a loopback y tipos MIME de módulos corregidos para Windows.
- Validación 2026-10-02: 10 pruebas de dominio aprobadas, comprobación de sintaxis y recorrido automatizado en Edge de escritorio/móvil aprobado; capturas en `prototype/qa/`. Se corrigió desbordamiento horizontal global en móvil. No equivalen a pruebas de seguridad/aislamiento de producción.
- Próxima actividad: FUN-01 (actualizar hipótesis con Compras, salidas diarias y roles) y FUN-02 (ampliar cuestionario). Riesgo principal señalado por Codex: sin Ventas, las salidas diarias deben registrarse con salida rápida (INV-28) o importación (IMP-10) o el inventario pierde credibilidad. Preservar hipótesis comerciales pendientes.
- Investigación: `docs/CUESTIONARIO_ALMACEN.md` contiene 24 preguntas operativas, 6 comerciales, profundizaciones y plantilla de síntesis. Preparado para D02; no enviado ni aplicado. Recoger respuestas sin orientar hacia el prototipo; contrastar por segmento y no asumir que cinco entrevistas representan toda la industria.

- 2026-10-02: prototipo HTML eliminado por decisión del fundador (no estaba en git); se empieza de cero. Las referencias al prototipo en `docs/FASE_01_DEFINICION.md` son históricas.
- Decisiones técnicas confirmadas: npm; MySQL 9.4 (la versión local del fundador, también objetivo); `motion` (Framer Motion) para animación; skills `ui-ux-pro-max` y `web-design-guidelines` instaladas en `.agents/skills` (enlazadas en `.claude/skills`). Implementar un paso a la vez con revisión breve de Codex por CLI.
- BAS-01 verificado: Next.js 16.3 + React 19.2 + TS estricto, ESLint + Prettier, `npm run check` y `npm run build` pasan desde limpio.
- BAS-02 verificado: capas `app`, `components`, `lib`, `server`, `platform/*`, `modules/*` con eslint-plugin-boundaries v7 (solo `index.ts` entre módulos; plataforma nunca depende de módulos; también detecta `typeof import()` tras revisión de Codex). `npm run lint:boundaries` prueba 9 casos. Trabajo en rama `feature/bas-fundacion`. - BAS-03 verificado: Prisma 7.10 + adapter MariaDB sobre MySQL 9.4 local; usuarios `almacen_app` (solo datos) y `almacen_migrator` (esquema); bases dev/test/shadow; migración `init` vacía aplicada en dev y test. `npm run db:check` prueba conexión y que la app no puede alterar el esquema. Vulnerabilidades altas de `mariadb`/`mysql2`/`deepmerge-ts` corregidas con `overrides`; `npm audit` en 0. Prueba de `db:reset` pendiente: requiere consentimiento explícito del fundador. Siguiente según orden acordado: BAS-06, BAS-07, BAS-12, BAS-13, luego BAS-04/05.
- BAS-06 verificado: `src/lib` con decimal exacto (decimal.js; rechaza floats, exponentes y pérdida de dígitos), errores de dominio (`AppError` con `kind`/`code`), IDs UUIDv7 en CHAR(36) y fechas UTC mostradas en America/Mexico_City. Vitest 5 instalado; 22 pruebas (0.1+0.2, 197.25, 395 piezas). `@types/node` actualizado a 24.
- BAS-07 verificado: Vitest con proyectos `unit` e `integration`; integración siempre contra `almacen_test` (candado que rechaza bases sin sufijo `_test`), migraciones aplicadas y tablas vaciadas antes de cada corrida. Prueba de transacción: commit, rollback por excepción y por restricción, y usuario de app sin DDL. 27 pruebas. `npm run check` exige MySQL local corriendo.
- BAS-12 verificado: sistema de diseño de `ui-ux-pro-max` persistido en `design-system/almacen/MASTER.md` (Minimal & Swiss, azul #2563EB, Inter). shadcn/ui (Radix, nova) ajustado a 44 px táctiles y español; Sonner sigue el tema; `motion` con reducedMotion="user". Prueba de contraste WCAG de tokens (44 pares, claro y oscuro) y `npm run verify:ui` con Playwright + Edge (11 comprobaciones).
- BAS-13 verificado: `AppShell` (barra lateral con indicador animado por `motion`, barra inferior móvil de 4 + «Más» en hoja, enlace para saltar al contenido), secciones Inventario/Movimientos/Ubicaciones/Conteos/Compras/Configuración con estado vacío, `loading.tsx`, `error.tsx` y 404 en español; `/` redirige a `/inventario`. `verify:ui` amplía a 32 comprobaciones. Prettier de Tailwind apunta a `globals.css`.
- BAS-04/05 verificados: Better Auth 1.7.7 + Prisma + MySQL (tablas user/session/account/verification, migración `auth_core`, IDs UUIDv7, telemetría apagada). Pruebas: registro, sesión, duplicado, contraseña corta/incorrecta, cierre de sesión; vía HTTP cookie HttpOnly y origen ajeno → 403. Versiones exactas en package.json + `.npmrc`; ADR 0001–0004 en `docs/adr/`. `npm run setup` = env + db + migraciones.
- 2026-10-02: el fundador ejecutó `npm run db:reset` con éxito (dev reconstruida con `init` + `auth_core`): BAS-03 completo. Pidió: rama `pruebas` en GitHub para subir el trabajo sin tocar `main`; commits sin coautor de Claude (se reescribieron los 9 mensajes antes del primer push); servidor de pruebas pospuesto (todo local hasta terminar); modo oscuro con interruptor deslizante.
- Modo oscuro verificado: `next-themes` + `ThemeToggle` (cielo día/noche, sol/luna con `motion`), persistente, claro por defecto; `verify:ui` 34 comprobaciones. `shadcn` movido a devDependencies; `npm audit --omit=dev` en 0 (aviso de `braces` solo en herramientas de desarrollo, sin parche).
- BAS-08 verificado: `.github/workflows/ci.yml` (push/PR a `pruebas` y `main`; MySQL 9.4 de servicio; setup, check, build y audit de producción). Primera corrida en GitHub exitosa (run 37085870641, 96 s). Para que un PR con prueba rota quede bloqueado falta que el fundador active en GitHub la regla de rama "Require status checks" (no hay `gh` instalado). BAS-09 a BAS-11 pospuestos.
- PLT-01 verificado: migración `tenancy` con `organization` (titular, zona horaria y moneda MXN por defecto) y `membership` (estado ACTIVE/DISABLED, única por empresa-usuario), llaves foráneas RESTRICT. Prueba con dos empresas: membresías múltiples, duplicados y referencias inexistentes rechazados, sin cascadas. `db:migrate` ahora también ejecuta `prisma generate` (Prisma 7 ya no lo hace solo).
- PLT-02 verificado: `/registro` con Server Action + Zod (mensajes en español, errores junto a cada campo, foco al primer error, mostrar/ocultar contraseña, autocompletado para administradores de contraseñas), correo normalizado a minúsculas. Hash propio scrypt OWASP (N=2^15, r=8, p=3) porque el de Better Auth quedaba bajo el mínimo; ADR 0003 actualizado. Componentes reutilizables `FormField` y `PasswordInput`. Pruebas: 4 unitarias de hash, 4 de integración de registro; `verify:ui` 38 comprobaciones (usa el servidor de desarrollo en :3000). Siguiente: PLT-03.
- PLT-03 verificado: `requireEmailVerification` (sin sesión hasta confirmar), enlace de un solo uso de 24 h, reenvío al intentar entrar y en `/verifica-tu-correo` con respuesta neutral; registro con correo existente idéntico a uno nuevo + aviso al dueño (sin enumeración). `src/platform/email` con conductores `memory` (pruebas) y `log` (desarrollo: `.local/mail` y página `/correos` solo en desarrollo); producción exige configurar proveedor (decidir al elegir hosting). Pantallas `/verifica-tu-correo` y `/correo-verificado`. Se corrigió el contraste de avisos con fondo tintado (texto normal, ícono en color). Siguiente: PLT-04.
- PLT-04 verificado: `/ingresar` (mensaje neutral, regreso seguro con `?siguiente=`, no verificados → `/verifica-tu-correo`), cierre de sesión en barra lateral y hoja «Más» con nombre y correo, pantallas de la app protegidas por `src/proxy.ts` (cookie) + `requireSession()` (base). Sesión 7 días, cookie HttpOnly/SameSite=Lax/Secure en producción. Hallazgo: Better Auth apaga la revisión CSRF con NODE_ENV=test; se forzó `disableOriginCheck: false`. `npm run db:seed` crea cuenta demo verificada + «Ferretería Demo» (solo en *_dev). `verify:ui` entra con la cuenta demo: 44 comprobaciones. Siguiente: PLT-05.
- 2026-10-02: el fundador tuvo problemas para entrar: escribía otra contraseña (la demo es aleatoria en `.env.local`); se le indicó cambiar `DEMO_PASSWORD` y correr `npm run db:seed`. Pidió modo oscuro gris (no azul) y pantallas de acceso con diseño de almacén animado: hecho con `WarehouseScene` (cajas que se acomodan, montacargas, tarjetas flotantes) y tokens zinc; verificado en claro/oscuro, móvil/escritorio y movimiento reducido. `verify:ui` oculta el indicador de desarrollo de Next (en móvil tapaba el interruptor). Siguiente: PLT-05.
- Tarjeta de acceso con forma de bodega (`WarehouseCard`: techo, franja de andén, cortina que sube); el fundador pidió quitar líneas de lámina y letrero.
- PLT-05 verificado: Configuración → Seguridad → «Sesiones activas» (dispositivo, última actividad, IP corta; cerrar una o «Cerrar las demás» con confirmación). Consultas propias limitadas al dueño (tokens nunca llegan al navegador; no se puede cerrar la sesión de otro). `cookieCache` desactivado explícitamente: cada petición valida en la base, la revocación es inmediata. Corregido desbordamiento en móvil por IPv6 expandida (`formatIp`). `verify:ui` 47 comprobaciones; nota: su prueba de sesiones cierra las demás sesiones de la cuenta demo. Siguiente: PLT-06.
- PLT-06 verificado: limitador propio en MySQL (`auth_throttle`, SQL atómico) para inicio de sesión (5/cuenta, 20/IP por 15 min), registro (10/IP/h) y reenvío (3/correo, 10/IP por 15 min), mensaje neutral «Demasiados intentos. Espera N minutos»; Better Auth `rateLimit` activado siempre con tabla `rateLimit` (HTTP 429). Requisito de producción: proxy que sobrescriba X-Forwarded-For. Correcciones en el camino: el cliente Prisma en caché de desarrollo no tomaba el regenerado (500 en /ingresar) — ahora se recrea solo; `next-themes` reemplazado por solución propia (aviso de `<script>` en React 19); `devIndicators: false` (la «N» tapaba el interruptor). 140 pruebas, `verify:ui` 48. Avance: 16 de 148 pasos hasta el lanzamiento limitado. Siguiente: PLT-07 (recuperación de contraseña).
- PLT-07 verificado: «¿Olvidaste tu contraseña?» en `/ingresar` → `/recuperar-contrasena` (respuesta neutral, 3/correo y 10/IP cada 15 min) → correo con enlace de un solo uso de 60 min → `/restablecer-contrasena` (política de 12–128, `no-referrer`). Al restablecer: cierra todas las sesiones, limpia el bloqueo de la cuenta, confirma el correo si estaba pendiente y avisa por correo del cambio. 150 pruebas (10 nuevas de integración), `verify:ui` 58; recorrido completo con el enlace real en desarrollo (datos temporales borrados). Avance: 17 de 148. Siguiente: PLT-08A (alta de MFA con TOTP).
- PLT-08A verificado: complemento `twoFactor` de Better Auth (migración `two_factor`); Configuración → Seguridad → «Verificación en dos pasos»: contraseña → QR (`uqr`, SVG propio) + clave para escribir a mano + «Abrir en la app de este teléfono» (solo móvil) → código de 6 números → activada, sesión rotada y aviso por correo. Límite: 5 fallos/15 min por usuario (la contraseña correcta reinicia). Corregido: tras rotar la sesión en una acción, `getCurrentSession` leía la cookie vieja de `headers()` y mandaba a `/inventario`; ahora usa `cookies()`. 161 pruebas, `verify:ui` 63 (no activa MFA en la cuenta demo); alta completa probada en navegador con cuentas temporales (borradas). Pendiente inmediato: con MFA activa el inicio de sesión aún no pide el código (PLT-08B). Aviso de `npm audit`: `braces` (alto) en herramientas de ESLint, sin arreglo compatible; no llega a producción. Avance: 18 de 148. Siguiente: PLT-08B.

## Preguntas prioritarias pendientes

1. Empleados y movimientos diarios del primer cliente; referencia ya aportada de aproximadamente 1,000 productos.
2. Equipo, experiencia, horas disponibles, presupuesto mensual de infraestructura y precio deseado.
3. Ejemplos concretos de presentaciones y precisión necesaria; confirmar si hay empaques de contenido variable. Las conversiones y la operación con internet ya están aprobadas.
4. Resolver la facturación de nuestras suscripciones; facturar ventas del cliente queda fuera del inventario inicial.
5. Validar los niveles de capacidad y precios propuestos, y si el número de usuarios será también un límite comercial.

## Historial de decisiones

- 2026-10-01: confirmados México, ferreterías, UI/UX sencillo, SAP como referencia y una sola ferretería con zonas/pasillos/estantes. Se sustituye la implementación temprana de multi-almacén por ubicación interna y reubicaciones. La arquitectura modular y el modelo de suscripción se conservan.
- 2026-10-01: confirmadas unidades amplias y presentaciones configurables por el tendero, así como conexión a internet obligatoria en v1. Se agregan cuatro jornadas específicas para conversiones; estimación base pasa de 60 a 64 jornadas.
- 2026-10-01: el fundador estima 1,000 productos para la ferretería inicial y confirma planes por cantidad de productos, desde aproximadamente 100 hasta miles. Los umbrales exactos, precios y definición de producto facturable siguen como propuestas.
- 2026-10-02: único tipo de usuario e inicio de fase 1 confirmados; seguimiento del usuario pide continuar. Se implementó prototipo y documentación de definición, con resultados técnicos y validación externa pendiente separados.
- 2026-10-02: se crea cuestionario de investigación por solicitud del fundador; no cambia alcance ni completa validación. Los hallazgos futuros deben distinguir observación, cita e interpretación antes de modificar requisitos.

- 2026-10-02: el fundador define modelo modular: Inventario base obligatorio, módulos individuales con precio por nivel, usuarios incluidos + extra, roles predefinidos (reemplaza perfil único), lanzamiento Inventario + Compras, Ventas con POS primero, equipo fundador + IA a medio tiempo. Plan v0.6 en 224 pasos revisado con Codex.

## Preguntas para la siguiente ronda

- Número habitual de productos, usuarios, ubicaciones y movimientos diarios; unidades fraccionarias, lotes, caducidades, series o variantes.
- Dispositivos y lectores de códigos; ejemplos anonimizados de los archivos actuales.
- Número de cuentas por empresa (solo hay un tipo de usuario), posible administración de varias empresas y acceso de soporte.
- Posibilidad de conseguir 3–5 negocios piloto y principal problema que pagarían por resolver.
- Nombre comercial, persona o empresa vendedora, alcance del soporte y responsable del mantenimiento.

## Cómo mantener esta memoria

- Registrar las respuestas del usuario como decisiones confirmadas y actualizar el plan sin borrar el motivo de cambios importantes.
- No convertir una recomendación o supuesto en requisito confirmado.
- Actualizar estado, evidencia de validación y siguiente jornada al terminar cada etapa.
- Nunca guardar credenciales, secretos ni inventarios reales en este archivo.
