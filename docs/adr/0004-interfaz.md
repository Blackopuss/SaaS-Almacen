# ADR 0004 — Interfaz y sistema visual

Fecha: 2026-10-02 · Estado: aceptada · Pasos: BAS-12, BAS-13

## Contexto

El fundador pidió claridad tipo Apple, Framer Motion y las skills `ui-ux-pro-max` y `web-design-guidelines`. Los usuarios operan en computadora y celular dentro de una ferretería.

## Decisión

- Sistema de diseño generado con `ui-ux-pro-max` y guardado en `design-system/almacen/MASTER.md`: Minimal & Swiss, azul `#2563EB`, fondo `#F8FAFC`, tipografía Inter, modo claro por defecto.
- **Tailwind CSS 4.3.3** con tokens en `src/app/globals.css`; contraste WCAG verificado por prueba (texto ≥ 4.5:1, bordes y foco ≥ 3:1).
- **shadcn/ui 4.21.1** (base Radix, preset nova) con ajustes propios: 44 px táctiles en móvil, textos en español, variantes de stock.
- **motion 14.0.0** (Framer Motion) con `reducedMotion="user"` y presets cortos.
- Navegación: barra lateral en escritorio; barra inferior de 4 + «Más» en móvil.
- Verificación en navegador con Playwright 1.63.0 y Edge instalado (`npm run verify:ui`).

## Alternativas consideradas

- Componentes cerrados (MUI, Ant Design): más rápidos de empezar, pero difíciles de llevar a una estética propia.
- GSAP (sugerido por la skill para animaciones): el fundador pidió Framer Motion; basta para transiciones de interfaz.

## Consecuencias

- `npx shadcn add` puede proponer sobrescribir componentes ajustados: responder siempre que no y revisar el diff.
