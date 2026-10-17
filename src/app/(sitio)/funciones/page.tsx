import {
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ClipboardCheck,
  Download,
  FileSpreadsheet,
  FileText,
  History,
  KeyRound,
  Mail,
  MapPinned,
  PackageMinus,
  PackageOpen,
  RotateCcw,
  ScanBarcode,
  ShieldCheck,
  TrendingDown,
  Truck,
  Undo2,
  Users,
} from "lucide-react";
import type { Metadata } from "next";

import { CtaBand, PageHero, Section } from "../sections";

export const metadata: Metadata = {
  title: "Funciones",
  description:
    "Inventario por presentaciones y ubicaciones, conteos, importación desde Excel, órdenes de compra, recepciones y seguridad para tu equipo.",
};

type Feature = { icon: typeof Boxes; title: string; text: string };

const GROUPS: {
  id: string;
  name: string;
  intro: string;
  features: Feature[];
}[] = [
  {
    id: "inventario",
    name: "Inventario",
    intro:
      "La base de todo: qué tienes, cuánto y dónde, con un historial que no se puede maquillar.",
    features: [
      {
        icon: Boxes,
        title: "Productos con presentaciones",
        text: "Clave, código de barras, categoría, marca y unidad. Cajas o paquetes con su contenido; si el contenido cambia, lo anterior se respeta.",
      },
      {
        icon: MapPinned,
        title: "Ubicaciones por niveles",
        text: "Zonas, pasillos y estantes. El saldo se lleva por producto y por ubicación.",
      },
      {
        icon: ArrowLeftRight,
        title: "Entradas, salidas y ajustes",
        text: "Cada movimiento guarda quién, cuándo, cuánto y por qué. Un error se corrige con una reversa, nunca borrando.",
      },
      {
        icon: ScanBarcode,
        title: "Salida rápida con lector",
        text: "Escanea y se agrega la línea; el mismo código suma uno. Hasta 50 productos en un solo movimiento.",
      },
      {
        icon: ClipboardCheck,
        title: "Conteos físicos",
        text: "Cuenta por cajas y piezas. Si alguien vende mientras cuentas, la diferencia se calcula bien.",
      },
      {
        icon: TrendingDown,
        title: "Mínimos y existencias bajas",
        text: "Define un mínimo por producto y ve de un vistazo lo que se está acabando.",
      },
      {
        icon: History,
        title: "Historial con filtros",
        text: "Por producto, ubicación, tipo, persona y fecha, en el horario de tu negocio.",
      },
      {
        icon: FileSpreadsheet,
        title: "Importación desde Excel",
        text: "Catálogo, existencias iniciales y salidas desde CSV o XLSX, con revisión fila por fila antes de confirmar.",
      },
      {
        icon: Download,
        title: "Exportaciones",
        text: "Tus productos, existencias y movimientos en Excel o CSV cuando quieras. Tus datos son tuyos.",
      },
    ],
  },
  {
    id: "compras",
    name: "Compras",
    intro:
      "Del «hay que pedir» a la mercancía en el estante, sin perder de vista lo que falta.",
    features: [
      {
        icon: Users,
        title: "Proveedores",
        text: "Datos de contacto, RFC y qué productos te vende cada uno, con su clave de catálogo.",
      },
      {
        icon: FileText,
        title: "Órdenes en PDF",
        text: "Arma la orden por caja o por pieza y descarga un PDF claro para el proveedor.",
      },
      {
        icon: Mail,
        title: "Envío por correo",
        text: "Manda la orden desde el sistema; si el proveedor responde, te llega a ti.",
      },
      {
        icon: PackageOpen,
        title: "Recepciones parciales",
        text: "Recibe lo que llegó, a la ubicación que elijas. Lo pendiente queda a la vista.",
      },
      {
        icon: Undo2,
        title: "Devoluciones",
        text: "Devuelve mercancía dañada por recepción, con la misma presentación con que entró.",
      },
      {
        icon: PackageMinus,
        title: "Sugerencia de compra",
        text: "Lo que falta para llegar a tus mínimos, descontando lo que ya viene en camino.",
      },
      {
        icon: BarChart3,
        title: "Reportes",
        text: "Pendientes por recibir y compras por proveedor, en pantalla o en Excel.",
      },
      {
        icon: Truck,
        title: "Último costo",
        text: "Cada compra guarda lo que pagaste y por qué presentación. Solo lo ve quien debe.",
      },
    ],
  },
  {
    id: "seguridad",
    name: "Equipo y seguridad",
    intro: "Cada persona ve y hace solo lo que le toca.",
    features: [
      {
        icon: Users,
        title: "Roles listos",
        text: "Administración, almacén, compras y consulta. Invita a tu equipo por correo.",
      },
      {
        icon: KeyRound,
        title: "Verificación en dos pasos",
        text: "Código de una app autenticadora y códigos de respaldo. Obligatoria para el titular.",
      },
      {
        icon: ShieldCheck,
        title: "Bitácora",
        text: "Cambios de equipo, ajustes y descargas quedan registrados y no se pueden borrar.",
      },
      {
        icon: RotateCcw,
        title: "Sin perder nada",
        text: "Si dejas un módulo o tu plan vence, todo queda en modo consulta y lo puedes exportar.",
      },
    ],
  },
];

export default function FeaturesPage() {
  return (
    <>
      <PageHero
        eyebrow="Funciones"
        title="Todo lo que tu almacén necesita, nada que estorbe"
      >
        Diseñado con una ferretería de verdad: cajas que se venden por pieza,
        pedidos que llegan incompletos y gente que cuenta mientras otros venden.
      </PageHero>

      <nav
        aria-label="Grupos de funciones"
        className="sticky top-16 z-30 border-b bg-background/85 backdrop-blur-lg"
      >
        <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-4 sm:px-6">
          {GROUPS.map((group) => (
            <li key={group.id}>
              <a
                href={`#${group.id}`}
                className="inline-flex h-12 items-center px-3 text-sm font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
              >
                {group.name}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      {GROUPS.map((group, index) => (
        <Section
          key={group.id}
          id={group.id}
          className={index % 2 === 1 ? "bg-card/60" : undefined}
        >
          <div className="grid gap-10 lg:grid-cols-[0.8fr_2fr]">
            <div data-reveal className="lg:sticky lg:top-36 lg:self-start">
              <h2 className="text-3xl font-semibold tracking-tight">
                {group.name}
              </h2>
              <p className="mt-3 text-muted-foreground">{group.intro}</p>
            </div>
            <ul data-reveal="stagger" className="grid gap-4 sm:grid-cols-2">
              {group.features.map(({ icon: Icon, title, text }) => (
                <li
                  key={title}
                  className="group rounded-2xl border bg-card p-5 shadow-sm transition-shadow duration-300 hover:shadow-md"
                >
                  <span className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground transition-transform duration-300 group-hover:scale-110 motion-reduce:transition-none">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-4 font-semibold">{title}</h3>
                  <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
                </li>
              ))}
            </ul>
          </div>
        </Section>
      ))}

      <CtaBand />
    </>
  );
}
