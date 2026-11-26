# Prueba de carga (PIL-06)

Fecha: 2026-10-26. Criterio: p95 < 500 ms en las lecturas comunes con 20
usuarios, con 100, 1,000 y 10,000 productos, y el entorno documentado.

**Resultado: cumple.** Con 20 personas trabajando a la vez (pausas de 1 a 4 s
entre clics, como en un mostrador), el peor p95 fue 207 ms: cambiar de página
en un catálogo de 10,000 productos.

## Cómo se repite

```bash
npm run build
DATABASE_NAME=almacen_test BETTER_AUTH_URL=http://localhost:3100 \
  MAIL_DRIVER=memory FILE_STORAGE_DIR=<tmp> npx next start -p 3100
npm run load:test
```

`scripts/load-test.mts` crea en `almacen_test` tres empresas (100, 1,000 y
10,000 productos) con sus existencias iniciales, entradas y salidas hechas con
los servicios reales (los saldos cuadran con el historial), entra con el
formulario real como una persona de Almacén y lee siete pantallas al azar.
Variables: `LOAD_USERS` (20), `LOAD_REQUESTS` (40 por persona),
`LOAD_SIZES`, `LOAD_MODES` (`solo,real,stress`) y `LOAD_REUSE=1` para usar las
empresas de una corrida anterior. Termina con código 1 si algo pasa de la meta
en `solo` o `real`, o si alguna respuesta no es 200.

## Entorno

- 4 núcleos, 16 GB de memoria; MySQL 9.4 en la misma máquina.
- La app compilada (`next start`, un solo proceso de Node 24) y el generador de
  carga en la misma máquina, así que los números son conservadores.
- Datos: por empresa, todos sus productos con saldo inicial, una entrada por
  cada 5 y una salida por cada 10 (10,000 productos ≈ 13,000 movimientos).

## Resultados (p95 en ms)

| Pantalla | 100 · real | 1,000 · real | 10,000 · real | 10,000 · una persona |
| --- | ---: | ---: | ---: | ---: |
| Inicio | 105 | 127 | 74 | 39 |
| Inventario | 110 | 136 | 159 | 90 |
| Inventario, otra página | 136 | 146 | 207 | 213 |
| Inventario, búsqueda | 110 | 116 | 181 | 133 |
| Ficha de producto | 126 | 159 | 99 | 46 |
| Movimientos | 121 | 124 | 105 | 69 |
| Movimientos de un producto | 112 | 109 | 82 | 58 |

Ninguna respuesta con error en ninguna corrida.

## Esfuerzo (20 personas sin pausa)

Sin pausas, un proceso de Node atiende de 22 a 30 lecturas por segundo y el
p95 sube a 0.7–1.4 s: es la cola de un solo núcleo, no el tamaño del
catálogo (con 100 productos ya pasa lo mismo). Una persona en mostrador hace
una lectura cada pocos segundos, así que 20 personas son unas 7 lecturas por
segundo, lejos de ese tope.

**Si un día hay más tráfico:** correr dos o más procesos de `next start` (uno
por núcleo) detrás de Caddy multiplica ese tope; es un cambio en `deploy/`, no
en la app. Antes de eso conviene medir en el servidor real: la EC2 puede tener
menos núcleos que esta máquina.

## Lo que esto habilita

El plan pedía no publicar los niveles de 3,000 y 10,000 productos hasta probar
su rendimiento: con 10,000 productos las pantallas comunes quedan por debajo de
la meta. Falta confirmarlo una vez en el servidor de producción.
