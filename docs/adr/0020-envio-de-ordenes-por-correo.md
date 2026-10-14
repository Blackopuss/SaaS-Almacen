# ADR 0020 — Envío de la orden de compra por correo

Fecha: 2026-10-10 · Estado: aceptada (puntos a confirmar por el fundador) · Paso: CMP-06B

## Contexto

La orden confirmada se le manda al proveedor. El plan pide que el envío salga del worker, que un fallo se vea y que se pueda reintentar. Es el primer correo del sistema que va a alguien que **no es usuario** (el proveedor) y con un texto que en parte escribe el cliente (nombre del negocio, del proveedor, notas del PDF).

## Decisión

- **Pedir y enviar son cosas distintas.** La persona pide el envío (`requestOrderDelivery`): en una transacción, con la orden bloqueada, se guarda un renglón en `purchase_order_delivery` y se encola el trabajo `purchasing.send_order`. El worker arma el PDF y manda el correo (`deliverOrder`). La pantalla nunca espera al servidor de correo.
- **No mueve el estado de la orden.** «Enviada» es la persona diciendo que ya hizo el pedido (CMP-05, ADR 0018). El correo puede fallar o repetirse sin que la orden cambie.
- **Solo órdenes que ya son un pedido:** enviada o recibida en parte. Un borrador, una cancelada o una recibida completa no se mandan (lo decide el servicio y lo repite un disparador de la tabla).
- **Solo al correo del proveedor.** El destinatario es el de la ficha del proveedor, leído con la orden bloqueada y fijado en el renglón del envío. Ninguna pantalla manda una orden a una dirección tecleada en el momento. Si el proveedor no tiene correo, la pantalla lo dice en lugar del botón.
- **Reintentos:** 4 intentos (esperas de 15 s, 1 min y 5 min). Entre intentos la pantalla dice «No salió en el intento 2 de 4. Se vuelve a intentar solo». Al agotarse, el envío queda «No se envió» con un motivo para personas — nunca la respuesta del servidor de correo, que solo va al registro del worker — y aparece «Reintentar envío», que crea un envío nuevo al correo vigente. Lo cierra `onFailed` del trabajo (`settleFailedJobs`, ADR 0013).
- **Al menos una vez.** El envío se marca «Enviado» justo después de que el correo sale. Si el worker muere entre ambas cosas, el siguiente intento lo manda otra vez: se prefiere una orden repetida a una que se cree enviada y nunca salió. Un envío ya terminado no se vuelve a mandar ni cambia (disparador). Con un proveedor de correo real, el id del trabajo servirá como clave de idempotencia.
- **Quien lo pidió debe seguir pudiendo** cuando el worker llega (NEG-20): si perdió el permiso, salió de la empresa o el módulo quedó en solo lectura, nada sale y el envío lo dice. Lo mismo si la orden se canceló mientras esperaba.
- **Un envío a la vez por orden** (el segundo clic responde con el que ya va en camino) y **límites diarios**: 5 envíos por orden y 100 por empresa en 24 horas.
- **El correo:** texto plano, asunto «Orden de compra OC-0001 de <negocio>», PDF adjunto y **responder a** la persona que lo envió (el proveedor no le contesta al sistema). Dice que se envió desde Almacén a nombre del negocio.
- **Cabeceras cerradas.** `sendEmail` rechaza — no repara — todo mensaje cuyo destinatario, «responder a» o asunto traiga saltos de línea u otros caracteres de control, más de un destinatario, o un adjunto con nombre o tipo fuera de lo permitido (`InvalidEmailError`). La plantilla además aplana los nombres a una línea. Así ningún texto de un cliente agrega cabeceras ni destinatarios.
- **Bitácora:** quién pidió el envío y a qué correo, cuándo salió y cuándo se dio por fallido.

## Consecuencias

- Todavía **no hay proveedor de correo real**: en desarrollo el correo queda en `/correos` (con su adjunto para descargar) y en pruebas, en memoria. Los controladores locales tratan las direcciones `*.invalid` como un servidor que no responde; sirve para ver y probar un fallo (`ventas@proveedor.invalid`).
- Al elegir proveedor de correo (BAS-09..11) hay que: firmar el dominio (SPF, DKIM, DMARC), pasar el id del trabajo como clave de idempotencia, y decidir desde qué dirección sale un correo que va a nombre de un cliente.
- «Enviado» significa que el servidor de correo lo aceptó, no que el proveedor lo leyó. Rebotes posteriores no se registran todavía.
- El sistema manda correo con texto de un cliente a una dirección que el cliente captura (el correo de su proveedor). Lo acotan la plantilla fija, los límites diarios, el aviso «si no esperabas esta orden» y la bitácora; al abrir el registro al público habrá que vigilar el abuso.

## A confirmar por el fundador

- Si quieres poder mandar la orden a **otro correo** además del de la ficha (copia a ti, a un segundo contacto).
- Si al confirmar una orden debe ofrecerse enviarla en el mismo paso.
- Si los límites (5 por orden, 100 por empresa al día) te parecen bien.
