# ADR 0009 — Personal de plataforma y consola interna

Fecha: 2026-10-04 · Estado: aceptada (pendiente de confirmar con el fundador quién será personal) · Paso: MOD-09

## Contexto

En el piloto el cobro es asistido: el cliente paga por transferencia y alguien de nuestro equipo le asigna el plan. Esa persona necesita cambiar derechos de **cualquier** empresa, algo que ningún rol de cliente puede hacer (`platform.provisioning.manage` no lo tiene nadie, ni el titular).

## Decisión

- **Personal de plataforma = fila activa en `platform_staff`** (migración `platform_staff`). No es un rol de empresa, no se hereda por ser titular y no hay pantalla para otorgarlo: se agrega con `npm run staff -- add <correo>` y se retira con `npm run staff -- remove <correo>` (`list` para ver), por alguien con acceso a la base. Retirar conserva la fila con fecha.
- **MFA obligatoria** para el personal (`isMfaRequired`). La consola exige además que la MFA ya esté activa en la sesión.
- **Consola en `/interno`** (lista y búsqueda de empresas; plan actual; formulario «Asignar plan»). `requirePlatformStaff()` protege el layout, cada pantalla y cada acción; quien no es personal recibe **404** (la consola no se anuncia). `src/proxy.ts` pide sesión antes.
- **`provisionCompany`** (`src/platform/billing/provisioning.ts`) vuelve a comprobar que quien llama es personal y escribe en una transacción, con la empresa bloqueada: límites `active_products` y `users`, módulos (deben incluir la base, estar disponibles y traer sus dependencias) y la vigencia común. Los módulos que se quitan se cierran, no se borran. Motivo obligatorio.
- **Bitácora de la empresa:** evento `plan.provisioned` con el miembro del personal como autor, motivo, cupos, módulos y vigencia. El cliente lo ve en su bitácora.
- **Niveles propuestos** (100/2, 500/3, 1,000/5, 3,000/8, 10,000/15) aparecen como atajos para llenar el formulario; no hay precios ni versiones de plan sembradas mientras FUN-06 no los valide. Los derechos se escriben sin suscripción (permitido por ADR 0008).

## Consecuencias

- El personal puede leer nombre de empresa, nombre y correo del titular, uso de cupos y plan. No ve inventario ni datos de negocio.
- Comprometer una cuenta del personal permite cambiar derechos de todas las empresas (no leer ni cambiar sus datos): por eso MFA, bitácora y alta solo por línea de comandos.
- Pendiente: registro propio de accesos del personal (qué empresa abrió quién) y avisar por correo al titular cuando cambie su plan; revisar en la revisión de seguridad de la etapa MOD.
- Cuando exista cobro automático (BIL), los derechos saldrán de la pasarela y esta consola quedará para soporte y excepciones.
