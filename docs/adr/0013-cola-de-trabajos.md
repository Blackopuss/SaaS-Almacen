# ADR 0013 — Cola de trabajos en MySQL y worker

Fecha: 2026-10-05 · Estado: aceptada · Paso: IMP-01

## Contexto

Importar un archivo con miles de productos, generar una exportación o confirmar saldos iniciales tarda más de lo que debe durar una petición web y no puede perderse si el servidor se reinicia a la mitad. El plan pide un worker con cola durable en MySQL, reintentos con límite y que cada trabajo conserve el contexto de su empresa. Todo corre hoy en una sola máquina, sin servicios adicionales.

## Decisión

- **La cola es una tabla** (`job`) en la misma base: tipo, datos (`payload`, JSON de hasta 64 KB), estado (`PENDING`, `RUNNING`, `DONE`, `FAILED`), intentos, máximo de intentos, cuándo puede correr (`runAt`), quién lo tiene (`lockedBy`, `lockedAt`), último error y resultado. No se agrega Redis ni otro servicio: un trabajo se encola en la **misma transacción** que el cambio que lo origina, así existe solo si ese cambio existió.
- **Cada trabajo es de una empresa.** `job` es una tabla de empresa (`TENANT_MODELS`, `organizationId` obligatorio). El manejador recibe la empresa de la fila —nunca una leída del `payload`— y trabaja con `forOrganization`. Las tareas de toda la plataforma (como la reconciliación) no son trabajos de esta cola: son comandos programados.
- **El worker es un proceso aparte** (`npm run worker`, `scripts/worker.mts`). Toma un trabajo vencido con `SELECT … FOR UPDATE SKIP LOCKED`, lo marca `RUNNING`, llama a su manejador y registra el final. Pueden correr varios a la vez sin tomar el mismo trabajo. La cola (`src/platform/jobs`) es infraestructura y consulta entre empresas con el cliente sin filtro; es el único código de plataforma que lo hace sobre `job`.
- **Los manejadores los declaran los módulos** y se reúnen en `src/modules/registry/jobs.ts`; la plataforma no importa módulos: el proceso del worker le entrega la lista.
- **Al menos una vez.** Si el worker muere, el trabajo queda `RUNNING`; pasado el tiempo límite (30 min) otro worker lo retoma. Por eso un manejador puede correr dos veces para el mismo trabajo y **debe ser idempotente** (el id del trabajo sirve de clave). Solo el worker que tiene el trabajo puede cerrarlo: una respuesta tardía del anterior no pisa el resultado.
- **Reintentos con límite.** Un intento fallido vuelve a `PENDING` con espera creciente (5 s, 10 s, 20 s… hasta 15 min) hasta `maxAttempts` (5 por defecto, entre 1 y 20, con `CHECK`); después queda `FAILED` y nadie lo reintenta. Un tipo sin manejador falla de inmediato. El error guardado es un texto corto para personas, sin trazas; el detalle va al registro del proceso.

## Consecuencias

- No hay un servicio más que instalar, respaldar o vigilar; la cola entra en el respaldo de la base.
- El worker debe estar corriendo para que los trabajos avancen: en desarrollo se arranca a mano; en el servidor (BAS-09..11) será un servicio con reinicio automático y alerta si la cola crece o hay trabajos `FAILED`.
- La cola sondea cada segundo cuando está vacía. Suficiente para importaciones; no es para tareas de milisegundos.
- Los trabajos terminados se quedan en la tabla (sirven de historial para la pantalla de importaciones). Pendiente: purgar los antiguos cuando haya volumen.
- Un trabajo largo debe avanzar por lotes y poder continuar donde se quedó (IMP-08), porque puede ser retomado.
- Pendiente: pantalla para ver trabajos de la empresa y su avance (llega con las importaciones); programar la reconciliación de saldos (INV-S03) como comando del servidor.
