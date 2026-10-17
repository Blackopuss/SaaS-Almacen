# ADR 0014 — Archivos privados por empresa

Fecha: 2026-10-05 · Estado: aceptada · Paso: IMP-02

## Contexto

Las importaciones reciben archivos del cliente (CSV/XLSX con su catálogo y saldos) y las exportaciones generan archivos para descargar. Son datos de negocio de una empresa: nadie más debe poder leerlos, ni adivinando una dirección ni reutilizando un enlace. Hoy todo corre en una máquina; más adelante habrá un servidor (BAS-09..11).

## Decisión

- **Un archivo es una fila de la empresa más sus bytes.** `stored_file` (tabla de empresa) guarda a quién pertenece, para qué es (`purpose`), nombre para mostrar, tipo de contenido, tamaño, `sha256`, quién lo subió y la clave del almacenamiento. Los bytes viven en una carpeta del servidor (`FILE_STORAGE_DIR`, por defecto `./storage`, ignorada por git) **fuera de lo que la aplicación publica**: no hay ruta estática hacia ellos.
- **La clave la arma el servidor con ids** (`<organizationId>/<fileId>`); el nombre que escribió la persona nunca se usa como ruta. El almacenamiento rechaza cualquier clave con otra forma.
- **El servidor decide el tipo de contenido** por la extensión permitida para ese propósito; lo que diga el navegador se ignora. Cada propósito (`FILE_PURPOSES` en `src/platform/files`) fija extensiones aceptadas, tamaño máximo y los permisos de la matriz para subir y para descargar. Hoy: `import_source` (CSV/XLSX, 10 MB) y `export` (CSV/XLSX, 50 MB).
- **Descarga solo por enlace temporal** (`createFileLink` → `/api/archivos/<id>?e=<vence>&s=<firma>`). La firma (HMAC-SHA256 con una clave derivada del secreto de la aplicación) cubre archivo, empresa, persona y vencimiento; dura 5 minutos. La ruta exige sesión, toma persona y empresa **de la sesión**, recalcula la firma y vuelve a comprobar el permiso y que el archivo sea de esa empresa. Un enlace de otra persona, de otra empresa, alterado o de un archivo borrado responde 404 sin distinguir el motivo; uno vencido, 410.
- **Siempre descarga, nunca se muestra:** `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store`.
- **Borrar** quita los bytes y marca la fila (`deletedAt`); queda el rastro de que existió.
- El código que procesa un archivo (una importación) lo lee con `readStoredFile(organizationId, fileId)`, siempre con la empresa del trabajo o de la sesión.

## Consecuencias

- La carpeta de archivos debe entrar en los respaldos junto con la base y tener permisos solo para el usuario del servicio (BAS-11). Con varios servidores haría falta un almacenamiento compartido (S3 o similar): el cambio queda aislado en `storage.ts`.
- Un enlace filtrado no sirve sin la sesión de la persona para quien se hizo.
- Rotar `BETTER_AUTH_SECRET` invalida los enlaces vigentes (duran 5 minutos: aceptable).
- Pendiente: purgar archivos de importaciones antiguas; antivirus o revisión de contenido si algún día se aceptan otros tipos; el contenido de CSV/XLSX se valida al leerlo (IMP-04) y las exportaciones protegen las celdas contra fórmulas (IMP-11).
