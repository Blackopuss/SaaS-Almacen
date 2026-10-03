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
- BAS-02 verificado: capas `app`, `components`, `lib`, `server`, `platform/*`, `modules/*` con eslint-plugin-boundaries v7 (solo `index.ts` entre módulos; plataforma nunca depende de módulos; también detecta `typeof import()` tras revisión de Codex). `npm run lint:boundaries` prueba 9 casos. Trabajo en rama `feature/bas-fundacion`. - BAS-03 verificado: Prisma 7.10 + adapter MariaDB sobre MySQL 9.4 local; usuarios `almacen_app` (solo datos) y `almacen_migrator` (esquema); bases dev/test/shadow; migración `init` vacía aplicada en dev y test. `npm run db:check` prueba conexión y que la app no puede alterar el esquema. Vulnerabilidades altas de `mariadb`/`mysql2`/`deepmerge-ts` corregidas con `overrides`; `npm audit` en 0. Prueba de `db:reset` pendiente: requiere consentimiento explícito del fundador. Siguiente: BAS-04 según orden acordado (BAS-06, BAS-07, BAS-12, BAS-13, luego BAS-04/05).

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
