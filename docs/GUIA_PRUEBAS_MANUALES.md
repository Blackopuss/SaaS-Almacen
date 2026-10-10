# Guía de pruebas manuales

Actualizada: 2026-10-10 · Avance: 101 de 148 pasos (BAS, PLT, USR, MOD, Inventario e Importación completas; Compras: proveedores).

Sirve para recorrer a mano, desde cero, todo lo que ya existe y anotar lo que no te guste. Cada recorrido dice qué hacer y qué deberías ver. Al final hay una plantilla para darme la retroalimentación.

## 1. Empezar desde cero

### 1.1 Lo que necesitas

- MySQL 9.4 corriendo en tu computadora.
- Node 24 o más reciente.
- Una app de autenticación en el teléfono (Google Authenticator, Authy…) para el recorrido A1.

### 1.2 Primera vez en esta computadora

Solo si nunca has levantado el proyecto aquí:

```powershell
npm install
# Copia .env.example como .env.local y escribe MYSQL_ROOT_PASSWORD
npm run setup      # secretos, bases, usuarios y tablas
```

### 1.3 Dejar la base de desarrollo vacía (opcional, lo corres tú)

Si ya habías probado antes y quieres partir de una base limpia:

```powershell
npm run db:reset   # BORRA todo lo de almacen_dev y vuelve a crear las tablas
```

Te pide confirmación. Es la única forma de quitar empresas, movimientos y bitácora de pruebas anteriores (no se pueden borrar desde la app). Yo nunca lo ejecuto por mi cuenta. Si quieres, borra también las carpetas `.local/mail` (correos viejos de `/correos`) y `storage` (archivos subidos); se vuelven a crear solas.

Si prefieres conservar lo que tienes, sáltate este paso: todos los recorridos funcionan igual sobre una base con datos.

### 1.4 Preparar la cuenta demo y arrancar

```powershell
npm run db:seed                          # crea o restaura la cuenta demo y su plan
npm run staff -- add demo@almacen.test   # acceso a la consola interna (recorrido E)
npm run dev                              # terminal 1: la aplicación, http://localhost:3000
npm run worker                           # terminal 2: aplica las importaciones (recorrido G5)
```

Deja las dos terminales abiertas mientras pruebas.

### Cuenta demo (titular de «Ferretería Demo»)

| Dato | Dónde está |
| --- | --- |
| Correo | `demo@almacen.test` (o `DEMO_EMAIL` en `.env.local`) |
| Contraseña | `DEMO_PASSWORD` en `.env.local` |
| Código de dos pasos | `npm run demo:codigo` (cambia cada 30 segundos y cada código sirve una sola vez) |

La Ferretería Demo ya tiene plan: Inventario y Compras, 1,000 productos y 5 usuarios. Empieza sin productos; solo tiene la ubicación «General».

### Los correos no salen de tu computadora

Todavía no hay proveedor de correo. Cada mensaje que la app «envía» aparece en `http://localhost:3000/correos`, con un botón para abrir su enlace. Úsalo para confirmar cuentas, restablecer contraseñas y aceptar invitaciones.

### Probar como otra persona

Abre una ventana de incógnito (u otro navegador) para la segunda persona; así no cierras tu sesión de titular.

### Orden sugerido

A (cuenta) → E1 (darle plan a la empresa nueva) → D (productos) → F (existencias y movimientos) → G (importación) → B (equipo y roles) → C (bitácora) → resto de E. Así cada recorrido encuentra los datos que dejó el anterior.

### Alternativa: base de pruebas (no ensucia desarrollo)

Para repetir recorridos de movimientos, conteos o importación sin dejar rastro en desarrollo:

```powershell
npm run dev:test                                              # terminal 1: http://localhost:3100
npm run test:company -- "<contraseña de 12+ caracteres>" warehouse   # imprime el correo para entrar
$env:DATABASE_NAME="almacen_test"; npm run worker             # terminal 2 (PowerShell)
```

El rol puede ser `warehouse`, `buyer`, `viewer` o `administrator` (este último tendrá que activar los dos pasos). La empresa trae Inventario y Compras, 100 productos y 5 usuarios. Esa base se vacía sola cada vez que corren las pruebas automáticas (`npm test`). Límites: ahí no hay buzón `/correos` ni cuenta de titular con contraseña, así que los recorridos A, B y E se hacen en `http://localhost:3000`.

En PowerShell, `$env:DATABASE_NAME=…` se queda puesto en esa terminal: ciérrala al terminar para no correr otros comandos contra la base de pruebas.

## 2. Mapa de pantallas

| Dirección | Qué es | Quién entra |
| --- | --- | --- |
| `/registro`, `/ingresar` | Crear cuenta e iniciar sesión | Cualquiera |
| `/recuperar-contrasena` | Pedir enlace para cambiar contraseña | Cualquiera |
| `/correos` | Buzón local de correos (solo desarrollo) | Cualquiera |
| `/inicio` | Resumen del día: existencias bajas, últimos movimientos y uso del plan | Todos (cada bloque según permiso) |
| `/inventario` | Lista de productos con búsqueda, filtros, páginas y existencias | Quien pueda ver productos |
| `/inventario/nuevo` | Alta de producto | Titular, Administrador, Almacén |
| `/inventario/<id>` | Ficha del producto: total, mínimo, dónde está, equivalencias y últimos movimientos | Quien pueda ver productos |
| `/inventario/<id>/editar` | Ficha, presentaciones y archivar | Titular, Administrador, Almacén |
| `/inventario/bajas` | Productos en su mínimo o por debajo | Quien pueda ver mínimos y existencias |
| `/inventario/importar` | Plantilla y subir archivo para importar el catálogo | Titular, Administrador, Almacén |
| `/inventario/importar/<id>` | Elegir qué columna de tu archivo es cada dato | Titular, Administrador, Almacén |
| `/inventario/importar/<id>/revision` | Revisar filas, confirmar y ver el avance de la importación | Titular, Administrador, Almacén |
| `/movimientos` | Historial con filtros (fechas, producto, persona, tipo) y botones para registrar | Quien pueda ver movimientos |
| `/movimientos/entrada`, `/salida`, `/reubicar`, `/ajuste`, `/saldo-inicial` | Registrar un movimiento de un producto | Titular, Administrador, Almacén |
| `/movimientos/salida-rapida` | Salida de varios productos en una sola confirmación | Quien pueda registrar salidas |
| `/ubicaciones` | Zonas, pasillos y estantes; «General» existe siempre | Todos leen; Titular, Administrador y Almacén modifican |
| `/conteos`, `/conteos/<id>` | Iniciar un conteo físico, capturar lo contado y aplicarlo | Titular, Administrador, Almacén (Consulta solo lee; Comprador no entra) |
| `/compras` | Todavía vacía (solo el aviso de «sin datos») | Titular, Administrador, Comprador, Consulta |
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
4. La app te obliga a activar la verificación en dos pasos: escanea el QR con una app de autenticación y escribe el código.
5. Guarda los códigos de recuperación que te muestra.

Deberías ver: no puedes entrar sin confirmar el correo; no puedes usar la app sin activar los dos pasos; al final llegas a Inicio y, al abrir Inventario, al aviso de que el módulo no está activo (una empresa nueva no tiene plan hasta que se le asigna; ver E1).

Nota: una empresa creada aquí ya no se puede borrar desde la app (su bitácora es permanente); solo desaparece con el paso 1.3.

**A2. Iniciar sesión con dos pasos**

1. En `/ingresar` escribe correo y contraseña de la demo.
2. Escribe el código de `npm run demo:codigo`.

Deberías ver: con contraseña equivocada dice «Correo o contraseña incorrectos» (igual si el correo no existe); el mismo código no sirve dos veces; tras 5 intentos fallidos te pide esperar.

**A3. Entrar con un código de recuperación**

Con la cuenta de A1 (de la que guardaste los códigos), en la pantalla del código elige «¿No tienes tu teléfono? Usa un código de recuperación». Deberías ver: entra, ese código deja de servir y llega un correo de aviso a `/correos`.

**A4. Recuperar contraseña**

1. En `/ingresar` → «¿Olvidaste tu contraseña?», escribe el correo de la cuenta de A1.
2. Abre el enlace desde `/correos` y elige una contraseña nueva.

Deberías ver: la misma respuesta exista o no el correo; el enlace sirve una sola vez; se cierran todas las sesiones y llega un correo de aviso.

(Si lo haces con la cuenta demo, `npm run db:seed` le devuelve la contraseña de `.env.local`.)

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

Repite B1 con Comprador y Consulta (o cambia el rol desde «Roles»). Todos ven además Inicio y Configuración.

| Rol | Menú | Puede agregar productos y registrar movimientos |
| --- | --- | --- |
| Almacén | Inventario, Movimientos, Ubicaciones, Conteos | Sí |
| Comprador | Inventario, Movimientos, Ubicaciones, Compras | No (no ve los botones) |
| Consulta | Todas las secciones, solo lectura | No |
| Administrador | Todo, más Equipo, Mi plan y Bitácora | Sí |

Un Administrador debe activar los dos pasos antes de usar la app. «Importar desde Excel» solo lo ven titular, administrador y almacén.

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

En `/configuracion/bitacora` deberías ver, del más reciente al más antiguo, lo que hiciste en los demás recorridos: invitaciones, cambios de rol (con rol anterior y nuevo), desactivaciones con su motivo, productos creados y editados, presentaciones, ajustes y reversas con su motivo, conteos aplicados, importaciones confirmadas y aplicadas, y cambios de plan. No hay forma de editar ni borrar un registro.

Las entradas, salidas y reubicaciones normales no aparecen aquí: su rastro es el historial de Movimientos.

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

En la lista, «Editar». Cambia el nombre y la marca. Deberías ver: «Cambios de … guardados»; guardar sin cambiar nada dice «No hay cambios que guardar»; no hay ningún campo de cantidad (las existencias solo se mueven con movimientos; ver F); el cambio aparece en la bitácora.

**D5. Presentaciones**

En la ficha del tornillo, sección «Presentaciones»:

1. Agrega «Caja» con 100. Deberías ver «Caja = 100 piezas».
2. Intenta agregar «Bolsa» con 12.5: se rechaza («piezas completas»). Con 0 o con texto, también.
3. En «Cambiar contenido» de la Caja escribe 120. Deberías ver «Caja = 120 piezas». Vuelve a dejarla en 100 para los recorridos F.
4. En el cable (metros) agrega «Rollo» con 100 y otro con 30.5: ambos se aceptan.

**D6. Archivar y reactivar**

Hazlo con un producto sin existencias. Con existencias se rechaza («Todavía hay … de este producto. Regístralas como salida o ajústalas a cero antes de archivarlo»); pruébalo después de F2.

1. En la ficha, «Archivar producto» → confirmar.
2. Deberías ver: desaparece de la lista, «Mi plan» baja un lugar, y aparece en «Ver productos archivados».
3. «Reactivar»: vuelve a la lista y ocupa su lugar otra vez.

**D7. Ubicaciones**

En `/ubicaciones` crea una zona («Zona A»), dentro un pasillo y dentro un estante. Deberías ver: «General» existe siempre; cada ubicación muestra su ruta («Zona A › Pasillo 2»); un estante no puede contener nada y una zona no puede ir dentro de un pasillo; las ubicaciones se archivan, no se borran. Las necesitarás en F6 y F14.

### E. Plan, módulos y consola interna

**E1. Asignar plan a una empresa (consola interna)**

1. Si no lo hiciste en 1.4: `npm run staff -- add demo@almacen.test`.
2. Con la cuenta demo entra a `http://localhost:3000/interno`. Busca la empresa que creaste en A1.
3. Elige un nivel (por ejemplo «100 productos · 2 usuarios»), marca Inventario, escribe un motivo y «Asignar plan».

Deberías ver: «Plan asignado»; en la otra ventana, esa empresa ya puede usar Inventario; sin motivo no deja guardar; si quitas Inventario y dejas Compras lo rechaza («Compras necesita Inventario»); el cambio queda en la bitácora de esa empresa.

Para retirarte el acceso: `npm run staff -- remove demo@almacen.test`. Con cualquier cuenta que no sea personal, `/interno` muestra «página no encontrada».

**E2. Mi plan**

En `/configuracion/plan` deberías ver la vigencia, las barras de productos y usuarios, y los módulos: Inventario y Compras «Activo», Ventas y CRM «Próximamente».

**E3. Módulo no contratado**

Desde la consola, reasigna el plan de una empresa sin Compras. Deberías ver: Compras desaparece de su menú y `/compras` muestra el aviso de solo lectura (su historial se conserva).

**E4. Límite de productos**

Asigna a la empresa de A1 un cupo pequeño (por ejemplo 2) y crea 3 productos. Deberías ver: el tercero se rechaza con «Llegaste al límite de tu plan: 2 de 2 productos activos…»; al archivar uno, ya cabe otro.

**E5. Plan vencido**

En la consola pon «Vigente hasta» mañana para comprobar que se muestra la fecha en «Mi plan». (Para verlo vencido habría que esperar a que pase la fecha: entonces todo queda en solo lectura, sin perder datos.)

### F. Existencias y movimientos

Los movimientos no se pueden borrar (se corrigen con reversa). Si no quieres dejarlos en desarrollo, usa la base de pruebas de la sección 1.

**F1. Lista de productos**

Crea más de 25 productos (o impórtalos con G). Deberías ver: páginas con «Anterior/Siguiente», búsqueda por nombre, clave o código de barras (la coincidencia exacta aparece arriba), filtros por categoría y marca que se combinan y quedan en la dirección, y las existencias de cada producto.

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

Con dos ubicaciones (D7), `/movimientos/reubicar`: mueve parte de un producto. Deberías ver: sale de una, entra a la otra, el total no cambia; origen y destino iguales se rechaza.

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
7. En otro conteo de prueba, «Cancelar conteo»: queda cerrado, visible y sin cambios posibles.

En todo momento tus existencias siguen iguales: capturar no mueve nada. Las diferencias se aplican en F16.

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

En la terminal, `npm run stock:reconcile` revisa que las existencias de cada producto en cada ubicación coincidan con la suma de sus movimientos, en todas las empresas. Deberías ver «0 diferencia(s)». Solo lee; si algún día reporta una diferencia, avísame con el texto que imprime: es una falla a investigar, no algo que se corrija solo. Córrelo al terminar todos los recorridos F.

**F18. Inicio**

Al entrar llegas a `/inicio` (también es el primer elemento del menú; en el celular la barra inferior es Inicio, Inventario, Movimientos, Conteos y «Más», donde quedó Ubicaciones).

Deberías ver, según tu rol: «Existencias bajas» con los cinco productos más vacíos y el enlace «Ver todas»; «Uso de tu plan» con productos activos y personas (solo titular y administrador); «Últimos movimientos» con los cinco más recientes; y los botones «Registrar entrada» y «Salida rápida» si puedes registrar. Una persona sin rol ve solo el aviso de que pida uno.

### G. Importación desde Excel

**G1. Plantilla**

1. `/inventario` → «Importar desde Excel» (lo ven titular, administrador y almacén).
2. Descarga «Plantilla de Excel (.xlsx)» y «Plantilla CSV» y ábrelas.
3. Deberías ver: los títulos de las 13 columnas, cuatro productos de ejemplo (por pieza con caja de 100, por metro con rollo, por kilogramo con saco y uno sin presentación) y, en Excel, la hoja «Instrucciones» con qué poner en cada columna y la lista de unidades válidas.

Dime si falta alguna columna de las que tiene tu Excel actual, o si algún título o ejemplo no se entiende.

**G2. Subir tu archivo y elegir columnas**

1. En `/inventario/importar`, sube la plantilla llena o **tu propio Excel** (.xlsx o .csv, hasta 10 MB).
2. Deberías llegar a «Columnas de tu archivo»: la hoja leída, cuántas filas tiene, tus primeras filas tal como se leyeron y, para cada dato nuestro, la columna de tu archivo que le corresponde (se propone sola si el título se parece: «Código», «Artículo», «UM», «Existencia»…).
3. Elige cómo vienen los decimales (punto o coma). No hay opción marcada de inicio: guardar sin elegir se rechaza.
4. Guarda. Abajo aparece cómo se leen tus números con esa elección; si elegiste mal verás «no se entiende así» y puedes cambiarla.
5. Prueba también: un archivo que no es Excel con extensión .xlsx (se rechaza con explicación), un Excel con fórmulas (avisa que toma el valor guardado, no las ejecuta), dos columnas con el mismo título, y elegir la misma columna para dos datos.

Subir y mapear no cambia tu inventario. Dime qué títulos de tu Excel real no se reconocieron solos, para agregarlos.

**G3. Revisar las filas**

1. Con las columnas guardadas, «Revisar las filas».
2. Con la plantilla tal como se descarga deberías ver «Las 4 filas están correctas» y cómo se entiende cada una («3 cajas × 100 = 300 piezas en General», «12 sacos × 50 = 600 kilogramos en General»).
3. Mete errores a propósito en tu archivo y súbelo de nuevo: una unidad que no existe («rollo»), una clave vacía, media pieza (`1.5`), una ubicación que no has creado, la misma clave dos veces, un contenido de presentación sin nombre. Deberías ver una tabla con **fila, columna (con el título de tu archivo), lo que dice la celda y el problema**, y arriba cuántas filas están bien y cuántas no.
4. Una misma clave puede repetirse solo para dar la existencia de otra ubicación (misma clave, nombre y unidad; distinta ubicación).

Revisar no importa nada: puedes corregir y volver a subir las veces que quieras. Dime qué mensajes no se entienden.

**G4. Nuevos, actualizados y cupo**

En la misma pantalla de revisión, «Qué pasará con tus productos»:

1. Sube un archivo que mezcle una clave que ya tienes (con otro nombre o marca), una de un producto archivado y una nueva. Deberías ver los tres contadores (Nuevos, Se actualizan, Se reactivan), qué cambia en los existentes («Nombre: A → B») y cuántos lugares de tu plan necesita contra los disponibles.
2. Sube más productos nuevos de los que caben en tu plan: te dice cuántos faltan y que no se importará una parte. (Con los 1,000 lugares de la demo es más fácil probarlo en la empresa de E4, con cupo pequeño.)
3. Choques: una existencia inicial para un producto que ya tiene movimientos, una unidad distinta a la que ya tiene el producto, o un código de barras que ya usa otro producto. Aparecen por fila, con la explicación.

Hasta aquí no se importa nada: eso ocurre al confirmar (G5).

**G5. Confirmar e importar**

Las importaciones se aplican en segundo plano: además de la aplicación debe estar corriendo el worker en otra terminal (`npm run worker`; con la base de pruebas, ver la sección 1).

1. Con una importación «lista», «Confirmar importación». El aviso te dice cuántos productos y cuántos lugares de tu plan aparta.
2. Deberías ver «Importación confirmada, en espera» con «0 de N productos procesados». Ya no se pueden cambiar sus columnas ni confirmar otra vez. (Para verla en este estado, confirma con el worker detenido.)
3. Con el worker corriendo, recarga la pantalla: pasa a «Importando…» y luego a «Importación terminada: N productos quedaron en tu catálogo», con el enlace «Ver tu inventario». Tus productos aparecen en Inventario con su unidad, presentación (con el contenido que decía el archivo) y mínimo.
4. Con un archivo grande (varios cientos de filas), detén el worker a la mitad (Ctrl+C) y vuelve a arrancarlo: continúa donde se quedó sin duplicar productos.
5. Un producto que ya existía se actualiza (una celda vacía no borra lo que tenía); uno archivado vuelve a estar activo.
6. Si después de confirmar (con el worker detenido) alguien crea a mano un producto con un código de barras del archivo, al aplicar ese producto queda como «no se pudo importar» con su motivo y los demás sí entran.
7. En «Mi plan», los productos activos suben solo por los nuevos y reactivados que sí entraron. La bitácora muestra la confirmación y el resultado.

8. Existencias iniciales: llena «Existencia inicial» (y «Ubicación», y «Existencia contada en» si la cuentas por caja) en algunas filas, y repite una clave en dos filas para darle existencia en dos ubicaciones. Al terminar, cada producto tiene en Inventario exactamente lo que decía el archivo, por ubicación, y en Movimientos aparece un «Saldo inicial» por cada fila con existencia, con la referencia «Importación, fila N» y, si venía por caja, «3 cajas × 100 = 300 piezas».
9. Detener y volver a arrancar el worker a la mitad no duplica existencias: los saldos siguen siendo los del archivo.
10. Si después de confirmar (con el worker detenido) registras una entrada a mano de uno de esos productos, o archivas una de sus ubicaciones, ese producto queda como «no se pudo importar» con su motivo y **no cambia nada de él**; los demás entran.
11. Un producto que ya tiene movimientos no acepta existencia inicial desde un archivo: la revisión lo marca como choque antes de confirmar.

**G6. Cancelar una importación y lugares que se devuelven**

1. Con una importación «lista» (sin confirmar), «Cancelar importación»: queda «Importación cancelada», no se importó nada y ya no se puede confirmar.
2. Confirma otra con el worker detenido y revisa «Mi plan»: aparecen los lugares reservados. Cancélala: el aviso dice cuántos lugares volvieron y «Mi plan» ya no muestra reservados.
3. Con un archivo grande, arranca el worker y cancela a la mitad: los productos que ya habían entrado se quedan en tu catálogo, los demás no se importan y solo vuelven los lugares que no se usaron. En «Mi plan», productos activos = los que sí entraron.
4. Una importación terminada ya no ofrece «Cancelar importación». Consulta (solo lectura) y Compras no ven el botón.
5. Quita el rol a quien confirmó una importación mientras el worker está detenido y arráncalo: la importación queda «No pudo terminar» con el motivo, lo pendiente no se importa y sus lugares vuelven al plan.
6. La bitácora muestra la cancelación, o que la importación se detuvo antes de terminar.

Una importación cancelada o detenida no se reanuda: se sube el archivo de nuevo (lo que ya entró aparece como «Se actualiza»).

**G7. Importar salidas diarias**

Para cuando las ventas se registran en otro sistema o en notas. Necesita el worker corriendo, como G5.

1. `/inventario` → «Importar desde Excel» → «Importar salidas diarias». Descarga la plantilla (CSV o Excel) y ábrela: una fila por producto vendido, con fecha, folio, clave (o código de barras), cantidad y, si aplica, presentación y ubicación.
2. Llena unas filas con productos que tengan existencias, elige cómo vienen los decimales y sube el archivo. Deberías ver la revisión: cuántas salidas se descontarían, de qué días, en cuántos folios, y cómo se entiende cada fila. Todavía no sale nada.
3. «Confirmar y descontar». Al terminar: «Salidas registradas: N salidas descontadas de tu inventario». En Inventario bajaron las existencias y en Movimientos hay una «Salida» por fila, con el folio como referencia y el día en el motivo.
4. De vuelta en «Importar salidas» la pantalla dice **«Salidas importadas hasta el <último día>»**.
5. Sube **el mismo archivo otra vez**: la revisión avisa que todas las filas ya se habían importado y no ofrece descontarlas. Sube uno que repita algunas ventas y traiga nuevas: solo las nuevas se descuentan.
6. Pon una salida mayor a la existencia: esa fila queda «no se pudo descontar» con el motivo, las demás sí salen, y la pantalla principal avisa cuántas faltan. Corrige el inventario (una entrada o un ajuste) y sube el mismo archivo: ahora solo sale la que faltaba.
7. Un archivo con problemas (clave que no existe, fecha imposible, sin folio, mismo folio y producto dos veces) los lista por fila y columna y no se puede confirmar.
8. Consulta y Compras no pueden subir ni confirmar.

Dime si tu sistema de ventas exporta el archivo con otros títulos o con la fecha en otro formato, y si prefieres ver una salida por ticket en lugar de una por producto.

**G8. Exportar a Excel**

1. `/inventario` → «Exportar a Excel» (lo ven todos los roles, también Consulta).
2. Descarga el catálogo, las existencias y el historial, en Excel y en CSV, y ábrelos. Deberías ver los mismos datos que en pantalla: productos activos y archivados con su mínimo; existencias por ubicación con la ruta completa («Zona A › Estante 3»); y en el historial una fila por movimiento con fecha y hora, tipo, cantidad, motivo, referencia y quién.
3. En el historial, elige un rango de fechas: el archivo trae solo esos días.
4. Crea un producto cuyo nombre empiece con `=` (por ejemplo `=1+1`) y expórtalo: en Excel debe verse el texto con un apóstrofo delante, **no** el resultado 2.
5. Con una cuenta sin rol, o sin sesión, la descarga no se entrega.
6. En Configuración → Bitácora aparece cada exportación (qué se exportó, formato y cuántas filas).

Dime si a los archivos les falta alguna columna que uses con tu contador, o si prefieres otro orden.

**G9. Guía de primer uso (empieza aquí con una empresa nueva)**

1. Crea una empresa nueva (o usa la de E4) y entra a Inicio. Deberías ver «Primeros pasos — 0 de 3 listos», con el primer paso abierto: «Trae tus productos».
2. Sin leer nada más, sigue **solo los botones de la guía**: «Importar desde Excel», llena la plantilla con dos o tres productos y su existencia, confirma. De vuelta en Inicio: «2 de 3 listos» (productos y existencias) y el paso abierto es «Registra tu primer movimiento».
3. «Registrar entrada», elige un producto y una cantidad. De vuelta en Inicio la guía ya no está y ves el panel normal.
4. Repite con otra empresa agregando un producto a mano: la guía te lleva a «Di cuánto tienes» → «Capturar saldo inicial».
5. Con una cuenta de Consulta en una empresa nueva, la guía aparece pero sin botones: dice que lo pida a quien lleva el inventario.

Esta es la prueba que más me importa: dime en qué punto dudaste, qué palabra no se entendió o dónde esperabas otro botón.

### H. Compras

**H1. Proveedores**

1. Compras → «Proveedores» → «Agregar proveedor» (titular, administrador o Compras; Consulta solo ve la lista; Almacén no entra).
2. Guarda uno solo con el nombre. Luego otro con todos los datos, pegando el RFC con guiones o en minúsculas (`fno-010203-ab1`): en la ficha debe verse limpio (`FNO010203AB1`).
3. Escribe un RFC imposible (11 caracteres, o con mes 13): el error aparece en ese campo y lo demás que escribiste se conserva.
4. Intenta agregar otro con el **mismo RFC** o el **mismo nombre**: no se guarda y te muestra el que ya existe. Con «Guardar de todos modos» sí se guarda (piensa en dos sucursales del mismo proveedor).
5. Edita un proveedor: los cambios se ven en la ficha y en la bitácora dice qué campos cambiaron.
6. Con varios proveedores, busca por parte del nombre y por parte del RFC.

Dime qué datos de tus proveedores faltan (días de crédito, cuenta bancaria, condiciones) y si necesitas poder archivarlos.

## 4. Lo que todavía no existe

Para que no lo reportes como falla:

- Avisos por correo de existencias bajas (la lista sí existe).
- Órdenes de compra y recepciones (ya hay proveedores; lo demás llega en los siguientes pasos).
- Ventas con precios, cobro o ticket (la salida rápida solo descuenta existencias).
- Pantalla para transferir la titularidad (la lógica está, falta la interfaz).
- Envío real de correos, cobro y precios de los planes.
- Prueba gratuita automática al registrarse: hoy el plan se asigna desde la consola.
- Servidor en internet: todo corre en tu computadora.

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
- Lo que se ve mal en el celular (abre `http://localhost:3000` desde las herramientas de tu navegador en vista móvil) y en modo oscuro (interruptor en la barra lateral).
- Las tres decisiones pendientes: quién será personal de plataforma, si el registro debe dar un periodo de prueba automático, y si reactivar a un miembro necesita un permiso distinto al de desactivarlo.

No recorrí esta guía de punta a punta como la leerías tú: cada flujo se probó por separado al construirlo, así que algún texto exacto de pantalla puede diferir de lo escrito aquí. Si ves una diferencia, anótala como observación.
