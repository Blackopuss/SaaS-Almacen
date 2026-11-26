# PDF para compartir

| Archivo | Contenido |
| --- | --- |
| [`GUIA_DE_USO.pdf`](GUIA_DE_USO.pdf) | Guía paso a paso para personas usuarias: cuenta, empresa, productos, movimientos, conteos, compras, ventas y administración |
| [`ARQUITECTURA_Y_CODIGO.pdf`](ARQUITECTURA_Y_CODIGO.pdf) | Toda la carpeta [`docs/arquitectura/`](../arquitectura/) en un solo documento |

Son copias generadas: la fuente es el texto de los scripts (guía) y los documentos de `docs/arquitectura/`. Al cambiarlos, regenerar:

```bash
# Guía de uso (requiere Python con reportlab)
python3 docs/pdf/generar/guia_de_uso.py docs/pdf/GUIA_DE_USO.pdf

# Arquitectura y código (requiere Python con markdown, y Playwright del proyecto)
python3 docs/pdf/generar/arquitectura_html.py /tmp/arquitectura.html
node docs/pdf/generar/html_a_pdf.mjs /tmp/arquitectura.html docs/pdf/ARQUITECTURA_Y_CODIGO.pdf
```
