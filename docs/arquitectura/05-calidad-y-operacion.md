# 5. Calidad, seguridad y operación

## Pruebas

| Tipo | Dónde | Qué cubre | Cómo corre |
| --- | --- | --- | --- |
| Unitarias | `src/**/*.test.ts`, junto al código | Reglas puras: IVA, precios, pagos, plazos, conversión, costo promedio, estados, permisos, contraste de colores | `npm run test:unit` |
| Integración | `tests/**/*.int.test.ts` | Servicios reales contra MySQL (`almacen_test`): aislamiento entre empresas, roles, concurrencia (`Promise.all` sobre el mismo producto), idempotencia, recorridos completos (compra → recepción → devolución; cotización → pedido → entrega → cobro → devolución; venta a plazos → abonos → liquidación) | `npm run test:integration` |
| Pantallas | `scripts/verify-ui.mjs`, `scripts/verify-a11y.mjs` | Foco visible, diálogos accesibles, 44 px táctiles, sin desbordamiento en móvil, axe-core WCAG 2.1 AA | Con `npm run dev` activo |
| Carga | `scripts/load-test.mts` | p95 < 500 ms con 20 personas | `npm run load:test` ([guía](../operacion/PRUEBA_CARGA.md)) |
| Conciliación | `npm run stock:reconcile` | Saldo = suma del historial; valor = existencias × costo promedio | En cualquier base |

Hay pruebas que custodian las reglas del proyecto:

- `tenant-db.test.ts`: falla si una tabla con `organizationId` no está protegida.
- `server-actions.int.test.ts`: falla si una Server Action no está revisada.
- `catalog.test.ts`: falla si el código y la matriz de permisos no coinciden.
- `module-guard.int.test.ts`: falla si un servicio de módulo no comprueba el módulo.
- `navigation.int.test.ts`: falla si una pantalla no revisa permisos.

## Antes de subir: `npm run check` + `npm run build`

`npm run check` corre en orden: tipos (`tsc`), ESLint, límites de arquitectura, formato (Prettier) y todas las pruebas. CI (`.github/workflows/ci.yml`) repite lo mismo en cada push sobre una base MySQL nueva y agrega `npm audit` de producción.

## Seguridad

- **Revisiones por etapa** en [`docs/seguridad/`](../seguridad/): modelo de amenazas por etapa (`REVISION_*.md`), tres auditorías (`AUDITORIA_*.md`) y la matriz OWASP ASVS 5.0 (`ASVS.md`).
- **Mínimo privilegio en la base:** la app usa `almacen_app` (solo SELECT/INSERT/UPDATE/DELETE); las migraciones usan `almacen_migrator`.
- **Cabeceras** en `next.config.ts` (HSTS, frame-ancestors, nosniff…) y **CSP con nonce** en `src/proxy.ts`.
- **Secretos** solo en `.env.local` (fuera de git) y en el servidor en `/etc/almacen`.
- **Archivos de clientes:** se guardan fuera de `public/`, se descargan con enlaces firmados y se leen sin evaluar fórmulas.
- **Logs** en JSON sin contraseñas, tokens ni enlaces (`log` de `@/lib`).

## Producción

```text
Internet ──HTTPS──► Caddy ──► next start (127.0.0.1:3000) ──► MySQL 9.4 (Docker, 127.0.0.1)
                                   ▲                               ▲
                              worker (systemd) ────────────────────┘
                              respaldo cifrado diario (age) + restauración de prueba
```

- **Desplegar:** `git push origin pruebas:produccion` con un commit que ya pasó CI. GitHub Actions compila, empaqueta y manda por SSH. `deploy/bin/desplegar` hace un respaldo verificado antes de migrar y **vuelve solo a la versión anterior** si la salud falla.
- **Migraciones solo de expansión:** nada que borre o renombre lo que la versión anterior usa; así `volver` funciona sin tocar la base.
- **Salud y alertas:** `/api/salud` informa base, worker, cola, respaldo y errores recientes; el worker avisa por correo cuando algo cambia de estado.
- Guía completa: [`docs/operacion/DESPLIEGUE.md`](../operacion/DESPLIEGUE.md).

## Desarrollo local

```bash
npm install
npm run setup        # secretos, bases, usuarios y migraciones (pide MYSQL_ROOT_PASSWORD)
npm run db:seed      # cuenta demo
npm run dev          # http://localhost:3000
npm run worker       # si el flujo usa la cola (importaciones, correos)
npm run check        # antes de subir
```
