# ADR 0007 — Contrato y registro de módulos

Fecha: 2026-10-04 · Estado: aceptada · Pasos: MOD-01, MOD-02

## Contexto

El producto se vende por módulos sobre una base obligatoria (Inventario). Derechos, guardas de servidor, menú y pantallas de plan necesitan la misma respuesta a «qué módulos existen, de qué dependen y qué permisos son suyos». La plataforma (`src/platform`) no puede importar módulos de negocio (`src/modules`), por la regla de capas.

## Decisión

- **Contrato** (`src/platform/billing/contract.ts`): cada módulo se describe con un objeto `ModuleContract` (id, nombre, versión semver, disponibilidad, si es la base, dependencias, partes del núcleo que usa, permisos propios y límites). `defineModule` lo valida al cargar y lo congela.
- **Cada módulo declara su contrato** en `src/modules/<módulo>/contract.ts` y lo exporta por su `index.ts`. Sus permisos son las entradas del catálogo aprobado con su prefijo (`inventory.*`, `purchasing.*`); la matriz sigue siendo la única fuente de permisos.
- **Registro** (`createModuleRegistry` en plataforma, puro): valida el conjunto (ids únicos, exactamente una base, dependencias registradas, sin ciclos, un módulo disponible no depende de uno no disponible, cada permiso con un solo dueño). Si algo falla, la aplicación no arranca.
- **Punto de composición**: `src/modules/registry` (`moduleRegistry`) reúne los contratos. Es la única pieza que conoce todos los módulos; la plataforma recibe ids y contratos como datos.
- **Ventas y CRM** se registran como `unavailable` (sin permisos todavía) para poder nombrarlos sin que nada los active. Cada uno tendrá su carpeta y permisos en su etapa (VEN-02, CRM).
- El módulo de un permiso se obtiene del registro (`moduleOfPermission`); los permisos `platform.*` no pertenecen a ningún módulo.

## Consecuencias

- Agregar un módulo = su carpeta con contrato + una línea en `src/modules/registry` + sus permisos en la matriz aprobada. Las pruebas fallan si un permiso de negocio queda sin módulo.
- No hay módulos cargados en tiempo de ejecución ni código subido por clientes.
- Los derechos contratados (qué empresa tiene qué módulo y con qué límite) no viven en el contrato: llegan con MOD-03 y MOD-04.
