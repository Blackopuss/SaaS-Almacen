import { Check } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import type { FirstSteps } from "@/modules/inventory";

/** What the person may do, decided on the server from their access. */
export type FirstStepsAbilities = {
  importProducts: boolean;
  createProduct: boolean;
  createLocation: boolean;
  openingBalance: boolean;
  entry: boolean;
  exit: boolean;
};

type Step = {
  title: string;
  done: boolean;
  /** Shown while the step is the next one to do. */
  body: React.ReactNode;
  actions: { href: string; label: string }[];
};

const textLink =
  "font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 rounded";

/**
 * Guide of first use (IMP-12): from an empty company to a catalog, its
 * stock and a first movement, one step at a time. It shows what is done,
 * opens the next step with the one or two ways to do it, and goes away
 * when the three are done. Every action is offered only to who may do it.
 */
export function FirstStepsGuide({
  steps,
  can,
}: {
  steps: FirstSteps;
  can: FirstStepsAbilities;
}) {
  const list: Step[] = [
    {
      title: "Trae tus productos",
      done: steps.hasProducts,
      body: (
        <>
          Lo más rápido es subir tu Excel: descargas la plantilla, la llenas (o
          usas tu propio archivo) y entran todos de una vez, con sus existencias
          si las pones.{" "}
          {can.createLocation && (
            <>
              Si acomodas por zonas o estantes,{" "}
              <Link href="/ubicaciones" className={textLink}>
                créalos primero en Ubicaciones
              </Link>{" "}
              para poder nombrarlos en el archivo.
            </>
          )}
        </>
      ),
      actions: [
        ...(can.importProducts
          ? [{ href: "/inventario/importar", label: "Importar desde Excel" }]
          : []),
        ...(can.createProduct
          ? [{ href: "/inventario/nuevo", label: "Agregar uno a mano" }]
          : []),
      ],
    },
    {
      title: "Di cuánto tienes",
      done: steps.hasStock,
      body: "Si tu archivo no traía existencias, captura lo que hay hoy de cada producto, por ubicación. Es tu punto de partida: se hace una vez.",
      actions: can.openingBalance
        ? [
            {
              href: "/movimientos/saldo-inicial",
              label: "Capturar saldo inicial",
            },
          ]
        : [],
    },
    {
      title: "Registra tu primer movimiento",
      done: steps.hasMovement,
      body: "De aquí en adelante, lo que llega es una entrada y lo que se vende o se usa es una salida. Con eso tus existencias se mantienen solas.",
      actions: [
        ...(can.entry
          ? [{ href: "/movimientos/entrada", label: "Registrar entrada" }]
          : []),
        ...(can.exit
          ? [{ href: "/movimientos/salida-rapida", label: "Salida rápida" }]
          : []),
      ],
    },
  ];
  const done = list.filter((step) => step.done).length;
  const next = list.findIndex((step) => !step.done);

  return (
    <section
      aria-labelledby="primeros-pasos"
      className="rounded-xl border bg-card"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b p-4 sm:px-5">
        <h2 id="primeros-pasos" className="font-medium">
          Primeros pasos
        </h2>
        <p className="text-sm text-muted-foreground tabular-nums">
          {done} de {list.length} listos
        </p>
      </div>
      <ol className="divide-y">
        {list.map((step, index) => {
          const current = index === next;
          return (
            <li
              key={step.title}
              aria-current={current ? "step" : undefined}
              className="flex items-start gap-3 p-4 sm:px-5"
            >
              <span
                aria-hidden="true"
                className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
                  step.done
                    ? "bg-success/15 text-success"
                    : current
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {step.done ? <Check className="size-4" /> : index + 1}
              </span>
              <div className="min-w-0 space-y-2">
                <p
                  className={
                    step.done
                      ? "text-muted-foreground"
                      : current
                        ? "font-medium"
                        : undefined
                  }
                >
                  {step.title}
                  <span className="sr-only">
                    {step.done
                      ? " (listo)"
                      : current
                        ? " (siguiente paso)"
                        : " (pendiente)"}
                  </span>
                </p>
                {current && (
                  <>
                    <p className="text-sm text-muted-foreground">{step.body}</p>
                    {step.actions.length > 0 ? (
                      <div className="flex flex-wrap gap-2">
                        {step.actions.map((action, position) => (
                          <Button
                            key={action.href}
                            asChild
                            variant={position === 0 ? "default" : "outline"}
                          >
                            <Link href={action.href}>{action.label}</Link>
                          </Button>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm">
                        Tu acceso no incluye este paso: pídelo a quien lleva el
                        inventario en tu empresa.
                      </p>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
