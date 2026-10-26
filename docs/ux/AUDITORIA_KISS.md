# Auditoría KISS de la app (pantallas internas)

Fecha: 2026-10-26. Alcance: lo que se ve después de iniciar sesión. El acceso
(`/ingresar`, registro) y el sitio público quedan como están: al fundador le
gustan.

Método: skills `ux-heuristics` (leyes de Krug y heurísticas de Nielsen) e
`impeccable` (`critique` y `distill`, modo «Operate»), aplicadas sobre capturas
reales de la app en escritorio (1280 px) y móvil (390 px), con una empresa vacía
y con productos y movimientos de ejemplo.

Pregunta guía: ¿una persona que nunca usó un sistema de inventario puede
registrar lo que llegó y lo que salió sin dar vueltas ni leer párrafos?

## Calificación

- Antes: **6/10**. Nada bloqueaba una tarea, pero había varios problemas mayores
  (gravedad 3): demasiadas formas de hacer lo mismo, acciones repartidas en
  lugares distintos y mucho texto que nadie lee.
- Después: **8/10**. Lo que falta para 10 está en «Pendientes».

## Hallazgos y cambios

| # | Hallazgo (antes) | Gravedad | Cambio |
| --- | --- | --- | --- |
| 1 | Tres botones de salida con nombres distintos: «Registrar salida», «Salida rápida» y la importación. Quien empieza no sabe cuál usar. | 3 | Una sola salida, «Registrar salida» (sirve para uno o varios productos), en Inicio, Movimientos y la ficha. |
| 2 | El menú tenía 7 secciones, entre ellas Ubicaciones, que se configura una vez. | 2 | Ubicaciones pasa a Configuración («Tu negocio»). El menú queda con 6 y Configuración se marca al estar en Ubicaciones. |
| 3 | En Inventario, cada fila tenía «Entrada» y «Editar»; en móvil eran solo íconos sin texto (adivinanza). | 3 | La fila completa abre la ficha, con la cantidad a la derecha y una flecha. Las acciones viven en la ficha. |
| 4 | Inventario tenía cuatro enlaces sueltos arriba (archivados, importar, exportar, bajas) compitiendo con la búsqueda. | 2 | Botones «Agregar producto» e «Importar Excel». «Existencias bajas» aparece como aviso solo si hay productos acabándose. Exportar y archivados quedan al pie de la lista. |
| 5 | Movimientos: tres botones, tres enlaces con frases de explicación y cinco filtros siempre abiertos antes del historial. | 3 | Dos botones (entrada y salida). Enlaces con nombres claros, sin explicación: «Cambiar de lugar», «Corregir existencias», «Saldo inicial». Fechas, tipo y persona plegados en «Más filtros». «Reversar» queda en la misma línea de la fecha. |
| 6 | La ficha del producto tenía hasta cinco botones arriba y el mínimo en una tarjeta aparte con una ayuda de dos líneas. | 2 | Dos botones («Entrada», «Salida») y una fila de enlaces (Editar, Cambiar de lugar, Corregir existencias). El aviso de mínimo («Avisarme cuando queden…») va dentro de Existencias. Orden: existencias, movimientos, datos. |
| 7 | Inicio mostraba siempre «Uso de tu plan» (cupo y personas): dato administrativo que no se usa a diario. | 2 | El plan aparece solo como aviso cuando hace falta (más del 80 %, lleno o vencido). |
| 8 | La guía de primeros pasos tenía párrafos de tres renglones. | 2 | Una línea por paso y botones cortos («Subir Excel», «Capturar existencias»). |
| 9 | Compras empezaba con tres tarjetas grandes con descripción antes de las órdenes. | 2 | Botones «Nueva orden» y «Qué pedir»; «Proveedores» y «Reportes» como enlaces. Las órdenes se ven sin desplazarse. |
| 10 | Descripciones bajo el título que repetían el nombre («Qué hay, cuánto y dónde está», «Entradas, salidas, reubicaciones y ajustes»). | 1 | Quitadas. Solo quedan las que dicen algo nuevo. |
| 11 | Ayudas de campo largas en el alta de producto, conteos y salida. | 1 | Recortadas a una línea o quitadas cuando la etiqueta basta. |
| 12 | El logotipo llevaba a Inventario, no al Inicio. | 1 | Lleva a Inicio. |

## Qué no cambió (a propósito)

- Ningún servicio, permiso, regla de negocio ni ruta. Las pantallas siguen
  pidiendo los mismos permisos. Los cambios son de interfaz y de textos.
- `/movimientos/salida` sigue existiendo (por enlaces guardados), pero ya no se
  enlaza: la salida de la app es `/movimientos/salida-rapida`.
- Textos de seguridad (verificación en dos pasos, sesiones) y mensajes de error
  de los servicios: los revisan pruebas y auditorías propias.
- Sistema visual (colores, tipografía, modo oscuro): el problema era de
  organización, no de estética.

## Pendientes para llegar a 10/10

- Probar con 3 a 5 personas reales (método de Krug: tareas como «llegaron 3
  cajas de tornillos, regístralas» y observar sin ayudar). Ninguna auditoría
  sustituye eso.
- Importación de productos: la pantalla todavía explica mucho (plantilla,
  reglas y salidas diarias en la misma página). Conviene un asistente de tres
  pasos.
- Pantallas de Compras por dentro (orden, recepción, proveedor) y de Conteos
  por dentro: no se revisaron a fondo en esta ronda.
- Nombres de tipos de movimiento («Reversa», «Saldo inicial») vienen del
  servicio y de sus pruebas. Si se cambian, se cambian ahí.
