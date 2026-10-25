# ADR 0025: Alertas operativas por correo desde el worker

- **Estado:** aceptada.
- **Fecha:** 2026-10-25.

## Contexto

PIL-04 pide que los errores, una cola detenida y un respaldo fallido generen avisos. Ya existía `checkHealth` (`/api/salud`, BAS-11), que dice qué falla, pero nadie lo leía salvo un monitor externo (UptimeRobot), y el respaldo fallido solo se notaba cuando el último correcto pasaba de 26 horas.

## Decisión

- **Una sola fuente de lo que falla: `checkHealth`.** Las alertas no repiten revisiones.
- **El worker hace una ronda cada minuto** (`runAlertRound`, `src/platform/ops/alerts.ts`):
  - llama `checkHealth` en su proceso (base, cola, respaldo, latido, sus propios errores);
  - consulta `/api/salud` de la app web (`HEALTH_URL`, por defecto `http://127.0.0.1:3000/api/salud`), que aporta los errores de la app; si no responde, la falla es `web`;
  - junta las dos listas.
- **Sin ruido** (`alertChanges`, pura): una revisión cuenta cuando falla (o se recupera) dos rondas seguidas, y cada cambio se avisa una vez. Lo ya avisado se guarda en `alertas.json`, junto al latido (`/srv/almacen/shared/run/`), para que un reinicio (cada despliegue) no lo repita.
- **Aviso por correo** (`operationsAlertEmail`) a `ALERT_EMAIL`: qué empezó a fallar, qué se recuperó y qué sigue fallando. Siempre queda además una línea `ops_alert` en el registro. Sin `ALERT_EMAIL`, o si el correo no sale (SMTP sin configurar), queda solo el registro (`ops_alert_email_failed` como error); no se reintenta cada minuto.
- **Respaldo fallido al instante:** `deploy/bin/respaldo` deja `ultimo-respaldo.fallido` junto a `ultimo-respaldo` cuando termina con error (cualquier salida distinta de 0, incluso antes de leer su configuración) y lo borra al terminar bien. `checkHealth` marca `backup: falla` mientras la marca exista.

## Alternativas descartadas

- **Alertar desde la app web** (en `instrumentation.ts`): vería sus errores sin consultar nada, pero no avisaría si la web se cae y carga código de plataforma fuera de las rutas.
- **Temporizador de systemd con `curl`:** no tiene cómo mandar correo sin repetir la configuración SMTP en otro lado.
- **`OnFailure=` en la unidad del respaldo:** sirve solo cuando corre por systemd; `desplegar` también lo corre y la marca cubre los dos casos con menos piezas.

## Consecuencias

- Si el worker o el servidor entero se caen, nadie adentro puede avisar: eso lo cubre el monitor externo sobre `/api/salud` (UptimeRobot, `docs/DESPLIEGUE.md`), que ya reporta `worker: falla`.
- Un aviso tarda entre 1 y 2 minutos (dos rondas). Los umbrales siguen siendo los de `checkHealth`.
- Un correo que no sale se pierde (queda en el registro). Es a propósito: reintentar cada minuto llenaría el registro de errores y dispararía la alerta de errores.
- El fundador debe llenar `ALERT_EMAIL` y el SMTP (ADR 0023). `instalar.sh` agrega la clave vacía a instalaciones existentes.
