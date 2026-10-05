# ADR 0011 — Jerarquía de ubicaciones

Fecha: 2026-10-04 · Estado: aceptada · Paso: INV-14

## Contexto

El fundador confirmó una sola ferretería con zonas, pasillos y estantes nombrados por el negocio, con una interfaz muy sencilla. El plan pide una jerarquía sin ciclos y niveles opcionales: un negocio pequeño puede tener solo estantes. INV-13 dejó una instalación «Principal» con su ubicación «General» (ADR 0010).

## Decisión

- **Tres tipos fijos, nombres libres.** `location.kind` es `ZONE`, `AISLE` o `SHELF` (más `GENERAL`, reservado a la ubicación inicial). El negocio elige el nombre; el tipo solo dice qué puede contener: una zona contiene pasillos y estantes, un pasillo contiene estantes, un estante no contiene nada. Cualquier tipo puede colgar directamente de la instalación (niveles opcionales).
- **Sin ciclos por construcción.** Una ubicación solo puede ir dentro de otra de tipo más amplio. Como el tipo nunca cambia y el orden es estricto, es imposible cerrar un ciclo sin importar el orden ni la simultaneidad de las escrituras; la profundidad máxima es 3. No hace falta recorrer el árbol para validar un movimiento. Las reglas puras viven en `src/platform/locations/kinds.ts`.
- **La base repite lo que puede.** Llave foránea compuesta `(organizationId, facilityId, parentId)` (el padre es de la misma empresa e instalación), `CHECK` contra ser su propio padre, y disparadores `location_tree_insert`/`location_tree_update` que rechazan un padre de tipo igual o más fino, el cambio de tipo, quitar la marca de «General» y nombres repetidos en la raíz. `location_no_delete` impide borrar: una ubicación se archiva.
- **Nombres únicos dentro de su padre**, sin distinguir mayúsculas ni acentos: «Estante 1» puede existir en dos pasillos. Índice único `(organizationId, facilityId, parentId, name)`; en la raíz `parentId` es `NULL` y MySQL no compara, así que lo hace el disparador. Una ubicación archivada conserva su nombre reservado (igual que la clave de un producto archivado).
- **Cambios en serie por empresa.** Cada escritura empieza tocando la fila de la instalación dentro de su transacción (el cliente de empresa no permite SQL directo, y una actualización retiene la fila hasta el final). Así dos personas reorganizando a la vez se aplican una tras otra y la segunda ve el resultado de la primera; por eso las comprobaciones de nombre y de «tiene ubicaciones dentro» no tienen carreras.
- **«General» es fija:** no se renombra, no se mueve, no se archiva y no contiene otras ubicaciones (`location_general_check` + servicio).
- **Archivar** (`archivedAt`): solo una ubicación sin ubicaciones activas dentro. Reactivar exige que su ubicación padre esté activa. Una ubicación activa siempre tiene ancestros activos. Ambas operaciones usan `inventory.location.archive`.
- **Límite técnico** de 1,000 ubicaciones por empresa (archivadas incluidas): el árbol se muestra y se ofrece completo en los selectores.
- **Servicios** en `src/platform/locations/hierarchy.ts`: `createLocation`, `renameLocation`, `moveLocation`, `archiveLocation`, `restoreLocation`, `listLocations` (árbol en orden de lectura, con profundidad y ruta «Zona A › Pasillo 2 › Estante 3»). Bitácora: `location.created`, `.renamed`, `.moved`, `.archived`, `.restored`.

## Consecuencias

- Mover una ubicación mueve todo lo que contiene sin tocar otras filas (solo cambia su `parentId`).
- Los movimientos de inventario (INV-15 en adelante) pueden referirse a cualquier ubicación activa y mostrar su ruta con `listLocations` o `formatLocationPath`.
- Pendiente para INV-15/INV-19B (caso NEG-21): no archivar una ubicación con existencias o documentos pendientes.
- Una corrección de la migración (`20261004141000_location_general_check`) reemplazó el primer `CHECK` de «General»: con `isDefault` nulo la expresión quedaba «desconocida» y un `CHECK` solo rechaza lo falso.

## Preguntas para el fundador

1. ¿Hace falta un cuarto nivel dentro del estante (cajón, gaveta o nivel)? Es común en tornillería. Agregarlo es una migración pequeña.
2. ¿Debe poder renombrarse la instalación «Principal» o la ubicación «General»? Hoy son fijas.
3. ¿Reactivar una ubicación debe pedir un permiso distinto al de archivarla? Hoy es el mismo.
4. Si una zona debe poder contener otra zona (por ejemplo «Bodega» dentro de «Planta alta»), la regla de tipos tendría que cambiar por una validación de ciclos recorriendo el árbol.
