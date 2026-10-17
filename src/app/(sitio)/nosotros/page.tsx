import { Download, Eye, Languages, Lock, Mail } from "lucide-react";
import type { Metadata } from "next";

import { Button } from "@/components/ui/button";

import { SITE } from "../content";
import { CtaBand, Eyebrow, PageHero, Section } from "../sections";

export const metadata: Metadata = {
  title: "Nosotros",
  description:
    "Hacemos software de inventario para negocios mexicanos que mueven mercancía: simple, en español y con tus datos bajo tu control.",
};

const PRINCIPLES = [
  {
    icon: Eye,
    title: "Claro antes que completo",
    text: "Cada pantalla responde una pregunta del día a día. Si algo necesita manual, lo rediseñamos.",
  },
  {
    icon: Lock,
    title: "Seguro por defecto",
    text: "Verificación en dos pasos, permisos por rol y una bitácora que nadie puede borrar. Revisamos la seguridad en cada etapa.",
  },
  {
    icon: Download,
    title: "Tus datos son tuyos",
    text: "Exporta catálogo, existencias y movimientos cuando quieras. Si te vas, te llevas todo.",
  },
  {
    icon: Languages,
    title: "Hecho en México",
    text: "En español, con RFC, pesos y el horario de tu negocio. Sin traducciones raras.",
  },
];

export default function AboutPage() {
  return (
    <>
      <PageHero
        eyebrow="Nosotros"
        title="Software de almacén para quien de verdad mueve mercancía"
      >
        Empezamos con una pregunta simple de una ferretería: «¿cuántas cajas de
        tornillos me quedan?». Nadie lo sabía sin ir a contar.
      </PageHero>

      <Section>
        <div className="grid gap-12 lg:grid-cols-2 lg:items-center">
          <div className="space-y-5 text-lg text-muted-foreground" data-reveal>
            <Eyebrow>Nuestra historia</Eyebrow>
            <p className="text-foreground">
              Las pymes mexicanas compran por caja, venden por pieza, guardan en
              tres bodegas y llevan todo en una hoja de cálculo que alguien
              olvidó actualizar.
            </p>
            <p>
              Los sistemas grandes son caros y lentos de implementar; los
              pequeños no entienden que una caja trae cien piezas, ni que un
              pedido llega en partes.
            </p>
            <p>
              Almacén nace de ese hueco: un inventario que hace bien lo
              esencial, al que se le agregan módulos (Compras hoy; Ventas y
              clientes después) solo cuando tu negocio los necesita.
            </p>
          </div>
          <div data-reveal="stagger" className="grid grid-cols-2 gap-4">
            {[
              { value: "1", label: "ferretería real como primer cliente" },
              { value: "2", label: "módulos disponibles hoy" },
              { value: "4", label: "roles para repartir el trabajo" },
              { value: "100%", label: "en español" },
            ].map((item) => (
              <div
                key={item.label}
                className="rounded-2xl border bg-card p-6 shadow-sm"
              >
                <p className="text-4xl font-semibold tracking-tight text-primary">
                  {item.value}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  {item.label}
                </p>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section className="bg-card/60">
        <div className="mx-auto max-w-2xl text-center" data-reveal>
          <Eyebrow>Cómo trabajamos</Eyebrow>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
            Cuatro principios que no negociamos
          </h2>
        </div>
        <ul
          data-reveal="stagger"
          className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
        >
          {PRINCIPLES.map(({ icon: Icon, title, text }) => (
            <li
              key={title}
              className="rounded-2xl border bg-card p-6 shadow-sm"
            >
              <span className="grid size-11 place-items-center rounded-xl bg-accent text-accent-foreground">
                <Icon className="size-5" aria-hidden="true" />
              </span>
              <h3 className="mt-5 font-semibold">{title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section id="contacto">
        <div
          data-reveal
          className="mx-auto flex max-w-3xl flex-col items-center gap-5 rounded-3xl border bg-card p-10 text-center shadow-sm"
        >
          <span className="grid size-12 place-items-center rounded-2xl bg-primary text-primary-foreground">
            <Mail className="size-5" aria-hidden="true" />
          </span>
          <h2 className="text-2xl font-semibold tracking-tight">Hablemos</h2>
          <p className="max-w-lg text-muted-foreground">
            ¿Dudas, una demostración o un plan a tu medida? Escríbenos.
          </p>
          <Button asChild size="lg">
            <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a>
          </Button>
        </div>
      </Section>

      <CtaBand />
    </>
  );
}
