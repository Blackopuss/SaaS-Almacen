# Memoria del proyecto

Actualizada: 2026-10-01, zona America/Mexico_City.

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

## Estado real

- Carpeta inicialmente vacía; se crearon documentos de planeación, sin código ni servicios desplegados.
- Plan completo: `docs/PLAN_IMPLEMENTACION.md`.
- Se consultaron fuentes oficiales de Next.js, shadcn/ui, Prisma, Better Auth, Stripe, OWASP y legislación mexicana; enlaces en el plan.
- No se han contratado proveedores, fijado precios, redactado contratos finales ni validado cumplimiento legal.
- Plan actualizado a v0.4: capacidad por plan separada de módulos; niveles propuestos, reglas de cupos, concurrencia/importaciones y cambios de plan. Se conservan las 64 jornadas porque el plan ya incluía capacidades, cobro y validación de límites; reestimar al concretar reglas en D06.
- Próxima actividad: precisar usuarios, movimientos diarios, equipo y presupuesto; validar niveles/precios y ejecutar D01 si el usuario pide comenzar.

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

## Preguntas para la siguiente ronda

- Número habitual de productos, usuarios, ubicaciones y movimientos diarios; unidades fraccionarias, lotes, caducidades, series o variantes.
- Dispositivos y lectores de códigos; ejemplos anonimizados de los archivos actuales.
- Si una persona administrará varias empresas; permisos para empleados y acceso de soporte.
- Posibilidad de conseguir 3–5 negocios piloto y principal problema que pagarían por resolver.
- Nombre comercial, persona o empresa vendedora, alcance del soporte y responsable del mantenimiento.

## Cómo mantener esta memoria

- Registrar las respuestas del usuario como decisiones confirmadas y actualizar el plan sin borrar el motivo de cambios importantes.
- No convertir una recomendación o supuesto en requisito confirmado.
- Actualizar estado, evidencia de validación y siguiente jornada al terminar cada etapa.
- Nunca guardar credenciales, secretos ni inventarios reales en este archivo.
