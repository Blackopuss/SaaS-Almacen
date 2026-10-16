# Auditoría de seguridad 1 (skill `security-audit`)

Revisión hecha con la skill `security-audit` de Cloudflare sobre el commit `9f806cc` (rama `pruebas`), perfil **quick**, con revisores de solo lectura y verificadores independientes que reprodujeron cada hallazgo en local contra `almacen_test`. Codex hizo el mapeo inicial; su verificación cruzada quedó pendiente de cuota. El reporte completo está fuera del repositorio (`~/security-audit-skill/SaaS-Almacen/run-1/`).

Resistieron sin fallas: aislamiento entre empresas, permisos por rol y módulo, archivos privados y enlaces firmados, cola de trabajos, correo saliente, SQL, costos ocultos a Consulta, configuración y dependencias.

## Hallazgos y corrección

| # | Severidad | Hallazgo | Corrección | Prueba |
| --- | --- | --- | --- | --- |
| 1 | Alta | El lector de XLSX usaba expresiones regulares perezosas: con etiquetas sin cerrar el costo era cuadrático. Un archivo de 784 B bloqueaba el servidor 2 s, y cada vez que el archivo duplicaba su tamaño el tiempo se multiplicaba por 4. | Recorrido en una sola pasada con `indexOf` (`elements`), etiqueta sin cerrar = archivo roto, tope de 4 KB por etiqueta de inicio. | `spreadsheet-reader.int.test.ts` («costs one pass…») |
| 2 | Media | Cada celda volvía a limpiar la cadena compartida completa, y los límites se medían con la fila o celda que el archivo declaraba, no con cuántas había. | Cadenas compartidas recortadas al construirlas, `clean` recorta antes de limpiar, y se cuentan las filas y celdas escritas (tope de filas × 100). | `spreadsheet-reader.int.test.ts` |
| 3 | Media | Límite de intentos no atómico: se revisaba el bloqueo, se verificaba la contraseña y se contaba al final. 20 intentos simultáneos se evaluaron todos y el correcto entró. Lo mismo pasaba con el código TOTP de un solo uso. | `reserveAttempt` aparta el intento antes de verificar; `settleFailure` y `refundAttempt` lo cierran después. Se aplica en inicio de sesión, MFA, recuperación, registro (ahora también por correo) e invitaciones. | `throttle.int.test.ts` («attempts sent all at once») |
| 4 | Baja | Redirección abierta: `/.//evil.example` se normalizaba a `//evil.example` en `/ingresar` y `/verificar-codigo` con sesión. | `safeRedirectPath` revisa también la ruta ya normalizada. | `redirect.test.ts` |
| 5 | Baja | Aplicar un conteo dejaba existencias en una ubicación o producto archivados. | Mientras haya un conteo abierto, no se puede archivar el producto ni la ubicación. Además, `applyCount` bloquea la ubicación y rechaza si ella o algún producto están archivados. | `count-apply.int.test.ts` |
| 6 | Baja | Robo anticipado de cuenta: la contraseña de quien registró un correo ajeno seguía sirviendo después de la verificación con inicio de sesión automático. | `autoSignInAfterVerification: false`; la confirmación lleva a iniciar sesión o a recuperar la contraseña. | `auth.int.test.ts` |

## Endurecimiento hecho

- IP del cliente desde el final de `X-Forwarded-For` (`TRUSTED_PROXY_HOPS`), no desde la primera entrada, que escribe el cliente.
- En producción, `BETTER_AUTH_URL` es obligatoria y debe ser `https` fuera de `localhost`. En una dirección pública se rechaza `MAIL_DRIVER=log|memory`.
- `npm run dev` solo escucha en `127.0.0.1` (`dev:red` para probar desde el teléfono), y `/correos` solo responde a direcciones de la propia máquina.
- El asunto del correo de invitación va en una sola línea y con longitud acotada.
- `neutralizeFormula` también detecta signos precedidos de espacios y los signos de ancho completo.
- `updateProduct` bloquea el producto antes de decidir si se puede cambiar la unidad.
- Filtro de tipo de movimiento con `Object.hasOwn`.
- Importaciones: lo que el catálogo hace con una fila al aplicarla (crear, actualizar o reactivar) debe estar autorizado. El contenido de la presentación y el mínimo se validan con la precisión del producto existente, antes de tocarlo.
- `proxy.ts`: el `matcher` cubre las mismas rutas que `PROTECTED`.
- CI: acciones fijadas por commit y `persist-credentials: false`.

## Aceptado o pendiente

- CSP de scripts con nonce (PLT16-04, antes del piloto).
- Desactivar a una persona cierra todas sus sesiones, también las de otras empresas: se prefiere cerrar de más. Las invitaciones que emitió siguen vigentes, porque son de la empresa.
- `findDuplicates` de proveedores avisa también de contactos que solo son clientes (ADR 0016, dentro de la misma empresa); revisar cuando exista Ventas/CRM.
- `purchasingOpenWork` no comprueba por sí mismo que quien llama sea personal de plataforma: lo hace su único llamador, `provisionCompany`.
- La bitácora descarta claves de metadatos parecidas a secretos (`code`, `key`, `hash`), aunque no lo sean. Se prefiere perder detalle a guardar un secreto.
- Recepción bloquea orden → ubicaciones (orden distinto del documentado): riesgo de interbloqueo sin efecto en la integridad.
- `readLimit` no mira el estado de la suscripción; hoy no tiene efecto porque nada escribe suscripciones.
