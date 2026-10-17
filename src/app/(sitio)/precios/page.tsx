import { Info } from "lucide-react";
import type { Metadata } from "next";

import { PROPOSED_TIERS } from "@/platform/billing";

import { formatCount, formatMoney, SITE, TIER_PRICES } from "../content";
import { CtaBand, PageHero, Section } from "../sections";
import { PriceCalculator } from "./price-calculator";

export const metadata: Metadata = {
  title: "Precios",
  description:
    "Precio mensual según cuántos productos manejas. Inventario incluido; Compras opcional. Sin permanencia.",
};

const TIERS = PROPOSED_TIERS.map((tier, index) => ({
  ...tier,
  ...TIER_PRICES[index]!,
}));

const FAQ = [
  {
    question: "¿Qué cuenta como producto activo?",
    answer:
      "Cada producto de tu catálogo que no esté archivado. Una caja y su pieza son el mismo producto con dos presentaciones. Los archivados no cuentan.",
  },
  {
    question: "¿Qué pasa si llego al límite?",
    answer:
      "Puedes seguir trabajando con lo que ya tienes; para dar de alta más productos cambias al siguiente nivel o archivas lo que ya no vendes.",
  },
  {
    question: "¿Puedo quitar Compras después?",
    answer:
      "Sí. Nada se borra: tus órdenes y proveedores quedan para consultar y exportar, y si lo vuelves a activar sigues donde te quedaste.",
  },
  {
    question: "¿Hay permanencia?",
    answer:
      "No. Pagas mes a mes. Si cancelas, tu cuenta queda en modo consulta para que descargues tu información.",
  },
  {
    question: "¿Necesitan más personas o más productos?",
    answer: `Escríbenos a ${SITE.contactEmail} y armamos un plan a tu medida.`,
  },
];

export default function PricingPage() {
  return (
    <>
      <PageHero eyebrow="Precios" title="Pagas según el tamaño de tu catálogo">
        Inventario siempre incluido. Agrega Compras cuando lo necesites. Sin
        permanencia y con tus datos siempre exportables.
      </PageHero>

      <Section className="pt-12 sm:pt-16">
        <div data-reveal>
          <PriceCalculator tiers={TIERS} />
        </div>
        <p className="mt-6 flex items-start gap-2 text-sm text-muted-foreground">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          Precios de lanzamiento propuestos, en pesos mexicanos y antes de IVA.
          Pueden ajustarse antes de la apertura; el precio que contrates se
          respeta mientras tengas tu plan.
        </p>
      </Section>

      <Section className="bg-card/60">
        <h2 className="text-3xl font-semibold tracking-tight" data-reveal>
          Todos los niveles
        </h2>
        <div
          className="mt-8 overflow-x-auto rounded-2xl border bg-card"
          data-reveal
        >
          <table className="w-full min-w-[560px] text-left text-sm">
            <caption className="sr-only">
              Precio mensual por nivel de productos activos
            </caption>
            <thead className="border-b bg-muted/50 text-muted-foreground">
              <tr>
                <th scope="col" className="px-5 py-3 font-medium">
                  Productos activos
                </th>
                <th scope="col" className="px-5 py-3 font-medium">
                  Personas incluidas
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  Inventario
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  + Compras
                </th>
                <th scope="col" className="px-5 py-3 text-right font-medium">
                  Ambos
                </th>
              </tr>
            </thead>
            <tbody className="divide-y tabular-nums">
              {TIERS.map((tier) => (
                <tr
                  key={tier.productLimit}
                  className="transition-colors hover:bg-muted/40"
                >
                  <th scope="row" className="px-5 py-4 font-semibold">
                    Hasta {formatCount(tier.productLimit)}
                  </th>
                  <td className="px-5 py-4">{tier.users}</td>
                  <td className="px-5 py-4 text-right">
                    {formatMoney(tier.inventory)}
                  </td>
                  <td className="px-5 py-4 text-right">
                    {formatMoney(tier.purchasing)}
                  </td>
                  <td className="px-5 py-4 text-right font-semibold">
                    {formatMoney(tier.inventory + tier.purchasing)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section>
        <div className="grid gap-10 lg:grid-cols-[0.8fr_2fr]">
          <h2 className="text-3xl font-semibold tracking-tight" data-reveal>
            Preguntas frecuentes
          </h2>
          <div
            data-reveal="stagger"
            className="divide-y rounded-2xl border bg-card"
          >
            {FAQ.map((item) => (
              <details key={item.question} className="group px-5">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 py-3 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <span
                    aria-hidden="true"
                    className="grid size-7 shrink-0 place-items-center rounded-full bg-muted text-lg leading-none transition-transform duration-300 group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="pb-5 text-muted-foreground">{item.answer}</p>
              </details>
            ))}
          </div>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
