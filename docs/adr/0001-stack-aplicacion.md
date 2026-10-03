# ADR 0001 — Stack de la aplicación

Fecha: 2026-10-02 · Estado: aceptada · Pasos: BAS-01, BAS-02, BAS-05

## Contexto

SaaS modular de inventario para pymes mexicanas, desarrollado por el fundador con apoyo de IA a medio tiempo. Se necesita un solo proyecto que cubra interfaz y servidor, con tipado estricto y límites claros entre módulos contratables.

## Decisión

- **Next.js 16.3.8 (App Router) + React 19.2.8 + TypeScript 5.9.3 estricto** (`noUncheckedIndexedAccess`, `noImplicitOverride`). Node ≥ 24.
- **Monolito modular**: `src/platform/*` (núcleo) y `src/modules/*` (módulos contratables), con límites impuestos por `eslint-plugin-boundaries` 7.2.0 y verificados por `npm run lint:boundaries`.
- **npm** con versiones exactas (`.npmrc`: `save-exact`, `engine-strict`) y `overrides` para dependencias transitivas con vulnerabilidades corregidas.
- Calidad: ESLint 9 + Prettier 3 + Vitest 5; `npm run check` y `npm run build` deben pasar para cerrar un paso.

## Alternativas consideradas

- Backend separado (Express/Nest) + SPA: más despliegues y contratos que mantener para una sola persona.
- Microservicios por módulo: complejidad operativa injustificada antes de validar el producto.

## Consecuencias

- Un solo despliegue web (más un worker en IMP-01).
- Next.js cambia rápido: leer `node_modules/next/dist/docs/` antes de usar APIs nuevas (ver `AGENTS.md`).
