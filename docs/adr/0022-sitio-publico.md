# ADR 0022: Sitio público con three.js y anime.js

- **Estado:** aceptada.
- **Fecha:** 2026-10-16.

## Contexto

El fundador pidió el sitio público, adelantando parte de BIL-15:
- inicio;
- funciones;
- precios;
- nosotros;
- aviso de privacidad;
- términos.

Lo quiere muy dinámico, hecho con anime.js y three.js, y con la estética de la app. Mientras no haya servidor (BAS-09..11) no se puede avanzar a PIL.

## Decisión

- **Dependencias (versiones exactas, `npm audit` sin hallazgos nuevos):**
  - `three` 0.186.1 y `@types/three` 0.186.0 (esta última de desarrollo).
  - `animejs` 4.5.0.
- **Ubicación:** las páginas viven en `src/app/(sitio)/` y son Server Components con su propio encabezado y pie.
  - `/` deja de redirigir a `/inicio`.
  - Con cookie de sesión, el encabezado ofrece «Ir a mi almacén».
- **three.js:** solo se usa en el hero (`warehouse-3d.ts`).
  - Se carga con `import()` después de pintar la página, así que no entra en el paquete de las demás.
  - Los colores salen de los tokens `--scene-*` y siguen el tema.
  - No dibuja si el lienzo está fuera de pantalla o la pestaña oculta.
  - Con «reducir movimiento» se dibuja una sola vez, quieta y completa.
  - Sin WebGL se muestra la ilustración 2D (`WarehouseScene`).
- **anime.js:** se usa en tres lugares:
  - apariciones al hacer scroll y contadores (`SiteMotion`, con `data-reveal` y `data-count`);
  - demostraciones en bucle de las tarjetas (`demos.tsx`);
  - la calculadora de precios.
- **Reglas de animación:**
  - El contenido se ve sin JavaScript: solo se oculta, justo antes de animarlo, lo que está debajo de la pantalla.
  - El hero entra con CSS para no parpadear.
- **Pendientes del fundador:** todo está en `content.ts`.
  - Correo de contacto.
  - Razón social.
  - Precios de lanzamiento. Son una propuesta: FUN-06 no está aprobada y la página lo dice.
  - Los textos legales son borradores marcados como tales, hasta la revisión profesional (PIL-08).

## Consecuencias

- La app (`motion`) y el sitio (anime.js) usan bibliotecas de animación distintas. anime.js no entra en las pantallas de la app.
- Una sección pública nueva se agrega a `SITE_NAV`/`FOOTER_LINKS` y no va en `PROTECTED` de `proxy.ts`.
- Los precios mostrados no son los que cobra el sistema. Cuando existan planes publicados (`plan_offer`), la página debe leerlos de ahí (BIL-15).
