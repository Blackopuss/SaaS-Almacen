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
- Después: **8.5/10** (tres rondas). Lo que falta para 10 está en «Pendientes».

## Hallazgos y cambios

| # | Hallazgo (antes) | Gravedad | Cambio |
| --- | --- | --- | --- |
| 1 | Tres botones de salida con nombres distintos: «Registrar salida», «Salida rápida» y la importación. Quien empieza no sabe cuál usar. | 3 | Una sola salida, «Registrar salida» (sirve para uno o varios productos), en Inicio, Movimientos y la ficha. |
| 2 | El menú tenía 7 secciones, entre ellas Ubicaciones, que se configura una vez. | 2 | Ubicaciones pasa a Configuración («Tu negocio»). El menú queda con 6 y Configuración se marca al estar en Ubicaciones. |
| 3 | En Inventario, cada fila tenía «Entrada» y «Editar»; en móvil eran solo íconos sin texto (adivinanza). | 3 | La fila completa abre la ficha, con la cantidad a la derecha y una flecha. Las acciones viven en la ficha. |
| 4 | Inventario tenía cuatro enlaces sueltos arriba (archivados, importar, exportar, bajas) compitiendo con la búsqueda. | 2 | Botones «Agregar producto» e «Importar Excel». «Existencias bajas» aparece como aviso solo si hay productos acabándose. Exportar y archivados quedan al pie de la lista. |
| 5 | Movimientos: tres botones, tres enlaces con frases de explicación y cinco filtros siempre abiertos antes del historial. | 3 | Dos botones (entrada y salida). Enlaces con nombres claros, sin explicación: «Cambiar de lugar», «Corregir existencias», «Saldo inicial». Fechas, tipo y persona plegados en «Más filtros». «Reversar» va a la derecha de cada movimiento. |
| 6 | La ficha del producto tenía hasta cinco botones arriba y el mínimo en una tarjeta aparte con una ayuda de dos líneas. | 2 | Dos botones («Entrada», «Salida») y una fila de enlaces (Editar, Cambiar de lugar, Corregir existencias). El aviso de mínimo («Avisarme cuando queden…») va dentro de Existencias. Orden: existencias, movimientos, datos. |
| 7 | Inicio mostraba siempre «Uso de tu plan» (cupo y personas): dato administrativo que no se usa a diario. | 2 | El plan aparece solo como aviso cuando hace falta (más del 80 %, lleno o vencido). |
| 8 | La guía de primeros pasos tenía párrafos de tres renglones. | 2 | Una línea por paso y botones cortos («Subir Excel», «Capturar existencias»). |
| 9 | Compras empezaba con tres tarjetas grandes con descripción antes de las órdenes. | 2 | Botones «Nueva orden» y «Qué pedir»; «Proveedores» y «Reportes» como enlaces. Las órdenes se ven sin desplazarse. |
| 10 | Descripciones bajo el título que repetían el nombre («Qué hay, cuánto y dónde está», «Entradas, salidas, reubicaciones y ajustes»). | 1 | Quitadas. Solo quedan las que dicen algo nuevo. |
| 11 | Ayudas de campo largas en el alta de producto, conteos y salida. | 1 | Recortadas a una línea o quitadas cuando la etiqueta basta. |
| 12 | El logotipo llevaba a Inventario, no al Inicio. | 1 | Lleva a Inicio. |

## Segunda ronda: alta, edición, importar y exportar

| # | Hallazgo (antes) | Gravedad | Cambio |
| --- | --- | --- | --- |
| 13 | Importar mostraba primero la plantilla con un párrafo y cinco reglas; subir el archivo quedaba en segundo plano. | 2 | Paso 1 empieza con «Sube tu Excel». La plantilla son dos enlaces y las reglas van plegadas en «Cómo llenarla». |
| 14 | Las tres pantallas de importar no decían en qué paso ibas. | 2 | Indicador «1 Subir archivo · 2 Columnas · 3 Revisar y confirmar» en las tres. |
| 15 | En Columnas había que elegir los decimales siempre (sin opción marcada) y, si no, salía un error. Luego, 11 selectores con su explicación aunque las columnas ya se habían reconocido. | 3 | Decimales con punto marcado de inicio (lo normal en México). Si se reconocieron las columnas obligatorias, la lista queda plegada («Reconocimos tus columnas»). |
| 16 | Columnas pedía «Guardar columnas» y después buscar otro botón para seguir. | 3 | Un botón, «Revisar productos», que guarda y lleva a la revisión. |
| 17 | La revisión listaba los productos dos veces («Qué pasará…» y «Así se entienden tus filas»). | 2 | Una sola lista: qué pasa con cada producto y, debajo, cómo se leyó (unidad, presentación, existencia, mínimo). Contadores en cero ocultos; avisos de cupo en una línea; enlace directo para subir el archivo corregido. |
| 18 | Importar salidas repetía el mismo esquema (plantilla, reglas, decimales sin marcar). | 2 | Mismo arreglo: subir primero, plantilla y reglas plegadas, punto marcado. La revisión de salidas ya era clara y no cambió. |
| 19 | Exportar tenía tres tarjetas con dos botones cada una (tres azules compitiendo) y un párrafo técnico al pie. Su título («Exportar a Excel») no coincidía con el enlace. | 2 | Una lista: cada descarga con «Excel» y «CSV». Título «Descargar en Excel», igual que el enlace. |
| 20 | Editar producto volvía a Inventario en vez de a la ficha, y para piezas mostraba «Precisión: se maneja en enteros» (nada que elegir). | 2 | «Volver al producto». Para unidades enteras ya no se muestra precisión. Presentaciones y Archivar con una línea de texto. |

## Tercera ronda: Compras y Conteos por dentro

| # | Hallazgo (antes) | Gravedad | Cambio |
| --- | --- | --- | --- |
| 21 | En una orden en borrador, «Confirmar orden» estaba al pie; arriba solo había «Descargar PDF» y «Editar datos». | 3 | Arriba va la acción del día según el estado: «Confirmar orden» (borrador) o «Recibir mercancía» (enviada). PDF y editar pasan a enlaces junto al estado. |
| 22 | Los datos de la orden y del proveedor mostraban renglones con «—» (sin fecha esperada, sin notas, sin RFC…). | 2 | Solo se muestran los datos que existen. |
| 23 | «Nueva orden» obligaba a elegir proveedor aunque solo hubiera uno, y desde la ficha del proveedor no se podía empezar una orden. | 2 | Con un solo proveedor ya viene elegido; la ficha del proveedor tiene «Nueva orden». |
| 24 | Párrafos de explicación al pie de cada orden (hasta tres renglones) y en el diálogo de recibir. | 1 | Una línea por estado; recibir dice «Ya viene lo que falta. Si algo no llegó, déjalo en 0.». |
| 25 | El conteo tenía «Cancelar conteo» como botón principal arriba y un párrafo largo al pie. | 2 | Arriba solo «Aplicar conteo» cuando hay diferencias; cancelar va al final; una línea de ayuda. |

La importación mantiene sus garantías: nada se guarda hasta confirmar, la
revisión vuelve a leer y validar cada fila, y el servidor sigue exigiendo el
separador decimal (solo cambió que la pantalla lo trae marcado).

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
- Nombres de tipos de movimiento («Reversa», «Saldo inicial») vienen del
  servicio y de sus pruebas. Si se cambian, se cambian ahí.
