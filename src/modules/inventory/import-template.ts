import "server-only";

import { assertModulePermission } from "@/platform/billing";
import { DIMENSION_LABELS, UNITS } from "@/platform/catalog";
import { buildCsv, buildXlsx, type Cell } from "@/platform/files";

import type { InventoryActor } from "./movements";

/**
 * Columns of the import file (IMP-03): the one list the template, the
 * column mapping (IMP-04) and the validation (IMP-05) read. A row is a
 * product; when it brings an initial stock, also where it is.
 */
export const IMPORT_COLUMNS = [
  {
    key: "sku",
    header: "Clave (SKU)",
    required: true,
    help: "La clave con la que identificas el producto. No se repite en tu empresa. Si ya existe, la fila actualiza ese producto.",
    example: "TOR-001",
  },
  {
    key: "name",
    header: "Nombre",
    required: true,
    help: "Como lo conoces en el mostrador.",
    example: "Tornillo hexagonal 1/4 × 1",
  },
  {
    key: "description",
    header: "Descripción",
    required: false,
    help: "Detalle opcional.",
    example: "Galvanizado, rosca estándar",
  },
  {
    key: "category",
    header: "Categoría",
    required: false,
    help: "Si no existe, se crea.",
    example: "Tornillería",
  },
  {
    key: "brand",
    header: "Marca",
    required: false,
    help: "Si no existe, se crea.",
    example: "Fiero",
  },
  {
    key: "barcode",
    header: "Código de barras",
    required: false,
    help: "El que lee tu lector. No se repite en tu empresa.",
    example: "7501234567890",
  },
  {
    key: "unit",
    header: "Unidad",
    required: true,
    help: "En qué controlas el producto: una de las unidades de la lista de abajo (pieza, metro, kilogramo…). Una caja o un rollo no son unidades: van en «Presentación».",
    example: "pieza",
  },
  {
    key: "presentation",
    header: "Presentación",
    required: false,
    help: "Cómo viene empacado, si aplica: caja, bolsa, rollo, saco. Va junto con su contenido.",
    example: "Caja",
  },
  {
    key: "presentationContent",
    header: "Contenido de la presentación",
    required: false,
    help: "Cuántas unidades trae una presentación. «Caja» con contenido 100 = una caja trae 100 piezas.",
    example: "100",
  },
  {
    key: "initialStock",
    header: "Existencia inicial",
    required: false,
    help: "Cuánto hay hoy. Se registra como saldo inicial; déjalo vacío si lo capturarás después.",
    example: "3",
  },
  {
    key: "initialStockIn",
    header: "Existencia contada en",
    required: false,
    help: "En qué está contada la existencia: vacío = en la unidad del producto; o el nombre de la presentación (3 de «Caja» de 100 = 300 piezas).",
    example: "Caja",
  },
  {
    key: "location",
    header: "Ubicación",
    required: false,
    help: "Dónde está esa existencia, con su ruta: «Zona A › Estante 3». Vacío = General. Debe existir en Ubicaciones.",
    example: "",
  },
  {
    key: "minimum",
    header: "Mínimo",
    required: false,
    help: "Con cuánto o menos quieres que te avise, en la unidad del producto.",
    example: "200",
  },
] as const;

export type ImportColumnKey = (typeof IMPORT_COLUMNS)[number]["key"];

type ExampleRow = Partial<Record<ImportColumnKey, string>>;

/** Examples that show a unit with and without a presentation. */
const EXAMPLES: ExampleRow[] = [
  {
    sku: "TOR-001",
    name: "Tornillo hexagonal 1/4 × 1",
    description: "Galvanizado, rosca estándar",
    category: "Tornillería",
    brand: "Fiero",
    barcode: "7501234567890",
    unit: "pieza",
    presentation: "Caja",
    presentationContent: "100",
    initialStock: "3",
    initialStockIn: "Caja",
    minimum: "200",
  },
  {
    sku: "CAB-012",
    name: "Cable THW calibre 12",
    category: "Eléctrico",
    unit: "metro",
    presentation: "Rollo",
    presentationContent: "100",
    initialStock: "250.5",
    minimum: "50",
  },
  {
    sku: "CEM-050",
    name: "Cemento gris",
    category: "Construcción",
    unit: "kilogramo",
    presentation: "Saco",
    presentationContent: "50",
    initialStock: "12",
    initialStockIn: "Saco",
  },
  {
    sku: "MAR-016",
    name: "Martillo de uña 16 oz",
    category: "Herramienta",
    brand: "Truper",
    unit: "pieza",
    initialStock: "8",
  },
];

const exampleRows = (): Cell[][] =>
  EXAMPLES.map((row) => IMPORT_COLUMNS.map((column) => row[column.key] ?? ""));

export type ImportTemplateFormat = "xlsx" | "csv";

export type ImportTemplate = {
  name: string;
  contentType: string;
  bytes: Buffer;
};

/**
 * The template people fill in to import their catalog: titles, examples
 * and — in Excel — a sheet that explains every column and lists the valid
 * units. The examples must be deleted or replaced before importing.
 */
export async function buildImportTemplate(
  actor: InventoryActor,
  format: ImportTemplateFormat,
): Promise<ImportTemplate> {
  await assertModulePermission(
    actor.organizationId,
    actor.userId,
    "inventory.import.create",
  );
  const headers = IMPORT_COLUMNS.map((column) => column.header);
  if (format === "csv") {
    return {
      name: "plantilla-productos.csv",
      contentType: "text/csv; charset=utf-8",
      bytes: buildCsv([headers, ...exampleRows()]),
    };
  }
  const instructions: Cell[][] = [
    ["Cómo llenar la plantilla"],
    [
      "Cada fila de la hoja «Productos» es un producto. Borra o reemplaza las filas de ejemplo. No cambies los títulos de la primera fila.",
    ],
    [
      "Decimales con punto (2.75). No escribas separador de miles ni la unidad dentro de la cantidad.",
    ],
    [
      "Un producto con existencias en varias ubicaciones se repite en una fila por ubicación, con la misma clave.",
    ],
    [],
    ["Columna", "¿Obligatoria?", "Qué poner", "Ejemplo"],
    ...IMPORT_COLUMNS.map((column) => [
      column.header,
      column.required ? "Sí" : "No",
      column.help,
      column.example,
    ]),
    [],
    ["Unidades válidas", "Se usa para", "¿Admite decimales?"],
    ...UNITS.map((unit) => [
      unit.name,
      DIMENSION_LABELS[unit.dimension],
      unit.fractional ? "Sí" : "No, solo enteros",
    ]),
  ];
  return {
    name: "plantilla-productos.xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    bytes: buildXlsx([
      {
        name: "Productos",
        headerRows: 1,
        rows: [headers, ...exampleRows()],
        widths: IMPORT_COLUMNS.map((column) =>
          Math.max(14, column.header.length + 4),
        ),
      },
      {
        name: "Instrucciones",
        rows: instructions,
        widths: [30, 18, 90, 28],
      },
    ]),
  };
}
