# Guía de pruebas manuales

Actualizada: 2026-10-04 · Avance: 59 de 148 pasos (USR y MOD completas; Inventario hasta INV-09).

Sirve para recorrer a mano todo lo que ya existe y anotar lo que no te guste. Cada recorrido dice qué hacer y qué deberías ver. Al final hay una plantilla para darme la retroalimentación.

## 1. Preparar y entrar

1. Ten MySQL corriendo y, en la carpeta del proyecto, ejecuta `npm run dev`.
2. Abre `http://localhost:3000`.
3. Si es la primera vez o quieres dejar la cuenta demo en su estado inicial: `npm run db:seed`.

### Cuenta demo (titular de «Ferretería Demo»)

| Dato | Dónde está |
| --- | --- |
| Correo | `demo@almacen.test` (o `DEMO_EMAIL` en `.env.local`) |
| Contraseña | `DEMO_PASSWORD` en `.env.local` |
| Código de dos pasos | `npm run demo:codigo` (cambia cada 30 segundos y cada código sirve una sola vez) |

La Ferretería Demo ya tiene plan: Inventario y Compras, 1,000 productos y 5 usuarios.

### Los correos no salen de tu computadora

Todavía no hay proveedor de correo. Cada mensaje que la app «envía» aparece en `http://localhost:3000/correos`, con un botón para abrir su enlace. Úsalo para confirmar cuentas, restablecer contraseñas y aceptar invitaciones.

### Probar como otra persona

Abre una ventana de incógnito (o otro navegador) para la segunda persona; así no cierras tu sesión de titular.

## 2. Mapa de pantallas

| Dirección | Qué es | Quién entra |
| --- | --- | --- |
| `/registro`, `/ingresar` | Crear cuenta e iniciar sesión | Cualquiera |
| `/recuperar-contrasena` | Pedir enlace para cambiar contraseña | Cualquiera |
| `/correos` | Buzón local de correos (solo desarrollo) | Cualquiera |
| `/inicio` | Resumen del día: existencias bajas, últimos movimientos y uso del plan | Todos (cada bloque según permiso) |
| `/inventario` | Lista de productos con búsqueda, filtros, páginas y existencias | Quien pueda ver productos |
| `/inventario/importar` | Plantilla, subir archivo y elegir columnas para importar el catálogo | Titular, Administrador, Almacén |
| `/inventario/bajas` | Productos en su mínimo o por debajo | Quien pueda ver mínimos y existencias |
| `/inventario/<id>` | Ficha del producto: total, dónde está, equivalencias y últimos movimientos | Quien pueda ver productos |
| `/inventario/nuevo` | Alta de producto | Titular, Administrador, Almacén |
| `/inventario/<id>/editar` | Ficha, presentaciones y archivar | Titular, Administrador, Almacén |
| `/movimientos` | Historial con filtros (fechas, producto, persona, tipo) y botones para registrar | Quien pueda ver movimientos |
| `/movimientos/entrada`, `/salida`, `/reubicar`, `/ajuste`, `/saldo-inicial` | Registrar un movimiento de un producto | Titular, Administrador, Almacén (según permiso) |
| `/movimientos/salida-rapida` | Salida de varios productos en una sola confirmación | Quien pueda registrar salidas |
| `/ubicaciones` | Zonas, pasillos y estantes; «General» existe siempre | Según rol |
| `/conteos`, `/conteos/<id>` | Iniciar un conteo físico y capturar lo contado | Titular, Administrador, Almacén (Consulta solo lee) |
| `/compras` | Todavía vacía (solo el aviso de «sin datos») | Según rol |
| `/configuracion` | Seguridad (dos pasos, sesiones) y enlaces de empresa | Todos |
| `/configuracion/equipo` | Personas, roles e invitaciones | Titular y Administrador |
| `/configuracion/plan` | Mi plan: cupos, módulos y vigencia | Titular y Administrador |
| `/configuracion/bitacora` | Quién cambió qué y cuándo | Titular y Administrador |
| `/interno` | Consola interna para asignar planes | Solo personal de plataforma |

## 3. Recorridos

Marca cada uno como ✅ bien, ⚠️ funciona pero mejorable, o ❌ falla.

### A. Cuenta y acceso

**A1. Registro completo de un negocio nuevo**

1. En incógnito, entra a `/registro` y crea una cuenta con un correo inventado (por ejemplo `prueba1@example.test`) y contraseña de 12 caracteres o más.
2. Abre `/correos`, busca «Confirma tu correo» y abre su enlace.
3. Escribe el nombre del negocio y crea la empresa.
4. La app te obliga a activar la verificación en dos pasos: escanea el QR con una app de autenticación (Google Authenticator, Authy…) y escribe el código.
5. Guarda los códigos de recuperación que te muestra.

Deberías ver: no puedes entrar sin confirmar el correo; no puedes usar la app sin activar los dos pasos; al final llegas a Inventario con el aviso de que el módulo no está activo (una empresa nueva no tiene plan hasta que se le asigna; ver E1).

Nota: una empresa creada aquí ya no se puede borrar (su bitácora es permanente). No pasa nada; es tu base de desarrollo.

**A2. Iniciar sesión con dos pasos**

1. En `/ingresar` escribe correo y contraseña de la demo.
2. Escribe el código de `npm run demo:codigo`.

Deberías ver: con contraseña equivocada dice «Correo o contraseña incorrectos» (igual si el correo no existe); el mismo código no sirve dos veces; tras 5 intentos fallidos te pide esperar.

**A3. Entrar con un código de recuperación**

En la pantalla del código elige «¿No tienes tu teléfono? Usa un código de recuperación». Deberías ver: entra, ese código deja de servir y llega un correo de aviso a `/correos`.

**A4. Recuperar contraseña**

1. En `/ingresar` → «¿Olvidaste tu contraseña?», escribe el correo.
2. Abre el enlace desde `/correos` y elige una contraseña nueva.

Deberías ver: la misma respuesta exista o no el correo; el enlace sirve una sola vez; se cierran todas las sesiones y llega un correo de aviso.

**A5. Sesiones y dos pasos en Configuración**

En `/configuracion`: revisa «Sesiones activas» (abre sesión en otro navegador y ciérrala desde aquí) y «Verificación en dos pasos» (generar códigos nuevos). Deberías ver: un titular no puede desactivar los dos pasos.

### B. Equipo y roles

Con la cuenta demo, entra a `/configuracion/equipo`.

**B1. Invitar a una persona nueva**

1. «Invitar persona», correo inventado, rol Almacén.
2. Deberías ver la invitación en «Invitaciones pendientes» y el contador «2 de 5 usuarios de tu plan (incluye 1 invitación pendiente)».
3. En incógnito abre el enlace desde `/correos`, escribe nombre y contraseña.

Deberías ver: la persona entra directo, sin confirmar correo ni dos pasos; en su menú no aparece Compras; `/compras` y `/configuracion/equipo` le dicen «No tienes acceso».

**B2. Lo que ve cada rol**

Repite B1 con Comprador y Consulta (o cambia el rol desde «Roles»).

| Rol | Menú | Puede agregar productos |
| --- | --- | --- |
| Almacén | Inventario, Movimientos, Ubicaciones, Conteos | Sí |
| Comprador | Inventario, Movimientos, Ubicaciones, Compras | No (no ve el botón) |
| Consulta | Todas las secciones, solo lectura | No |
| Administrador | Todo, más Equipo, Mi plan y Bitácora | Sí |

Un Administrador debe activar los dos pasos antes de usar la app.

**B3. Cambiar roles y desactivar**

1. En Equipo, «Roles» de una persona: elige varios (por ejemplo Almacén y Comprador).
2. «Desactivar» a la persona, con motivo.

Deberías ver: los permisos se suman y sigue ocupando un solo lugar; al desactivarla, su sesión en la otra ventana se cierra de inmediato; puedes «Reactivar» y vuelve con los mismos roles; tú, como titular, no tienes botones sobre ti mismo.

**B4. Reenviar y cancelar invitaciones**

Invita a otro correo, pulsa «Reenviar» y luego «Cancelar». Deberías ver: tras reenviar, el enlace anterior ya no sirve («La invitación no es válida»); tras cancelar, tampoco el nuevo.

**B5. Límite de usuarios**

Invita hasta llenar los 5 lugares. Deberías ver: la siguiente invitación se rechaza con «Tu plan incluye 5 usuarios y ya están ocupados…»; al cancelar una invitación o desactivar a alguien se libera el lugar.

**B6. Reglas del Administrador**

Entra como un Administrador invitado. Deberías ver: no puede invitar ni nombrar a otro Administrador, no puede desactivar ni cambiar al titular, no puede cambiar sus propios roles.

### C. Bitácora

En `/configuracion/bitacora` deberías ver, del más reciente al más antiguo, todo lo que hiciste en B y D: invitaciones, cambios de rol (con rol anterior y nuevo), desactivaciones con su motivo, productos creados y editados, presentaciones. No hay forma de editar ni borrar un registro.

### D. Productos

**D1. Alta de producto**

1. `/inventario` → «Agregar producto».
2. Guarda sin llenar nada: deberías ver los errores junto a cada campo y el cursor en «Clave (SKU)».
3. Llena clave `TOR-001`, nombre, categoría «Tornillería» (escríbela, se crea sola), marca, código de barras.
4. Deja la unidad en Pieza.

Deberías ver: el aviso «Producto TOR-001 guardado» y el producto en la lista; en `/configuracion/plan` el cupo pasa a «1 de 1,000».

**D2. Claves repetidas**

Intenta crear otro producto con `tor-001` (minúsculas). Deberías ver: «Ya tienes un producto con esa clave», y lo que habías escrito sigue en el formulario.

**D3. Unidad y precisión**

Crea un producto «Cable» con unidad Metro. Deberías ver: aparece «Precisión de las cantidades» con 0.01 por defecto; si eliges Pieza, Par o Docena dice «Se maneja en enteros».

**D4. Editar la ficha**

En la lista, «Editar». Cambia el nombre y la marca. Deberías ver: «Cambios de … guardados»; guardar sin cambiar nada dice «No hay cambios que guardar»; no hay ningún campo de cantidad (las existencias se moverán con entradas y salidas, que aún no existen); el cambio aparece en la bitácora.

**D5. Presentaciones**

En la ficha del tornillo, sección «Presentaciones»:

1. Agrega «Caja» con 100. Deberías ver «Caja = 100 piezas».
2. Intenta agregar «Bolsa» con 12.5: se rechaza («piezas completas»). Con 0 o con texto, también.
3. En «Cambiar contenido» de la Caja escribe 120. Deberías ver «Caja = 120 piezas».
4. En el cable (metros) agrega «Rollo» con 100 y otro con 30.5: ambos se aceptan.

**D6. Archivar y reactivar**

1. En la ficha, «Archivar producto» → confirmar.
2. Deberías ver: desaparece de la lista, «Mi plan» baja un lugar, y aparece en «Ver productos archivados».
3. «Reactivar»: vuelve a la lista y ocupa su lugar otra vez.

### E. Plan, módulos y consola interna

**E1. Asignar plan a una empresa (consola interna)**

1. Hazte personal de plataforma una sola vez: `npm run staff -- add demo@almacen.test`.
2. Entra a `http://localhost:3000/interno`. Busca la empresa que creaste en A1.
3. Elige un nivel (por ejemplo «100 productos · 2 usuarios»), marca Inventario, escribe un motivo y «Asignar plan».

Deberías ver: «Plan asignado»; en la otra ventana, esa empresa ya puede usar Inventario; sin motivo no deja guardar; si quitas Inventario y dejas Compras lo rechaza («Compras necesita Inventario»); el cambio queda en la bitácora de esa empresa.

Para retirarte el acceso: `npm run staff -- remove demo@almacen.test`. Con cualquier cuenta que no sea personal, `/interno` muestra «página no encontrada».

**E2. Mi plan**

En `/configuracion/plan` deberías ver la vigencia, las barras de productos y usuarios, y los módulos: Inventario y Compras «Activo», Ventas y CRM «Próximamente».

**E3. Módulo no contratado**

Desde la consola, reasigna el plan de una empresa sin Compras. Deberías ver: Compras desaparece de su menú y `/compras` muestra el aviso de solo lectura (su historial se conserva).

**E4. Límite de productos**

Asigna a la empresa de prueba un cupo pequeño (por ejemplo 2) y crea 3 productos. Deberías ver: el tercero se rechaza con «Llegaste al límite de tu plan: 2 de 2 productos activos…»; al archivar uno, ya cabe otro.

**E5. Plan vencido**

En la consola pon «Vigente hasta» mañana para comprobar que se muestra la fecha en «Mi plan». (Para verlo vencido habría que esperar a que pase la fecha: entonces todo queda en solo lectura, sin perder datos.)

### F. Existencias y movimientos

Para estos recorridos conviene la base de pruebas (no ensucia desarrollo, porque los movimientos no se pueden borrar): `npm run dev:test` abre la app en `http://localhost:3100` y `npm run test:company -- "<contraseña de 12+ caracteres>" [warehouse|buyer|viewer|administrator]` crea ahí una empresa y te imprime el correo para entrar.

**F1. Lista de productos**

Crea más de 25 productos. Deberías ver: páginas con «Anterior/Siguiente», búsqueda por nombre, clave o código de barras (la coincidencia exacta aparece arriba), filtros por categoría y marca que se combinan y quedan en la dirección, y las existencias de cada producto.

**F2. Entrada, con cajas y otras unidades**

1. En un producto con presentación «Caja de 100», `/movimientos` → «Registrar entrada» → búscalo.
2. Captura `3` en «Caja»: antes de confirmar deberías ver «3 cajas × 100 = 300 piezas».
3. Confirma. Deberías ver el aviso de registro y el total actualizado en la ficha.
4. En un producto por metros, captura `275` en centímetros: se guardan `2.75 metros`.
5. Intenta `0.5` piezas en un producto que solo admite enteros: se rechaza junto al campo.

**F3. Saldo inicial**

`/movimientos/saldo-inicial`: captura lo que ya había de un producto sin movimientos. Deberías ver: se acepta una vez por ubicación; si el producto ya tiene otros movimientos, se rechaza y te manda a entrada o ajuste.

**F4. Salida y existencias que no bajan de cero**

Registra una salida mayor a lo que hay en la ubicación. Deberías ver: «Solo hay X… no pueden salir Y» y nada cambia.

**F5. Doble envío y conexión perdida**

1. Al confirmar un movimiento, da doble clic rápido: debe quedar un solo movimiento.
2. Con las herramientas del navegador pon la red en «Sin conexión» justo antes de confirmar: deberías ver «Verificando estado…» y, al volver la red, o te lleva al movimiento registrado o te dice que no se registró y puedes reenviarlo sin duplicar.

**F6. Reubicar**

Con dos ubicaciones, `/movimientos/reubicar`: mueve parte de un producto. Deberías ver: sale de una, entra a la otra, el total no cambia; origen y destino iguales se rechaza.

**F7. Ajuste**

`/movimientos/ajuste`: escribe lo que contaste. Deberías ver: se registra solo la diferencia (+ o −), el motivo es obligatorio y el ajuste aparece en la bitácora.

**F8. Reversa**

En el historial, «Reversar» un movimiento con motivo. Deberías ver: un movimiento «Reversa» que deshace las mismas cantidades (con el contenido de caja de aquel día), la etiqueta «Reversado» en el original y que no se puede reversar dos veces. Si reversar dejaría existencias negativas, se rechaza.

**F9. Ficha de producto**

`/inventario/<id>` (clic en el nombre): total, desglose por ubicación, equivalencia en presentaciones («250 piezas, equivalentes a 2 cajas de 100 y 50 piezas») y últimos movimientos, con «Ver historial completo».

**F10. Historial con filtros**

En `/movimientos` combina fechas «Desde/Hasta», producto (parte del nombre o la clave), persona y tipo. Deberías ver: el conteo de resultados, los filtros en la dirección (puedes recargar o compartirla), páginas de 25 que conservan los filtros y «Quitar filtros». Las fechas son días de tu zona horaria: un movimiento de las 11 de la noche cuenta en ese día.

**F11. Salida rápida de varias líneas**

1. `/movimientos` → «Salida rápida».
2. Escribe o escanea un código de barras o clave exacta y Enter: se agrega una línea y el cursor vuelve a la búsqueda. Repite el mismo código: la cantidad sube a 2.
3. Escribe parte de un nombre: elige de la lista.
4. Cambia una línea a «Caja» si el producto tiene presentación; si tiene existencias en varias ubicaciones, elige de cuál sale.
5. Pon en una línea más de lo que hay y confirma. Deberías ver: «No se registró nada…», el motivo en esa línea y las demás intactas.
6. Corrige, elige motivo (o «Otro» y escríbelo), agrega una referencia y confirma. Deberías ver: un solo movimiento «Salida» con todas las líneas, y las existencias de cada producto abajo.

No cobra, no maneja precios ni genera ticket: solo registra lo que sale.

**F12. Lector de códigos (pendiente de probar con tu lector real)**

Un lector que «escribe como teclado» teclea el código y manda Enter; no necesita configuración. Con productos que tengan código de barras y existencias:

1. `/inventario`: clic en la búsqueda y escanea. Deberías ver el producto como «Coincidencia exacta».
2. `/movimientos/entrada` (o `/salida`): escanea. Deberías llegar directo al formulario de ese producto con el cursor en la cantidad; teclea la cantidad y Enter para registrar.
3. `/movimientos/salida-rapida`: escanea 10 productos seguidos, sin esperar entre uno y otro, y repite alguno. Deberías ver una línea por producto en el orden escaneado, el repetido con cantidad 2, y el cursor siempre en la búsqueda. Confirma y toma el tiempo: la meta es menos de 2 minutos para 10 líneas.

Dime la marca y modelo del lector, y si alguna lectura se perdió, se duplicó o cayó en otro campo. (Simulado con teclado automático pasa en segundos; falta confirmarlo con el aparato.)

**F13. Mínimos y existencias bajas**

1. Abre la ficha de un producto y escribe su «Mínimo» (por ejemplo 10) → «Guardar». Deberías ver «Mínimo: 10 piezas» junto al total.
2. Registra salidas hasta dejarlo en 10 o menos. Deberías ver la etiqueta «Existencias bajas» en la ficha («Agotado» si queda en cero).
3. `/inventario` → «Existencias bajas» (muestra cuántos hay). Deberías ver la lista con lo que hay, lo que falta para el mínimo y el botón «Entrada»; primero los más vacíos.
4. Registra una entrada que lo deje por encima: desaparece de la lista sin hacer nada más.
5. Borra el mínimo (deja el cuadro vacío y guarda): deja de avisar.

En un producto por piezas, un mínimo de `0.5` debe rechazarse. Los productos archivados no aparecen.

**F14. Conteo físico: captura**

1. `/conteos` → elige una ubicación, escribe una nota opcional → «Iniciar conteo».
2. Busca o escanea un producto con presentación «Caja»: el cursor pasa a la cantidad. Elige «Caja», escribe `2`: antes de guardar deberías ver «2 cajas × 100 = 200 piezas». Enter guarda y el cursor vuelve a la búsqueda.
3. Captura el mismo producto otra vez en piezas (`30`). Deberías ver «Contado: 230 piezas», las dos capturas por separado y el aviso de que hay empaques y sueltos (para revisar que no se contó dos veces).
4. Cada producto muestra lo que el sistema tenía en esa ubicación al contarlo y la diferencia («Faltan 20 piezas», «Sobran…», «Coincide»).
5. Si no hay nada de un producto, captura `0`. Quita una captura equivocada con el bote de basura.
6. Intenta iniciar otro conteo de la misma ubicación: se rechaza y te ofrece continuar el abierto.
7. «Cancelar conteo»: queda cerrado, visible y sin cambios posibles.

En todo momento tus existencias siguen iguales: capturar no mueve nada. Aplicar las diferencias como ajustes llega en un paso posterior.

**F15. Conteo: movimientos después de contar**

1. En un conteo abierto, cuenta un producto que el sistema tiene en 40 y captura `38` («Faltan 2 piezas»).
2. Sin cerrar el conteo, registra una salida de 5 de ese producto en la misma ubicación y vuelve al conteo.
3. Deberías ver: «Después de contarlo salieron 5 piezas (1 movimiento)», el movimiento listado, la diferencia intacta («Faltan 2 piezas») y «Hoy el sistema tiene 35 piezas. Al aplicar la diferencia quedarían 33 piezas» (no 38: la salida posterior se respeta).
4. Conflicto: cuenta `3` de un producto con 40 y después registra una salida de 10. Deberías ver el aviso rojo de que hay que volver a contarlo; quita sus capturas, cuéntalo de nuevo y el aviso desaparece con una referencia nueva.

Un movimiento en otra ubicación, o anterior a que contaras ese producto, no aparece como «posterior».

**F16. Aplicar un conteo**

1. En un conteo abierto con productos contados aparece «Aplicar conteo». Ábrelo: te dice cuántos productos se ajustarán y pide el motivo (obligatorio).
2. Aplica. Deberías ver: el conteo queda «Aplicado», sin captura ni botones, con el enlace «Ver el ajuste en Movimientos»; en el historial hay un solo «Ajuste» con una línea por producto distinto, tu motivo y la referencia «Conteo de <ubicación>»; las existencias quedan como lo contado (menos o más lo que se haya movido después de contar).
3. Da doble clic al aplicar, o abre el conteo en dos pestañas y aplica en ambas: debe quedar un solo ajuste.
4. Si todo coincidía, se cierra sin ajuste («Todo coincidía»).
5. Con un producto en conflicto (F15) el botón no aparece hasta recontarlo.
6. El ajuste se puede reversar desde Movimientos como cualquier otro; el conteo sigue aplicado y no vuelve a ajustar.
7. Queda en la bitácora («Aplicó un conteo físico») con el motivo.

**F17. Reconciliación (comprobación técnica)**

En la terminal, `npm run stock:reconcile` revisa que las existencias de cada producto en cada ubicación coincidan con la suma de sus movimientos, en todas las empresas. Deberías ver «0 diferencia(s)». Solo lee; si algún día reporta una diferencia, avísame con el texto que imprime: es una falla a investigar, no algo que se corrija solo.

**F18. Inicio**

Al entrar ahora llegas a `/inicio` (también es el primer elemento del menú; en el celular la barra inferior es Inicio, Inventario, Movimientos, Conteos y «Más», donde quedó Ubicaciones).

Deberías ver, según tu rol: «Existencias bajas» con los cinco productos más vacíos y el enlace «Ver todas»; «Uso de tu plan» con productos activos y personas (solo titular y administrador); «Últimos movimientos» con los cinco más recientes; y los botones «Registrar entrada» y «Salida rápida» si puedes registrar. Una persona sin rol ve solo el aviso de que pida uno.

### G. Importación desde Excel

**G1. Plantilla**

1. `/inventario` → «Importar desde Excel» (lo ven titular, administrador y almacén).
2. Descarga «Plantilla de Excel (.xlsx)» y «Plantilla CSV» y ábrelas.
3. Deberías ver: los títulos de las 13 columnas, cuatro productos de ejemplo (por pieza con caja de 100, por metro con rollo, por kilogramo con saco y uno sin presentación) y, en Excel, la hoja «Instrucciones» con qué poner en cada columna y la lista de unidades válidas.

Dime si falta alguna columna de las que tiene tu Excel actual, o si algún título o ejemplo no se entiende. Subir el archivo y revisarlo llega en los pasos siguientes.

**G2. Subir tu archivo y elegir columnas**

1. En `/inventario/importar`, sube la plantilla llena o **tu propio Excel** (.xlsx o .csv, hasta 10 MB).
2. Deberías llegar a «Columnas de tu archivo»: la hoja leída, cuántas filas tiene, tus primeras filas tal como se leyeron y, para cada dato nuestro, la columna de tu archivo que le corresponde (se propone sola si el título se parece: «Código», «Artículo», «UM», «Existencia»…).
3. Elige cómo vienen los decimales (punto o coma). No hay opción marcada de inicio: guardar sin elegir se rechaza.
4. Guarda. Abajo aparece cómo se leen tus números con esa elección; si elegiste mal verás «no se entiende así» y puedes cambiarla.
5. Prueba también: un archivo que no es Excel con extensión .xlsx (se rechaza con explicación), un Excel con fórmulas (avisa que toma el valor guardado, no las ejecuta), dos columnas con el mismo título, y elegir la misma columna para dos datos.

Subir y mapear no cambia tu inventario. Dime qué títulos de tu Excel real no se reconocieron solos, para agregarlos.

## 4. Lo que todavía no existe

Para que no lo reportes como falla:

- Avisos por correo de existencias bajas (la lista sí existe).
- Compras y proveedores.
- Ventas con precios, cobro o ticket (la salida rápida solo descuenta existencias).
- Pantalla para transferir la titularidad (la lógica está, falta la interfaz).
- Envío real de correos, cobro y precios de los planes.
- Prueba gratuita automática al registrarse: hoy el plan se asigna desde la consola.

## 5. Cómo darme la retroalimentación

Copia esta plantilla por cada observación:

```text
Recorrido: (por ejemplo D5)
Qué hice:
Qué esperaba:
Qué pasó:
Tipo: falla / confuso / texto / diseño / idea
Dispositivo: computadora o celular
```

También me sirve mucho:

- Textos que no entendería un ferretero (dime cómo lo dirías tú).
- Pasos que sobran o que faltan.
- Lo que se ve mal en el celular (abre `http://localhost:3000` desde las herramientas de tu navegador en vista móvil).
- Las tres decisiones pendientes: quién será personal de plataforma, si el registro debe dar un periodo de prueba automático, y si reactivar a un miembro necesita un permiso distinto al de desactivarlo.

Contiene:

- Cómo entrar: arrancar la app, cuenta demo, de dónde sale la contraseña y el código de dos pasos, y el buzón local /correos.
- Mapa de pantallas: cada dirección, qué es y qué rol puede entrar.
- Recorridos paso a paso con lo que deberías ver en cada uno: cuenta y acceso, equipo y roles, bitácora, productos, y plan con consola interna.
- Lo que todavía no existe, para que no lo reportes como falla.
- Plantilla para darme cada observación.

Dos avisos antes de probar:

- El recorrido E1 te pide correr npm ruest para poder entrar a /interno; hoy no

Contiene:

- Cómo entrar: arrancar la app, cuenta demo, de dónde sale la contraseña y el código de dos pasos, y el buzón local /correos.
- Mapa de pantallas: cada dirección, qu
- Recorridos paso a paso con lo que deberías ver en cada uno: cuenta y acceso, equipo y roles, bitácora,
  productos, y plan con consola interna
- Lo que todavía no existe, para que no lo reportes como falla.
- Plantilla para darme cada observación

Dos avisos antes de probar:

- El recorrido E1 te pide correr npm run staff -- add <demo@almacen.test> para poder entrar a /interno; hoy no hay nadie con ese acceso.
- Las empresas que crees al probar el rde desarrollo, porque su bitácora no sepuede borrar.

No recorrí la guía de punta a punta como la leerías tú. Cada flujo lo probé por separado durante la sesión, así que algún texto exacto de pantalla ue escribí; si ves una diferencia,anótala como observación.
