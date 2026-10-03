# SaaS de inventario modular

Aplicación en construcción (Next.js + TypeScript). Pasos completados según `docs/PLAN_IMPLEMENTACION.md`: BAS-01, BAS-02, BAS-03, BAS-04, BAS-05, BAS-06, BAS-07, BAS-12, BAS-13.

```powershell
npm install
# Primera vez: copia .env.example a .env.local y pon MYSQL_ROOT_PASSWORD
npm run setup      # secretos, bases, usuarios y migraciones
npm run dev      # http://localhost:3000
npm run check    # tipos, lint, límites, formato y pruebas
```

- [Plan de implementación](docs/PLAN_IMPLEMENTACION.md): modelo modular (Inventario base + Compras, Ventas y CRM con precio por nivel), roles, 224 pasos de unas 3 horas y criterios para lanzar.
- [Memoria del proyecto](MEMORY.md): requisitos confirmados, propuestas y preguntas pendientes.
- [Entregables de fase 1](docs/FASE_01_DEFINICION.md): alcance inicial (antes del cambio a roles y módulos de v0.6), reglas, investigación preparada, riesgos y estado real de cada jornada.
- [Cuestionario para almacenes](docs/CUESTIONARIO_ALMACEN.md): 24 preguntas operativas, 6 para quien decide la compra y hoja para convertir respuestas en requisitos.

Antes de continuar el proyecto, leer la memoria y el plan. Las propuestas técnicas y comerciales todavía no son decisiones confirmadas por el usuario.
# SaaS-Almacen
