from reportlab.lib.pagesizes import letter
from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle, KeepTogether, ListFlowable, ListItem)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib import colors
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import sys

F="/usr/share/fonts/truetype/liberation/"
pdfmetrics.registerFont(TTFont("S", F+"LiberationSans-Regular.ttf"))
pdfmetrics.registerFont(TTFont("SB", F+"LiberationSans-Bold.ttf"))
pdfmetrics.registerFont(TTFont("SI", F+"LiberationSans-Italic.ttf"))
from reportlab.pdfbase.pdfmetrics import registerFontFamily
registerFontFamily("S", normal="S", bold="SB", italic="SI", boldItalic="SB")

BLUE=colors.HexColor("#2563EB"); INK=colors.HexColor("#18181B"); MUTED=colors.HexColor("#52525B")
LINE=colors.HexColor("#E4E4E7"); SOFT=colors.HexColor("#EFF6FF"); WARN=colors.HexColor("#FEF3C7")

body=ParagraphStyle("b",fontName="S",fontSize=10.2,leading=14.5,textColor=INK,spaceAfter=5)
small=ParagraphStyle("s",parent=body,fontSize=9,leading=12.5,textColor=MUTED)
h1=ParagraphStyle("h1",fontName="SB",fontSize=17,leading=21,textColor=INK,spaceBefore=4,spaceAfter=8)
h2=ParagraphStyle("h2",fontName="SB",fontSize=12,leading=15,textColor=BLUE,spaceBefore=10,spaceAfter=4)
title=ParagraphStyle("t",fontName="SB",fontSize=28,leading=33,textColor=INK,spaceAfter=10)
sub=ParagraphStyle("st",fontName="S",fontSize=13,leading=18,textColor=MUTED,spaceAfter=20)
step=ParagraphStyle("step",parent=body,spaceAfter=3)

story=[]
def P(t,s=body): story.append(Paragraph(t,s))
def H1(n,t):
    story.append(Paragraph(f'<font color="#2563EB">{n}</font>&nbsp;&nbsp;{t}',h1))
def H2(t): story.append(Paragraph(t,h2))
def steps(items):
    story.append(ListFlowable([ListItem(Paragraph(i,step),leftIndent=16,value=k+1) for k,i in enumerate(items)],
        bulletType="1",bulletFontName="SB",bulletColor=BLUE,leftIndent=16,bulletFontSize=10))
    story.append(Spacer(1,4))
def bullets(items):
    story.append(ListFlowable([ListItem(Paragraph(i,step),leftIndent=12) for i in items],
        bulletType="bullet",start="•",bulletColor=BLUE,leftIndent=12))
    story.append(Spacer(1,4))
def box(t,bg=SOFT,label="Importante"):
    tb=Table([[Paragraph(f"<b>{label}.</b> {t}",body)]],colWidths=[170*mm])
    tb.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,-1),bg),("LEFTPADDING",(0,0),(-1,-1),9),
        ("RIGHTPADDING",(0,0),(-1,-1),9),("TOPPADDING",(0,0),(-1,-1),7),("BOTTOMPADDING",(0,0),(-1,-1),3)]))
    story.append(Spacer(1,3)); story.append(tb); story.append(Spacer(1,7))
def table(rows,widths):
    data=[[Paragraph(c, ParagraphStyle("th",parent=body,fontName="SB",textColor=colors.white) if r==0 else body) for c in row] for r,row in enumerate(rows)]
    tb=Table(data,colWidths=[w*mm for w in widths],repeatRows=1)
    tb.setStyle(TableStyle([("BACKGROUND",(0,0),(-1,0),BLUE),("VALIGN",(0,0),(-1,-1),"TOP"),
        ("LINEBELOW",(0,1),(-1,-1),0.5,LINE),("LEFTPADDING",(0,0),(-1,-1),6),("RIGHTPADDING",(0,0),(-1,-1),6),
        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),2)]))
    story.append(tb); story.append(Spacer(1,8))

# ---------- Portada
story.append(Spacer(1,55*mm))
P("SaaS Almacén",ParagraphStyle("k",fontName="SB",fontSize=11,textColor=BLUE,spaceAfter=8))
P("Guía de uso paso a paso",title)
P("Desde crear tu cuenta e iniciar sesión hasta agregar productos, mover existencias, comprar, vender y administrar tu equipo.",sub)
table([["Etapa","Qué aprenderás"],
 ["1. Primeros pasos","Crear cuenta, iniciar sesión, verificación en dos pasos, crear tu empresa y elegir plan."],
 ["2. Preparar el almacén","Ubicaciones, alta de productos (uno por uno o con Excel) y existencias iniciales."],
 ["3. Día a día","Entradas, salidas, cambios de lugar, correcciones, existencias bajas y conteos."],
 ["4. Compras","Proveedores, órdenes de compra, recepción de mercancía y sugerencias de qué pedir."],
 ["5. Ventas","Caja, cobro en mostrador, tickets, devoluciones, cotizaciones, pedidos y ventas a plazos."],
 ["6. Administración","Equipo y roles, seguridad, bitácora, plan, exportaciones y soporte."]],[45,125])
P("Versión de noviembre de 2026. Los nombres de botones y pantallas corresponden al sistema en esta fecha. Algunas secciones solo aparecen si tu plan incluye el módulo (Compras o Ventas) y si tu rol tiene permiso.",small)
story.append(PageBreak())

# ---------- 0 Antes de empezar
H1("0","Antes de empezar")
P("El sistema se usa desde el navegador, en computadora o teléfono. No hay que instalar nada. En computadora el menú está a la izquierda; en el teléfono aparece abajo con cuatro secciones y el botón <b>Más</b> para el resto.")
H2("Las secciones del menú")
table([["Sección","Para qué sirve"],
 ["Inicio","Lo que pide atención hoy: existencias bajas, últimos movimientos y la guía de primeros pasos."],
 ["Ventas","Mostrador para cobrar, caja, historial, cotizaciones, pedidos y cuentas por cobrar (módulo Ventas)."],
 ["Inventario","Tu catálogo de productos, sus existencias, presentaciones y precios."],
 ["Movimientos","Entradas, salidas, cambios de lugar, correcciones y el historial de todo lo que se movió."],
 ["Conteos","Contar físicamente una ubicación y ajustar el sistema a lo que realmente hay."],
 ["Compras","Proveedores, órdenes de compra y recepción de mercancía (módulo Compras)."],
 ["Configuración","Tu cuenta, seguridad, equipo, ubicaciones, plan, ajustes de ventas y bitácora."]],[35,135])
H2("Quién puede hacer qué (roles)")
P("Cada persona del equipo tiene uno o varios roles. El <b>titular</b> es quien creó la empresa: además de todo, es el único que compra o renueva el plan, cambia el IVA y abre el acceso de soporte.")
table([["Rol","Puede"],
 ["Administrador","Casi todo: productos, movimientos, compras, equipo y configuración."],
 ["Almacén","Productos, entradas, salidas, conteos y recepción de mercancía."],
 ["Comprador","Proveedores, órdenes de compra y sus costos."],
 ["Cajero","Abrir su caja, cobrar, cotizar y registrar abonos."],
 ["Encargado de caja","Lo del cajero, más autorizar descuentos grandes, hacer cortes, cancelar y devolver ventas."],
 ["Consulta","Solo ver; no cambia nada."]],[40,130])
box("Si no ves una sección o un botón que esta guía menciona, lo más probable es que tu rol no lo permita o que el módulo no esté contratado. Pídeselo al titular o a un administrador.")
story.append(PageBreak())

# ---------- 1 Cuenta e inicio de sesión
H1("1","Crear tu cuenta e iniciar sesión")
H2("1.1 Crear tu cuenta (solo la primera vez)")
steps([
 "Entra a la página del sistema y pulsa <b>Crear cuenta</b> (pantalla «Crea tu cuenta»).",
 "Escribe tu nombre, tu correo electrónico y una contraseña segura.",
 "Marca que aceptas los <b>Términos</b> y el <b>Aviso de privacidad</b> y envía el formulario.",
 "Revisa tu correo: te llega un enlace para confirmar tu cuenta. Ábrelo <b>en el mismo navegador</b> donde vas a entrar.",
 "El enlace te pide tu contraseña: escríbela y tu correo queda confirmado. Si no te llegó, en la pantalla «Verifica tu correo» puedes pedir que se reenvíe."])
P("Si alguien de tu empresa te invitó, no te registres por tu cuenta: abre el enlace de la invitación que te llegó por correo y crea ahí tu contraseña. Entrarás directo a esa empresa con el rol que te asignaron.",small)
H2("1.2 Iniciar sesión")
steps([
 "Ve a la pantalla «Inicia sesión» y escribe tu correo y contraseña.",
 "Si tienes activada la verificación en dos pasos, el sistema te pide un <b>código de 6 dígitos</b> de tu app de autenticación (Google Authenticator, Microsoft Authenticator, etc.). Escríbelo y pulsa continuar.",
 "Si hay una versión nueva de los términos, verás «Acepta los términos»: léelos y acéptalos para seguir.",
 "Llegas a <b>Inicio</b>."])
H2("1.3 Verificación en dos pasos (obligatoria para el titular)")
P("El titular de la empresa debe proteger su cuenta con un segundo paso. La primera vez que entra, el sistema lo lleva a «Activa la verificación en dos pasos».")
steps([
 "Instala en tu teléfono una app de autenticación.",
 "En la app, agrega una cuenta escaneando el <b>código QR</b> que muestra la pantalla (en el teléfono puedes usar «Abrir en la app de este teléfono»).",
 "Escribe el código de 6 dígitos que muestra la app para confirmar.",
 "Guarda los <b>códigos de recuperación</b> que aparecen: se muestran una sola vez. Sirven para entrar si pierdes el teléfono (cada uno funciona una vez)."])
box("Guarda los códigos de recuperación en un lugar seguro fuera del teléfono (impresos o en un gestor de contraseñas). Puedes generar nuevos en Configuración &gt; Seguridad.",WARN,"Consejo")
H2("1.4 Si olvidaste tu contraseña")
steps(["En «Inicia sesión» pulsa <b>¿Olvidaste tu contraseña?</b>.",
 "Escribe tu correo. Si tiene cuenta, te llega un enlace.",
 "Abre el enlace, escribe tu contraseña nueva y vuelve a iniciar sesión."])
P("Por seguridad, después de varios intentos fallidos el sistema bloquea por un rato los intentos de entrar.",small)
story.append(PageBreak())

# ---------- 2 Empresa y plan
H1("2","Crear tu empresa y elegir tu plan")
H2("2.1 Crear la empresa")
P("Al entrar por primera vez sin empresa, el sistema te lleva a «Crea tu empresa».")
steps(["Escribe el <b>nombre del negocio</b> y, si quieres, la razón social.",
 "Revisa la <b>zona horaria</b> (define qué es «hoy» en reportes y filtros por fecha).",
 "Pulsa continuar. Tú quedas como <b>titular</b> y se crea una ubicación «General» para empezar."])
H2("2.2 Comprar o renovar el plan (solo el titular)")
steps(["Ve a <b>Configuración &gt; Mi plan</b> y pulsa <b>Comprar o renovar</b> (pantalla «Comprar plan»).",
 "Elige el nivel (por cantidad de productos activos) y los módulos que quieres agregar a Inventario: <b>Compras</b> y/o <b>Ventas</b>.",
 "Si tienes un código promocional, escríbelo en «¿Tienes un código?».",
 "Elige cómo pagar (tarjeta, PayPal o Mercado Pago) y completa el pago en la página del proveedor.",
 "Al confirmarse el pago, el plan se activa solo. «Mi plan» muestra hasta cuándo está vigente."])
box("Los precios ya incluyen IVA. En los últimos 15 días del plan, Inicio y «Mi plan» te avisan que se acerca el vencimiento. Si el plan vence, todo queda en <b>solo lectura</b>: puedes consultar y exportar, pero no registrar cambios hasta renovar.")
H2("2.3 La guía de primeros pasos")
P("En Inicio verás «Primeros pasos». Se va marcando sola conforme avanzas: agregar productos, registrar existencias y hacer tu primer movimiento. Es el mismo orden que sigue esta guía.")

# ---------- 3 Preparar
H1("3","Preparar tu almacén")
H2("3.1 Ubicaciones (opcional pero recomendado)")
P("Las ubicaciones dicen dónde guardas cada cosa. Si tienes un solo lugar, puedes usar «General» y saltar este paso.")
steps(["Ve a <b>Configuración &gt; Ubicaciones</b> y pulsa <b>Agregar ubicación</b>.",
 "Elige el tipo: <b>Zona</b>, <b>Pasillo</b> o <b>Estante</b>. Una zona puede tener pasillos y un pasillo puede tener estantes.",
 "Ponle el nombre que usan en tu negocio (por ejemplo «Bodega», «Pasillo 2», «Estante A») y en «¿Dónde va?» elige dentro de qué ubicación queda.",
 "Repite para cada lugar. En las pantallas verás la ruta completa, por ejemplo «Bodega › Pasillo 2 › Estante A»."])
P("Una ubicación no se borra: se <b>archiva</b> para que deje de aparecer, sin perder su historial.",small)
story.append(PageBreak())

H1("4","Agregar productos")
P("Tienes dos caminos. Usa el Excel si ya tienes tu catálogo en una hoja de cálculo; usa el alta manual para pocos productos.")
H2("4.1 Uno por uno")
steps(["Ve a <b>Inventario</b> y pulsa <b>Agregar producto</b> (pantalla «Nuevo producto»).",
 "Escribe el <b>nombre</b>, la <b>clave</b> (la que escribes a mano) y, si lo tiene, el <b>código de barras</b>. Puedes agregar categoría y marca para filtrar después.",
 "En «¿En qué unidad lo controlas?» elige la unidad base: pieza, metro, kilo, litro, etc., y la precisión (por ejemplo, piezas completas o con decimales).",
 "Si lo compras o vendes por caja, paquete, etc., agrega una <b>presentación</b>: por ejemplo «Caja = 100 piezas». El sistema convierte solo: 3 cajas × 100 = 300 piezas.",
 "Opcional: escribe un <b>mínimo</b>. Cuando las existencias bajen de ahí, el producto aparecerá en «Existencias bajas».",
 "Pulsa <b>Guardar producto</b>."])
H2("4.2 Muchos a la vez con Excel")
steps(["Ve a <b>Inventario</b> y pulsa <b>Importar Excel</b>.",
 "Descarga la plantilla si la necesitas, llénala y sube tu archivo en «Tu Excel con productos» (XLSX o CSV).",
 "En «Columnas de tu archivo» indica qué columna es cada dato (nombre, clave, unidad, existencia, etc.).",
 "Revisa «Revisión de tu archivo»: el sistema marca cada fila con problema y te dice en qué columna está el error, con el número de fila del archivo. Corrige tu Excel y vuelve a subirlo si hace falta.",
 "Verás cuántos productos son nuevos, cuántos ya existen y cuántos lugares de tu plan ocuparán. Pulsa confirmar.",
 "La importación se procesa en segundo plano; la pantalla se actualiza sola hasta terminar. Si tu archivo traía existencias, entran como saldo inicial."])
box("La importación no borra nada. Si algo sale mal antes de confirmar, usa <b>Cancelar importación</b>.",SOFT,"Tranquilidad")
H2("4.3 Existencias iniciales")
P("Si diste de alta productos a mano, registra lo que ya tienes en el almacén:")
steps(["Ve a <b>Movimientos</b> y pulsa el enlace <b>Saldo inicial</b>.",
 "Busca el producto por nombre, clave o código de barras.",
 "Elige la ubicación, en qué lo contaste (pieza o presentación) y la cantidad. El sistema te muestra la equivalencia antes de confirmar.",
 "Guarda. El saldo inicial solo se puede usar una vez por ubicación y antes de cualquier otro movimiento del producto; después, las cantidades cambian con entradas, salidas y conteos."])
H2("4.4 Cambiar o archivar un producto")
bullets(["Abre el producto desde la lista de Inventario (toca toda la fila) y usa <b>Editar datos</b>, <b>Cambiar contenido</b> de una presentación o <b>Cambiar precios</b>.",
 "<b>Archivar producto</b> lo quita del catálogo y libera un lugar de tu plan, sin borrar su historial. Se puede reactivar desde los archivados (enlace al pie de la lista)."])
story.append(PageBreak())

# ---------- 5 Día a día
H1("5","Manejar el inventario día a día")
P("Todo cambio de existencias se hace con un <b>movimiento</b>. El sistema nunca permite escribir la cantidad directamente: así siempre sabes quién movió qué, cuándo y por qué.")
H2("5.1 Registrar una entrada (llegó mercancía)")
steps(["En <b>Movimientos</b> pulsa <b>Registrar entrada</b>.",
 "Busca el producto, elige la ubicación, la presentación (o la unidad) y la cantidad.",
 "Revisa la equivalencia que muestra el sistema (por ejemplo «2 cajas × 100 = 200 piezas de Tornillo») y confirma."])
P("Si usas el módulo Compras, la mercancía de un proveedor entra mejor con <b>Recibir mercancía</b> desde su orden de compra (sección 7).",small)
H2("5.2 Registrar una salida (uno o varios productos)")
steps(["En <b>Movimientos</b> pulsa <b>Registrar salida</b>.",
 "Agrega productos escribiendo o con el <b>lector de código de barras</b>: cada lectura suma una línea, puedes leer seguido sin esperar.",
 "Ajusta cantidad, presentación y ubicación de cada línea y escribe el motivo si aplica.",
 "Confirma. Si alguna línea no tiene existencias suficientes, el sistema te dice cuál y no descuenta nada hasta que se corrija."])
box("Con el módulo Ventas, lo que cobras en el mostrador ya descuenta existencias. Usa «Registrar salida» solo para lo que sale sin venta (merma, uso interno, muestras).")
H2("5.3 Otras operaciones (enlaces bajo el título de Movimientos)")
table([["Enlace","Cuándo usarlo"],
 ["Cambiar de lugar","Mover existencias de una ubicación a otra sin que cambie el total."],
 ["Corregir existencias","Cuando lo que hay no coincide con el sistema y necesitas ajustar un producto. Pide motivo y queda en la bitácora."],
 ["Saldo inicial","Solo al empezar, para registrar lo que ya tenías (sección 4.3)."]],[45,125])
H2("5.4 Si te equivocaste en un movimiento")
P("Un movimiento no se edita ni se borra. Ábrelo desde el historial y usa <b>Reversar</b>: se crea el movimiento contrario y luego registras el correcto. Las recepciones de compras y las ventas no se reversan desde aquí; se corrigen con una devolución desde su propio módulo.")
H2("5.5 Consultar el historial")
P("La lista de <b>Movimientos</b> muestra todo en orden. Busca por producto y usa <b>Más filtros</b> para elegir tipo, ubicación, persona o fechas. Toca una fila para ver el detalle.")
H2("5.6 Existencias bajas")
P("En Inicio y en <b>Inventario &gt; Existencias bajas</b> aparecen los productos por debajo de su mínimo. Desde ahí (con Compras) puedes ir a <b>Qué pedir</b> para generar órdenes.")
story.append(PageBreak())

# ---------- 6 Conteos
H1("6","Conteos físicos")
P("Un conteo compara lo que realmente hay en una ubicación con lo que dice el sistema. <b>Contar no cambia tus existencias hasta que pulses «Aplicar conteo».</b>")
steps(["Ve a <b>Conteos</b> y pulsa <b>Iniciar un conteo</b>. Elige «¿Qué ubicación vas a contar?».",
 "Busca o escanea cada producto que cuentas, elige en qué lo contaste y escribe la cantidad. Puedes seguir vendiendo o moviendo mercancía mientras cuentas: el sistema lo toma en cuenta.",
 "Si te equivocaste en un producto, usa <b>Quitar</b> para borrar sus capturas y contarlo de nuevo.",
 "Revisa las diferencias que muestra el sistema (lo contado contra lo que había).",
 "Pulsa <b>Aplicar conteo</b>. El sistema crea los ajustes necesarios y el conteo se cierra; ya no se puede capturar más en él."])
P("Si decides no aplicarlo, usa <b>Cancelar conteo</b>: se cierra sin cambiar tus existencias.",small)

# ---------- 7 Compras
H1("7","Compras (módulo Compras)")
H2("7.1 Proveedores")
steps(["Ve a <b>Compras &gt; Proveedores</b> y pulsa <b>Agregar proveedor</b>.",
 "Escribe el nombre y, si quieres, RFC, persona de contacto, teléfono y correo (el correo sirve para enviarle órdenes). Si ya existe uno parecido, el sistema te avisa.",
 "Pulsa <b>Guardar proveedor</b>.",
 "Dentro del proveedor, usa <b>Vincular producto</b> para indicar qué te vende y «¿Cómo se lo compras?» (por pieza o por caja)."])
H2("7.2 Hacer una orden de compra")
steps(["En <b>Compras</b> pulsa <b>Nueva orden</b>, elige el proveedor y pulsa <b>Empezar orden</b>.",
 "Agrega productos con <b>Agregar a la orden</b>: cantidad, presentación y, si tu rol lo permite, el costo.",
 "Revisa el borrador. Puedes descargarlo con <b>Descargar PDF</b> o mandarlo con <b>Enviar por correo</b>.",
 "Cuando ya se la diste al proveedor, pulsa <b>Confirmar orden</b>."])
H2("7.3 Recibir la mercancía")
steps(["Abre la orden y pulsa <b>Recibir mercancía</b>.",
 "Escribe lo que llegó de cada línea (vacío o 0 = no llegó) y a qué ubicación entra. Opcional: número de remisión o factura.",
 "Confirma. Las existencias suben y se guarda el último costo. Si faltó algo, la orden queda <b>parcial</b> y puedes recibir el resto después.",
 "Si lo que falta ya no llegará, usa <b>Cerrar con faltante</b>. Si algo llegó mal, usa <b>Devolver al proveedor</b>."])
H2("7.4 Qué pedir y reportes")
bullets(["<b>Qué pedir</b> sugiere cantidades según mínimos, existencias y lo que ya viene en camino, y crea los borradores por proveedor.",
 "<b>Reportes</b> muestra lo pendiente de recibir y lo comprado por proveedor; se descarga en Excel."])
story.append(PageBreak())

# ---------- 8 Ventas
H1("8","Ventas (módulo Ventas)")
H2("8.1 Preparar Ventas (una vez)")
bullets(["<b>Precios:</b> abre cada producto en Inventario y pulsa <b>Cambiar precios</b>. Puedes poner precio a la pieza y, si quieres, un precio propio a cada presentación (si no, se calcula por su contenido).",
 "<b>IVA:</b> el titular indica en <b>Configuración &gt; Ventas</b> si sus precios ya incluyen IVA y la tasa (por omisión, 16 % incluido). Ahí también se ponen los topes de descuento por rol y los plazos de pago.",
 "<b>Equipo:</b> asigna los roles Cajero o Encargado de caja a quien cobra (sección 9)."])
H2("8.2 Abrir la caja (al empezar el turno)")
steps(["Ve a <b>Ventas &gt; Caja</b>.",
 "Escribe el «Efectivo con el que empiezas» (fondo) y abre tu caja. Sin caja abierta no se puede cobrar."])
H2("8.3 Cobrar una venta")
steps(["En <b>Ventas</b> busca o escanea los productos. Ajusta cantidad y presentación de cada uno.",
 "Opcional: <b>Elegir cliente</b> (o <b>Registrar cliente nuevo</b> con solo el nombre). Sin cliente, la venta es a «Público en general».",
 "Opcional: <b>Aplicar descuento</b> en porcentaje con motivo. Si pasa de tu tope, otra persona autorizada escribe su contraseña en tu pantalla para aprobarlo.",
 "Elige la forma de pago: Efectivo (escribe lo recibido y el sistema muestra el cambio), Tarjeta o Transferencia (con referencia), o <b>Varias</b> para combinar.",
 "Pulsa <b>Cobrar</b>. Luego puedes <b>Ver ticket</b> e imprimirlo (80 mm) o compartir su enlace con el cliente. El ticket no es comprobante fiscal."])
H2("8.4 Durante y al final del turno")
bullets(["<b>Meter o sacar dinero:</b> en Caja, registra entradas o salidas de efectivo con su motivo (por ejemplo, pago de un garrafón).",
 "<b>Corte de caja:</b> al terminar, cuenta el efectivo y escríbelo sin ver lo esperado. El sistema compara con lo que debía haber (fondo + ventas en efectivo + entradas − salidas) y muestra tarjeta y transferencias por separado."])
H2("8.5 Devoluciones y cancelaciones")
steps(["Busca la venta en <b>Historial de ventas</b> (por número, cliente, fechas o cajero) y ábrela.",
 "Pulsa <b>Devolver productos</b>, elige qué y cuánto regresa y el motivo; o <b>Cancelar venta</b> para regresar todo.",
 "La mercancía vuelve al inventario y el sistema te dice cuánto entregar al cliente."])
H2("8.6 Cotizaciones, pedidos y ventas a plazos")
steps(["<b>Nueva cotización</b> (en Ventas &gt; Cotizaciones): cliente, productos, vigencia y, si aplica, plazo y enganche. Descárgala en PDF o usa <b>Enviar por correo</b>.",
 "Cuando el cliente responde, márcala aceptada o rechazada.",
 "De una aceptada, pulsa <b>Hacer pedido</b>. El pedido respeta los precios cotizados.",
 "Cuando entregas, abre el pedido y usa <b>Entregar y cobrar</b> (puede ser en partes). Un pedido no aparta mercancía: se valida al entregar.",
 "En una venta a plazos solo se cobra el enganche; el resto queda en <b>Cuentas por cobrar</b>. Ahí registras cada abono (o <b>Liquidar todo</b>), ves lo vencido, mandas <b>Recordar pago</b> y el <b>Estado de cuenta</b> del cliente."])
H2("8.7 Reportes de ventas")
P("<b>Reportes de ventas</b> muestra ventas por día, por producto o por cajero (este mes por omisión) y se descarga en Excel. También hay reporte de cotizaciones y de cartera. La ganancia solo la ve quien tiene permiso de ver costos.")
story.append(PageBreak())

# ---------- 9 Admin
H1("9","Administrar tu empresa")
H2("9.1 Invitar a tu equipo")
steps(["Ve a <b>Configuración &gt; Equipo</b> e invita a la persona con su correo.",
 "Elige su rol o roles (sección 0). Los roles de caja solo aparecen si tienes Ventas.",
 "La persona recibe un correo, abre la invitación y crea su contraseña.",
 "Desde Equipo puedes cambiar roles o <b>Desactivar</b> a alguien cuando deje de trabajar contigo (conserva su historial)."])
P("El número de personas depende de tu plan. Solo el titular puede transferir la titularidad a otra persona.",small)
H2("9.2 Tu cuenta y seguridad")
bullets(["En <b>Configuración</b>, apartado <b>Seguridad</b>: activa la verificación en dos pasos, genera nuevos códigos de recuperación y revisa los dispositivos donde tu cuenta está abierta (<b>Cerrar las demás</b> si no reconoces alguno).",
 "Cambia entre modo claro y oscuro con el interruptor del menú.",
 "Para salir, usa <b>Cerrar sesión</b>."])
H2("9.3 Bitácora")
P("<b>Configuración &gt; Bitácora</b> registra los cambios sensibles: ajustes, reversas, cambios de equipo, precios, descuentos y más, con quién y cuándo. No se puede borrar.")
H2("9.4 Exportar tu información")
P("En Inventario, el enlace al pie de la lista te permite descargar productos, existencias y movimientos en Excel o CSV. Cada exportación queda en la bitácora. Exportar funciona aunque el plan haya vencido.")
H2("9.5 Soporte")
P("Si necesitas que el equipo de soporte vea tu cuenta, el titular abre el acceso desde <b>Configuración</b>, apartado <b>Soporte</b> por 24 horas. Soporte solo puede mirar, no cambia nada, y su entrada queda en la bitácora. Puedes cerrarlo antes.")

# ---------- 10 Resumen
H1("10","Resumen: el orden recomendado")
table([["#","Paso","Dónde"],
 ["1","Crear tu cuenta y confirmar el correo","Crea tu cuenta"],
 ["2","Iniciar sesión y activar la verificación en dos pasos","Inicia sesión"],
 ["3","Crear tu empresa","Crea tu empresa"],
 ["4","Comprar el plan con los módulos que necesitas","Configuración &gt; Mi plan"],
 ["5","Crear ubicaciones (si tienes más de un lugar)","Configuración &gt; Ubicaciones"],
 ["6","Agregar productos (Excel o uno por uno)","Inventario"],
 ["7","Registrar existencias iniciales","Movimientos &gt; Saldo inicial"],
 ["8","Invitar a tu equipo con sus roles","Configuración &gt; Equipo"],
 ["9","Si vendes: precios, IVA y abrir caja","Inventario, Configuración &gt; Ventas, Ventas &gt; Caja"],
 ["10","Operar: entradas, salidas, ventas y compras","Movimientos, Ventas, Compras"],
 ["11","Revisar existencias bajas y hacer conteos periódicos","Inicio, Conteos"],
 ["12","Revisar reportes y hacer el corte de caja","Reportes, Ventas &gt; Caja"]],[10,95,65])
H2("Problemas frecuentes")
table([["Situación","Qué hacer"],
 ["No veo una sección o un botón","Tu rol no lo permite o el módulo no está contratado. Pide acceso al titular."],
 ["No me deja registrar nada","El plan venció y está en solo lectura. El titular debe renovarlo en Mi plan."],
 ["«No hay existencias suficientes»","Revisa la ubicación elegida; quizá está en otra. Usa Cambiar de lugar o Corregir existencias."],
 ["No puedo cobrar","Abre tu caja en Ventas &gt; Caja. Revisa que el producto tenga precio de venta."],
 ["Perdí mi teléfono con el código","Entra con un código de recuperación y vuelve a activar la verificación."],
 ["Se cortó la conexión al confirmar","No repitas a ciegas: vuelve a la pantalla; el sistema detecta si ya se guardó."]],[60,110])

def deco(c,doc):
    c.saveState()
    if doc.page>1:
        c.setFont("S",8.5); c.setFillColor(MUTED)
        c.drawString(20*mm,12*mm,"SaaS Almacén · Guía de uso")
        c.drawRightString(letter[0]-20*mm,12*mm,f"Página {doc.page}")
        c.setStrokeColor(LINE); c.line(20*mm,16*mm,letter[0]-20*mm,16*mm)
    else:
        c.setFillColor(BLUE); c.rect(0,letter[1]-8*mm,letter[0],8*mm,fill=1,stroke=0)
    c.restoreState()

doc=SimpleDocTemplate(sys.argv[1],pagesize=letter,leftMargin=20*mm,rightMargin=20*mm,topMargin=18*mm,bottomMargin=22*mm,
    title="Guía de uso - SaaS Almacén",author="SaaS Almacén")
doc.build(story,onFirstPage=deco,onLaterPages=deco)
