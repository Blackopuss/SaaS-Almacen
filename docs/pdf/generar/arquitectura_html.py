import markdown, re, sys, html
import os
base=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "arquitectura") + os.sep
files=["README.md","01-stack.md","02-estructura.md","03-patrones.md","04-recorrido-del-codigo.md","06-codigo-clave.md","05-calidad-y-operacion.md"]
parts=[]
for f in files:
    t=open(base+f,encoding="utf8").read()
    # enlaces internos a otros .md -> solo texto
    t=re.sub(r'\[([^\]]+)\]\((?!http)[^)]*\)', r'\1', t)
    h=markdown.markdown(t, extensions=["tables","fenced_code"])
    parts.append(f'<section class="doc">{h}</section>')
css="""
@page { size: Letter; margin: 18mm 16mm 18mm 16mm; }
body { font-family: 'Liberation Sans', Arial, sans-serif; color:#18181B; font-size:10pt; line-height:1.5; }
.cover { height: 230mm; display:flex; flex-direction:column; justify-content:center; border-top: 8px solid #2563EB; padding-left:4mm;}
.cover .k { color:#2563EB; font-weight:bold; font-size:11pt; letter-spacing:.04em }
.cover h1 { font-size:30pt; margin:6px 0 10px; border:0 }
.cover p { color:#52525B; font-size:13pt; max-width:150mm }
.doc { break-before: page; }
h1 { font-size:19pt; border-bottom:2px solid #2563EB; padding-bottom:4px; margin-top:0 }
h2 { font-size:13.5pt; color:#2563EB; margin-top:18px; break-after: avoid; }
h3 { font-size:11.5pt; margin-top:14px; break-after: avoid; }
table { border-collapse:collapse; width:100%; margin:8px 0 12px; font-size:8.8pt; }
th { background:#2563EB; color:#fff; text-align:left; padding:5px 6px; }
td { border-bottom:1px solid #E4E4E7; padding:5px 6px; vertical-align:top; }
tr { break-inside: avoid; }
code { font-family:'DejaVu Sans Mono', monospace; font-size:8.4pt; background:#F4F4F5; padding:1px 3px; border-radius:3px; }
pre { background:#0F172A; color:#E2E8F0; padding:10px 12px; border-radius:6px; font-size:7.8pt; line-height:1.4; white-space:pre-wrap; word-break:break-word; break-inside: avoid; }
pre code { background:none; color:inherit; padding:0; font-size:7.8pt; }
hr { border:0; border-top:1px solid #E4E4E7; margin:16px 0; }
li { margin:2px 0 }
"""
cover='''<div class="cover"><div class="k">SaaS Almacén</div><h1>Arquitectura y código</h1>
<p>Stack y por qué se eligió, estructura de carpetas, patrones de diseño, recorrido del código y las piezas más importantes explicadas con fragmentos reales.</p>
<p style="font-size:10pt">Noviembre de 2026 · Generado desde docs/arquitectura/ del repositorio</p></div>'''
open(sys.argv[1],"w",encoding="utf8").write(f'<!doctype html><html lang="es"><meta charset="utf-8"><title>Arquitectura y código - SaaS Almacén</title><style>{css}</style><body>{cover}{"".join(parts)}</body></html>')
