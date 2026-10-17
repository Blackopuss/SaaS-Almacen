# ADR 0004 — Interfaz y sistema visual

Fecha: 2026-10-02 · Estado: aceptada · Pasos: BAS-12, BAS-13

## Contexto

El fundador pidió claridad tipo Apple, Framer Motion y las skills `ui-ux-pro-max` y `web-design-guidelines`. Los usuarios operan en computadora y celular dentro de una ferretería.

## Decisión

- Sistema de diseño generado con `ui-ux-pro-max` y guardado en `design-system/almacen/MASTER.md`: Minimal & Swiss, azul `#2563EB`, fondo `#F8FAFC`, tipografía Inter, modo claro por defecto.
- **Tailwind CSS 4.3.3** con tokens en `src/app/globals.css`; contraste WCAG verificado por prueba (texto ≥ 4.5:1, bordes y foco ≥ 3:1).
- **shadcn/ui 4.21.1** (base Radix, preset nova) con ajustes propios: 44 px táctiles en móvil, textos en español, variantes de stock.
- **motion 14.0.0** (Framer Motion) con `reducedMotion="user"` y presets cortos.
- **Modo oscuro gris neutro** (escala zinc: fondo `#0F0F10`, tarjetas `#18181B`, bordes `#27272A`; el azul solo en acciones y enlaces), pedido por el fundador en lugar del azul marino inicial, con una solución propia (`src/components/theme.ts` + script `beforeInteractive` en el layout raíz) que reemplazó a `next-themes` 0.4.6, sin mantenimiento desde marzo de 2025 y con aviso de React 19 por renderizar `<script>`: claro por defecto, preferencia guardada en el navegador e interruptor deslizante propio (cielo de día/noche con sol y luna animados con `motion`), accesible como `role="switch"`.
- **Pantallas de acceso con escena de almacén** (`WarehouseScene`, SVG + `motion`): estantes donde las cajas se acomodan una vez y un montacargas que cruza el piso, más dos tarjetas flotantes con datos del producto. Panel ilustrado en escritorio. El formulario va dentro de `WarehouseCard`, una bodega con techo a dos aguas y franja de andén cuya cortina enrollable sube al entrar (oculta con movimiento reducido). Con movimiento reducido, el montacargas queda estacionado (elegido por CSS `motion-reduce` para no causar errores de hidratación). Colores de la escena en tokens `--scene-*`.
- **Códigos QR con `uqr` 0.1.3** (MIT, sin dependencias, mantenido por UnJS) para el alta de MFA: se usa solo `encode()` y el SVG se dibuja como componente React (`QrCode`), sin `dangerouslySetInnerHTML` ni servicios externos. Siempre oscuro sobre blanco (tokens `--qr`/`--qr-foreground`, iguales en ambos temas) con zona de silencio de 4 módulos. Se descartó `qrcode` 1.5.4 por arrastrar dependencias de CLI (`yargs`).
- Navegación: barra lateral en escritorio; barra inferior de 4 + «Más» en móvil.
- Verificación en navegador con Playwright 1.63.0 y Edge instalado (`npm run verify:ui`).

## Desarrollo

- `devIndicators: false` en `next.config.ts`: el indicador flotante de Next tapaba el interruptor de tema y el menú de usuario. Los errores de compilación y ejecución se siguen mostrando.

## Alternativas consideradas

- Componentes cerrados (MUI, Ant Design): más rápidos de empezar, pero difíciles de llevar a una estética propia.
- GSAP (sugerido por la skill para animaciones): el fundador pidió Framer Motion; basta para transiciones de interfaz.

## Consecuencias

- `npx shadcn add` puede proponer sobrescribir componentes ajustados: responder siempre que no y revisar el diff.
