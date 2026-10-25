import {
  ArrowRight,
  Boxes,
  ClipboardCheck,
  FileSpreadsheet,
  MapPinned,
  PackageSearch,
  ShieldCheck,
  ShoppingCart,
  TrendingDown,
  Truck,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";

import { formatMoney, TIER_PRICES } from "./content";
import {
  LocationDemo,
  OrderDemo,
  PresentationDemo,
  ScanDemo,
  StepsPath,
} from "./demos";
import { HeroScene } from "./hero-scene";
import { CtaBand, Eyebrow, Section } from "./sections";

export const metadata: Metadata = {
  title: { absolute: "Almacén · Inventario y compras para tu negocio" },
  description:
    "Sabe cuánto tienes, dónde está y qué falta pedir. Inventario por cajas y piezas, ubicaciones, conteos y órdenes de compra, en español.",
};

const QUESTIONS = [
  {
    icon: PackageSearch,
    question: "¿Cuánto tengo?",
    answer:
      "Existencias al momento, por producto y por ubicación. Cada entrada y salida queda registrada con quién, cuándo y por qué.",
  },
  {
    icon: MapPinned,
    question: "¿Dónde está?",
    answer:
      "Zonas, pasillos y estantes con nombres tuyos. Encuentra cualquier producto sin recorrer el almacén.",
  },
  {
    icon: TrendingDown,
    question: "¿Qué me falta pedir?",
    answer:
      "Mínimos por producto y una sugerencia de compra que ya descuenta lo que viene en camino.",
  },
];

const STEPS = [
  {
    icon: FileSpreadsheet,
    title: "Sube tu Excel",
    text: "Importa tu catálogo y tus existencias desde el archivo que ya usas. Te decimos fila por fila qué falta corregir.",
  },
  {
    icon: Boxes,
    title: "Registra lo que entra y sale",
    text: "Por caja, por pieza o con el lector de código de barras. El saldo se actualiza solo.",
  },
  {
    icon: Truck,
    title: "Compra lo que falta",
    text: "Arma la orden, mándala al proveedor en PDF y recibe en partes. La mercancía entra sola al inventario.",
  },
];

export default function LandingPage() {
  const from = TIER_PRICES[0]!.inventory;
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,var(--scene-rack)_1px,transparent_0)] [mask-image:radial-gradient(ellipse_at_70%_40%,black,transparent_70%)] [background-size:24px_24px] opacity-[0.08]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-6 px-4 pt-10 pb-16 sm:px-6 lg:grid-cols-[1fr_1.1fr] lg:gap-4 lg:pt-16 lg:pb-24">
          <div className="space-y-6 motion-safe:animate-in motion-safe:duration-700 motion-safe:fade-in motion-safe:slide-in-from-bottom-3">
            <Eyebrow>Inventario + Compras para pymes</Eyebrow>
            <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Tu almacén, <span className="text-primary">bajo control</span>.
            </h1>
            <p className="max-w-lg text-lg text-pretty text-muted-foreground">
              Sabe cuánto tienes de cada producto, en qué estante está y qué
              falta pedir. Sin hojas de cálculo que nadie actualiza.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/registro">
                  Crear cuenta
                  <ArrowRight data-icon="inline-end" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/funciones">Ver cómo funciona</Link>
              </Button>
            </div>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <ShieldCheck
                  className="size-4 text-success"
                  aria-hidden="true"
                />
                Verificación en dos pasos
              </li>
              <li className="flex items-center gap-1.5">
                <ClipboardCheck
                  className="size-4 text-success"
                  aria-hidden="true"
                />
                Desde {formatMoney(from)} al mes
              </li>
            </ul>
          </div>
          <div className="motion-safe:animate-in motion-safe:duration-1000 motion-safe:zoom-in-95 motion-safe:fade-in">
            <HeroScene />
          </div>
        </div>
      </section>

      {/* Three questions */}
      <Section>
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <Eyebrow>Lo de todos los días</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Tres preguntas que dejas de hacerte
          </h2>
        </div>
        <ul data-reveal="stagger" className="mt-12 grid gap-4 md:grid-cols-3">
          {QUESTIONS.map(({ icon: Icon, question, answer }) => (
            <li
              key={question}
              className="group rounded-2xl border bg-card p-6 shadow-sm transition-[box-shadow,translate] duration-300 hover:-translate-y-1 hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground transition-transform duration-300 group-hover:scale-110 group-hover:-rotate-6 motion-reduce:transition-none">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-5 text-lg font-semibold">{question}</h3>
              <p className="mt-2 text-muted-foreground">{answer}</p>
            </li>
          ))}
        </ul>
      </Section>

      {/* How it works */}
      <Section className="bg-card/60">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <Eyebrow>Cómo empiezas</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Listo en una tarde, no en un proyecto
          </h2>
        </div>
        <div className="relative mt-14">
          <StepsPath />
          <ol data-reveal="stagger" className="grid gap-10 md:grid-cols-3">
            {STEPS.map(({ icon: Icon, title, text }, index) => (
              <li key={title} className="relative text-center">
                <span className="relative mx-auto grid size-14 place-items-center rounded-2xl border bg-background text-primary shadow-sm">
                  <Icon className="size-6" aria-hidden="true" />
                  <span className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                </span>
                <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                <p className="mx-auto mt-2 max-w-xs text-muted-foreground">
                  {text}
                </p>
              </li>
            ))}
          </ol>
        </div>
      </Section>

      {/* Features bento */}
      <Section>
        <div className="max-w-2xl" data-reveal>
          <Eyebrow>Hecho para mercancía real</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Compras por caja, vendes por pieza. Almacén hace la cuenta.
          </h2>
        </div>
        <div data-reveal="stagger" className="mt-12 grid gap-4 md:grid-cols-6">
          <FeatureCard
            className="md:col-span-4"
            title="Presentaciones"
            text="Cajas, paquetes o rollos con su contenido. Capturas como llega la mercancía y el saldo queda en piezas, kilos o metros."
          >
            <PresentationDemo />
          </FeatureCard>
          <FeatureCard
            className="md:col-span-2"
            title="Lector de código"
            text="Funciona con cualquier lector USB o Bluetooth que escriba como teclado."
          >
            <ScanDemo />
          </FeatureCard>
          <FeatureCard
            className="md:col-span-2"
            title="Ubicaciones"
            text="Cada existencia sabe en qué zona, pasillo y estante está."
          >
            <LocationDemo />
          </FeatureCard>
          <FeatureCard
            className="md:col-span-4"
            title="Órdenes de compra"
            text="Del borrador al pedido recibido: PDF para el proveedor, envío por correo y recepciones parciales con faltantes claros."
          >
            <OrderDemo />
          </FeatureCard>
        </div>
      </Section>

      {/* Numbers */}
      <Section className="bg-card/60">
        <dl
          data-reveal="stagger"
          className="grid gap-8 text-center sm:grid-cols-2 lg:grid-cols-4"
        >
          <Stat value={10000} label="productos activos en el plan más grande" />
          <Stat
            value={4}
            label="roles listos: administración, almacén, compras y consulta"
          />
          <Stat
            value={50}
            label="productos por salida rápida, con lector de código"
          />
          <Stat value={2} label="pasos para entrar: contraseña y código" />
        </dl>
      </Section>

      {/* Modules */}
      <Section>
        <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:items-center">
          <div data-reveal>
            <Eyebrow>Módulos</Eyebrow>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
              Paga solo por lo que usas
            </h2>
            <p className="mt-4 text-lg text-muted-foreground">
              Inventario es la base. Compras se agrega cuando lo necesites, y se
              quita sin perder nada: tus datos quedan para consultar y exportar.
            </p>
            <Button asChild variant="outline" className="mt-6">
              <Link href="/precios">
                Ver precios
                <ArrowRight data-icon="inline-end" />
              </Link>
            </Button>
          </div>
          <ul data-reveal="stagger" className="grid gap-3 sm:grid-cols-2">
            <ModuleCard icon={Boxes} name="Inventario" state="Incluido" />
            <ModuleCard icon={ShoppingCart} name="Compras" state="Disponible" />
            <ModuleCard
              icon={ClipboardCheck}
              name="Ventas"
              state="Próximamente"
              soon
            />
            <ModuleCard
              icon={PackageSearch}
              name="Clientes (CRM)"
              state="Próximamente"
              soon
            />
          </ul>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}

function FeatureCard({
  title,
  text,
  className,
  children,
}: {
  title: string;
  text: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <article
      className={`flex flex-col justify-between gap-8 rounded-2xl border bg-card p-6 shadow-sm ${className ?? ""}`}
    >
      <div className="min-h-24">{children}</div>
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-1.5 text-muted-foreground">{text}</p>
      </div>
    </article>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex flex-col-reverse gap-2">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd
        className="text-4xl font-semibold tracking-tight text-primary tabular-nums sm:text-5xl"
        data-count={value}
      >
        {new Intl.NumberFormat("es-MX").format(value)}
      </dd>
    </div>
  );
}

function ModuleCard({
  icon: Icon,
  name,
  state,
  soon = false,
}: {
  icon: typeof Boxes;
  name: string;
  state: string;
  soon?: boolean;
}) {
  return (
    <li
      className={`flex items-center gap-4 rounded-2xl border p-5 ${soon ? "border-dashed bg-transparent" : "bg-card shadow-sm"}`}
    >
      <span
        className={`grid size-11 shrink-0 place-items-center rounded-xl ${soon ? "bg-muted text-muted-foreground" : "bg-primary text-primary-foreground"}`}
      >
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <div>
        <p className="font-semibold">{name}</p>
        <p
          className={`text-sm ${soon ? "text-muted-foreground" : "text-success"}`}
        >
          {state}
        </p>
      </div>
    </li>
  );
}
