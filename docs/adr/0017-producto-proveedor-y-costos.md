# ADR 0017 — Relación producto-proveedor y último costo

Fecha: 2026-10-10 · Estado: aceptada (un punto a confirmar por el fundador) · Paso: CMP-03

## Contexto

Para pedirle a un proveedor hay que saber qué productos vende, con qué código los conoce él y cómo los vende (por caja, por rollo). Compras necesita además recordar cuánto costó la última vez. La matriz de permisos aprobada fija dos reglas que condicionan el diseño: los costos son privados de Compras (Consulta y Almacén no los ven en ninguna pantalla, PDF, reporte ni exportación) y `purchasing.cost.record` no ofrece una edición libre del costo: se captura dentro de una orden o recepción.

## Decisión

- **Un vínculo por producto y proveedor** (`product_supplier`): código del proveedor, presentación de compra y último costo. Lo administra el módulo Compras (`src/modules/purchasing/product-suppliers.ts`) sobre el catálogo y los contactos del núcleo.
- **La presentación de compra es una de las del producto** (o ninguna: se compra por su unidad). La relación con la tabla de presentaciones es compuesta con el producto, así que la base impide elegir la caja de otro producto. El vínculo solo dice cómo se compra; el contenido de la presentación es el del catálogo y nunca se cambia desde aquí.
- **El último costo no se teclea.** Lo escribe `recordLastCost` dentro de la transacción de una compra (órdenes y recepciones, CMP-04 y CMP-13), después de que ese servicio comprobó `purchasing.cost.record`. No hay pantalla ni acción que lo edite por separado. Se guarda el importe (pesos, antes de impuestos, hasta 4 decimales, decimal exacto), la fecha y **por qué se pagó**: la versión de la presentación comprada, o nada si fue por unidad. Así «$250.50 por caja de 100 piezas» sigue siendo cierto aunque después la caja cambie a 120.
- **El costo no sale del servicio para quien no puede verlo.** Las consultas del vínculo solo incluyen las columnas de costo cuando la persona tiene `purchasing.cost.read`; para los demás el campo no existe en la respuesta (no viaja vacío ni oculto). Esto vale igual en la ficha del proveedor y en la del producto.
- **Sin borrar vínculos por ahora.** La matriz no define ese permiso; un vínculo equivocado se corrige editándolo. Un producto o proveedor archivado conserva sus vínculos y se muestra como archivado.

## Consecuencias

- Hasta que existan las órdenes de compra (CMP-04) los vínculos muestran «Sin costo todavía». Es coherente con la matriz, pero significa que el fundador no puede cargar a mano los costos que ya conoce.
- Toda pantalla, PDF, reporte o exportación que muestre datos de Compras debe pedir el costo por esta misma vía o repetir la regla (CMP-16 lo audita; NEG-04 y NEG-25).
- `recordLastCost` devuelve `false` si el producto no está vinculado con ese proveedor: el paso que registre compras decide si crea el vínculo en ese momento.

## A confirmar por el fundador

1. Si quiere poder capturar un «costo de referencia» al vincular un producto, antes de tener la primera compra. Implicaría un permiso o una regla nueva en la matriz.
