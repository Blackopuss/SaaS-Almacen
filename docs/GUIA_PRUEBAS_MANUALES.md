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
| `/inventario` | Productos recientes, agregar, archivados | Quien pueda ver productos |
| `/inventario/nuevo` | Alta de producto | Titular, Administrador, Almacén |
| `/inventario/<id>/editar` | Ficha, presentaciones y archivar | Titular, Administrador, Almacén |
| `/movimientos`, `/ubicaciones`, `/conteos`, `/compras` | Todavía vacías (solo el aviso de «sin datos») | Según rol |
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

## 4. Lo que todavía no existe

Para que no lo reportes como falla:

- Existencias, entradas, salidas, reubicaciones, ajustes y conteos (las pantallas están vacías).
- Lista de productos con paginación, búsqueda y filtros (hoy solo se ven los últimos 10; archivados, 50).
- Ubicaciones, compras y proveedores.
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
