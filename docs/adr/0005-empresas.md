# ADR 0005 — Alta de empresa con titular

Fecha: 2026-10-03 · Estado: aceptada · Pasos: PLT-10 (base para PLT-11 a PLT-13)

## Contexto

Cada dato de negocio pertenece a una empresa (`organization_id`). La persona que se registra debe terminar con una empresa propia de la que es titular, la única cuenta que contrata o cancela (USR-03A), y el titular debe usar MFA (PLT-08B).

## Decisión

- Después de confirmar el correo, quien no pertenece a ninguna empresa llega a `/crear-empresa` (nombre del negocio y zona horaria de México). Las pantallas del negocio usan `requireOrganizationMember()` (`src/platform/tenancy`) y mandan ahí a quien no tiene empresa.
- La empresa y la membresía del titular se crean en **una transacción** (`createOrganization`): existen las dos o ninguna. Moneda fija MXN.
- **Una empresa por cuenta por ahora**: el alta se rechaza si la persona ya pertenece a una empresa. Para que dos envíos simultáneos no creen dos empresas, la transacción bloquea la fila del usuario (`SELECT … FOR UPDATE`) antes de revisar.
- Zonas horarias: lista cerrada de identificadores IANA de México con nombres conocidos (Centro, Sureste, Pacífico, Sonora, Noroeste, Chihuahua, Ciudad Juárez); Centro por defecto.
- Al crearla, la persona ya es titular: se le envía a activar la verificación en dos pasos antes de usar la app.

## Alternativas consideradas

- **Crear la empresa dentro del registro**: un formulario más largo antes de confirmar el correo y empresas huérfanas de cuentas nunca verificadas.
- **Varias empresas por cuenta desde el inicio**: queda abierto (pregunta al fundador sobre administrar varias empresas); el cambio de empresa activa (PLT-11) ya revalida la membresía, así que permitirlo después solo relaja la regla de `createOrganization`.

## Consecuencias

- Las invitaciones (USR-04/05) agregan membresías a una empresa existente sin pasar por esta pantalla.
- La auditoría del alta se agrega con la bitácora (PLT-14).
