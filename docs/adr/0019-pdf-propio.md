# ADR 0019 — Documentos PDF generados sin dependencias

Fecha: 2026-10-10 · Estado: aceptada · Paso: CMP-06A

## Contexto

La orden de compra se entrega o se envía al proveedor como PDF. Después vendrán otros documentos del mismo tipo (recepciones, reportes, cotizaciones). El proyecto ya escribe sus hojas de cálculo con un escritor propio (IMP-03) para saber exactamente qué contiene un archivo que sale del sistema.

## Decisión

- **Un escritor de PDF propio y pequeño** (`src/platform/files/pdf.ts`), sin dependencias: páginas tamaño carta con texto, líneas y cajas. Es suficiente para documentos de negocio y cada byte del archivo se escribe ahí.
- **Tipografía estándar:** Helvetica y Helvetica-Bold, que todo lector de PDF trae; no se incrusta ninguna fuente. El texto va en Windows-1252 (acentos, «», ¿¡, ×). Un carácter que la fuente no tiene se imprime como «?» en lugar de romper el archivo. Las medidas de cada letra (para alinear a la derecha y partir renglones) son las métricas publicadas de esas fuentes.
- **Sin contenido activo:** el archivo solo contiene páginas, fuentes y texto. El escritor no tiene forma de producir scripts, formularios, vínculos ni archivos incrustados, diga lo que diga el texto.
- **El texto siempre es dato:** cada cadena se escribe como literal de PDF con `\`, `(` y `)` escapados. Un producto llamado como una instrucción de PDF se imprime tal cual.
- **Sin compresión:** estos documentos pesan unos kilobytes y un archivo legible con un editor de texto es más fácil de revisar y de probar.
- **La orden en PDF** (`src/modules/purchasing/order-pdf.ts`) la descarga quien tiene `purchasing.order.export` (Consulta no: lleva precios), por una ruta `GET` que responde como adjunto, sin caché y sin dejar adivinar el tipo. Un borrador o una orden cancelada lo dicen en el encabezado. Cada descarga queda en la bitácora.

## Consecuencias

- Emojis y alfabetos fuera de Windows-1252 no se imprimen (salen como «?»). Para un negocio en México es aceptable; si hiciera falta, habría que incrustar una fuente.
- No hay logotipo ni imágenes todavía. Agregarlos es ampliar el escritor (un objeto de imagen), no cambiar de enfoque.
- Del negocio solo se imprime su nombre: la empresa todavía no guarda RFC, dirección ni teléfono propios. Cuando existan (datos fiscales del negocio), se agregan al encabezado.
- Verificado abriendo el archivo en el visor de PDF de Edge (motor de Adobe). Antes del piloto conviene abrirlo también en un teléfono y en el correo del proveedor.
