# Arquitectura de SaaS Almacén

Material para entender y explicar el sistema: qué tecnologías usa, por qué, cómo está organizado y qué patrones protegen los datos.

| # | Documento | Responde |
| --- | --- | --- |
| 1 | [Stack](01-stack.md) | ¿Qué tecnologías usamos y por qué se eligieron? ¿Qué se descartó? |
| 2 | [Estructura de carpetas](02-estructura.md) | ¿Dónde está cada cosa? ¿Qué puede importar a qué? ¿Dónde va algo nuevo? |
| 3 | [Patrones de diseño](03-patrones.md) | ¿Qué patrones usamos, dónde y qué problema resuelve cada uno? |
| 4 | [Recorrido del código](04-recorrido-del-codigo.md) | ¿Qué pasa, archivo por archivo, al registrar una entrada o cobrar una venta? |
| 5 | [Calidad y operación](05-calidad-y-operacion.md) | ¿Cómo se prueba, se asegura y se despliega? |

## El sistema en un minuto

- **Qué es:** un SaaS de inventario para pymes mexicanas. Se contrata por módulos sobre una base de **Inventario**: **Compras** y **Ventas** (punto de venta, cotizaciones, pedidos y ventas a plazos). CRM está anunciado, todavía no construido.
- **Cómo está hecho:** una sola aplicación **Next.js 16 + React 19 + TypeScript** con **MySQL 9.4** y **Prisma 7**. Es un **monolito modular**: un núcleo (`src/platform`) que no conoce a los módulos y módulos (`src/modules`) que se registran por contrato. Un **worker** aparte procesa importaciones, correos y recordatorios.
- **Qué lo hace confiable:**
  - Cada consulta está atada a una empresa.
  - Las existencias son un historial inmutable con saldo.
  - Las operaciones bloquean filas en orden fijo y llevan una clave contra duplicados.
  - El dinero se maneja con decimales exactos.
  - La base de datos repite las reglas críticas.
- **En números (noviembre de 2026):** 81 tablas, 75 migraciones, unas 92 mil líneas de TypeScript en `src`, 179 archivos de pruebas y 31 decisiones registradas.

## Decisiones (ADR)

Cada decisión importante tiene un registro con su contexto, las alternativas y sus consecuencias, en [`docs/adr/`](../adr/):

| Tema | ADR |
| --- | --- |
| Base técnica | [0001 Stack](../adr/0001-stack-aplicacion.md) · [0002 Base de datos](../adr/0002-base-de-datos.md) · [0003 Autenticación](../adr/0003-autenticacion.md) · [0004 Interfaz](../adr/0004-interfaz.md) |
| Empresas y permisos | [0005 Empresas](../adr/0005-empresas.md) · [0006 Bitácora](../adr/0006-bitacora.md) · [0009 Personal de plataforma](../adr/0009-personal-de-plataforma.md) · [0029 Acceso de soporte](../adr/0029-acceso-de-soporte.md) |
| Módulos y cobro | [0007 Módulos](../adr/0007-modulos.md) · [0008 Modelo comercial](../adr/0008-modelo-comercial.md) · [0027 Pagos manuales](../adr/0027-pagos-manuales.md) · [0028 Compra en línea](../adr/0028-compra-en-linea.md) |
| Inventario | [0010 Ubicación inicial](../adr/0010-instalacion-y-ubicacion-inicial.md) · [0011 Jerarquía de ubicaciones](../adr/0011-jerarquia-de-ubicaciones.md) · [0012 Movimientos y saldos](../adr/0012-movimientos-y-saldos.md) · [0015 Importación de salidas](../adr/0015-importacion-de-salidas.md) · [0031 Costo promedio](../adr/0031-costo-promedio.md) |
| Compras | [0016 Contactos](../adr/0016-contactos.md) · [0017 Producto-proveedor y costos](../adr/0017-producto-proveedor-y-costos.md) · [0018 Órdenes de compra](../adr/0018-ordenes-de-compra.md) · [0020 Envío por correo](../adr/0020-envio-de-ordenes-por-correo.md) · [0021 Recepción](../adr/0021-recepcion-de-ordenes.md) |
| Ventas | [0030 Definición de ventas](../adr/0030-ventas-definicion.md) |
| Infraestructura | [0013 Cola de trabajos](../adr/0013-cola-de-trabajos.md) · [0014 Archivos privados](../adr/0014-archivos-privados.md) · [0019 PDF propio](../adr/0019-pdf-propio.md) · [0022 Sitio público](../adr/0022-sitio-publico.md) · [0023 Correo](../adr/0023-correo-smtp.md) · [0024 Despliegue](../adr/0024-despliegue-vps.md) · [0025 Alertas](../adr/0025-alertas-operativas.md) · [0026 Aceptación de documentos](../adr/0026-aceptacion-de-documentos.md) |
