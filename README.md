# SaaS Almacén

SaaS de inventario modular para pymes en México. **Inventario** es la base, y sobre ella se contratan **Compras** y **Ventas** (punto de venta, cotizaciones, pedidos y ventas a plazos).

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript estricto · MySQL 9.4 · Prisma 7 · Better Auth · Tailwind CSS 4 + shadcn/ui · Vitest. Es un monolito modular con un worker para el trabajo en segundo plano.

## Empezar

```bash
npm install
# Primera vez: copia .env.example a .env.local y pon MYSQL_ROOT_PASSWORD
npm run setup        # secretos, bases, usuarios y migraciones
npm run db:seed      # cuenta demo: DEMO_EMAIL / DEMO_PASSWORD en .env.local
npm run demo:codigo  # código de verificación en dos pasos de la cuenta demo
npm run dev          # http://localhost:3000 (correos de desarrollo en /correos)
npm run worker       # cola de trabajos (importaciones, correos)
npm run check        # tipos, lint, límites, formato y pruebas
```

## Dónde está cada cosa

| Quiero entender… | Leer |
| --- | --- |
| Qué tecnologías usamos y por qué | [docs/arquitectura/01-stack.md](docs/arquitectura/01-stack.md) |
| Cómo están organizadas las carpetas | [docs/arquitectura/02-estructura.md](docs/arquitectura/02-estructura.md) y [src/README.md](src/README.md) |
| Qué patrones de diseño usamos | [docs/arquitectura/03-patrones.md](docs/arquitectura/03-patrones.md) |
| Cómo funciona el código por dentro | [docs/arquitectura/04-recorrido-del-codigo.md](docs/arquitectura/04-recorrido-del-codigo.md) |
| Pruebas, seguridad y despliegue | [docs/arquitectura/05-calidad-y-operacion.md](docs/arquitectura/05-calidad-y-operacion.md) |
| Por qué se tomó cada decisión | [docs/adr/](docs/adr/) |
| Qué se construye y en qué orden | [docs/producto/PLAN_IMPLEMENTACION.md](docs/producto/PLAN_IMPLEMENTACION.md) |
| Reglas para trabajar en el código | [AGENTS.md](AGENTS.md) |
| Decisiones del fundador e historial | [MEMORY.md](MEMORY.md) |
| Todo lo demás | [docs/README.md](docs/README.md) |

Rama de trabajo: `pruebas` (CI en GitHub Actions). Producción se despliega desde `produccion`.
