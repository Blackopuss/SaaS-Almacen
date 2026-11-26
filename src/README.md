# `src/`: código de la aplicación

| Carpeta | Capa | Contenido |
| --- | --- | --- |
| `app/` | Pantallas | Rutas de Next.js: sitio público `(sitio)`, acceso `(auth)`, aplicación `(app)`, consola `interno`, rutas HTTP `api` |
| `modules/` | Módulos contratables | `inventory`, `purchasing`, `sales` y `registry` (los reúne) |
| `platform/` | Núcleo compartido | Cuentas, empresas, permisos, módulos y cobro, catálogo, ubicaciones, contactos, archivos, cola, correo, bitácora |
| `server/` | Infraestructura | Cliente de base de datos, `forOrganization` y `lockRows` |
| `components/` | Interfaz compartida | Menú, estados, formularios, tema, componentes base (`ui/`) |
| `lib/` | Utilidades puras | Decimales, ids, errores, logs, CSP |

Dirección de dependencias: `app → modules → platform → server → lib` (la plataforma nunca importa módulos; entre áreas solo por `index.ts`). La impone ESLint.

Explicación completa: [`docs/arquitectura/`](../docs/arquitectura/README.md).
