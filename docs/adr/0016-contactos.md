# ADR 0016 — Contactos compartidos en el núcleo

Fecha: 2026-10-10 · Estado: aceptada · Paso: CMP-01

## Contexto

Compras necesita proveedores; Ventas y CRM necesitarán clientes. En una ferretería es frecuente que el mismo negocio sea las dos cosas. Si cada módulo guardara su propia tabla, el mismo negocio existiría dos o tres veces con datos que se desincronizan, y contratar un módulo nuevo obligaría a capturarlo de nuevo. El plan ya decidió que catálogo y contactos pertenecen al núcleo (`platform`), no a un módulo.

## Decisión

- **Una tabla, `contact`, de la empresa**: nombre, razón social, RFC, persona de contacto, correo, teléfono, dirección y notas. Vive en `src/platform/contacts`; los módulos la usan por sus servicios y nunca leen las tablas de otro módulo.
- **Qué es un contacto para cada módulo es una faceta**, no una tabla: `isSupplier` (Compras) e `isCustomer` (Ventas y CRM). Un contacto tiene siempre al menos una (`CHECK`) y puede tener ambas. Una faceta nueva (por ejemplo «prospecto») es una columna más, no otra tabla.
- **Los permisos siguen siendo del módulo** (`purchasing.supplier.*`): poder editar un proveedor no concede operar con clientes. Cada servicio trabaja sobre su faceta; los datos compartidos (nombre, RFC, teléfono) son uno solo.
- **RFC opcional.** Cuando existe se guarda en mayúsculas y sin espacios, con la forma de 12 o 13 caracteres comprobada también en la base. No es único: dos contactos con el mismo RFC se advierten al capturar (CMP-02), no se prohíben, porque hay razones reales (sucursales, RFC genérico de público en general).
- **No se borra: se archiva** (`archivedAt`). Las órdenes y recepciones seguirán apuntando al contacto.
- **Aislamiento** como toda tabla de empresa: `organizationId`, llave `(organizationId, id)` para que las relaciones futuras sean compuestas, registro en `TENANT_MODELS` y uso solo con `forOrganization`.

## Consecuencias

- Las tablas que apunten a un contacto (producto-proveedor, órdenes) deben usar la relación compuesta y comprobar en su servicio que el contacto tenga la faceta que necesitan: la base garantiza que es de la misma empresa, no que sea proveedor.
- Quitar una faceta a un contacto que ya tiene documentos de ese tipo debe impedirse en el servicio cuando existan esos documentos (CMP-02 en adelante).
- Si Contactos llega a ser un límite comercial (el plan lo menciona para CRM), el contador de cupo se agrega como el de productos activos.
