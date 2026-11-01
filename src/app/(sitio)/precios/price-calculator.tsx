"use client";

import { animate } from "animejs";
import { Check } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";

import { Button } from "@/components/ui/button";

import { formatCount, formatMoney } from "../site-shared";

export type PriceTier = {
  productLimit: number;
  users: number;
  inventory: number;
  purchasing: number;
  sales: number;
};

const ADD_ONS = [
  {
    id: "purchasing",
    name: "Compras",
    summary: "Proveedores, órdenes y recepciones",
  },
  {
    id: "sales",
    name: "Ventas",
    summary: "Punto de venta, cotizaciones y ventas a plazos",
  },
] as const;

/**
 * Pick how many products you manage and which modules you want; the
 * monthly total counts to the new amount (anime.js, still with reduced
 * motion). The slider moves between the capacity tiers.
 */
export function PriceCalculator({ tiers }: { tiers: PriceTier[] }) {
  const [index, setIndex] = useState(1);
  const [chosen, setChosen] = useState<Record<string, boolean>>({
    purchasing: true,
    sales: true,
  });
  const total = useRef<HTMLSpanElement>(null);
  const shown = useRef({ value: 0 });
  const sliderId = useId();
  const tier = tiers[index]!;
  const amount = ADD_ONS.reduce(
    (sum, module) => sum + (chosen[module.id] ? tier[module.id] : 0),
    tier.inventory,
  );

  useEffect(() => {
    const label = total.current;
    if (!label) return;
    const write = () => {
      label.textContent = formatMoney(Math.round(shown.current.value));
    };
    if (
      shown.current.value === 0 ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      shown.current.value = amount;
      write();
      return;
    }
    const animation = animate(shown.current, {
      value: amount,
      duration: 700,
      ease: "outExpo",
      onUpdate: write,
    });
    animate(label, { scale: [1.06, 1], duration: 500, ease: "outBack(2)" });
    return () => {
      animation.pause();
    };
  }, [amount]);

  return (
    <div className="grid overflow-hidden rounded-3xl border bg-card shadow-lg lg:grid-cols-[1.3fr_1fr]">
      <div className="space-y-8 p-6 sm:p-10">
        <div>
          <label htmlFor={sliderId} className="text-sm font-medium">
            ¿Cuántos productos activos manejas?
          </label>
          <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">
            Hasta {formatCount(tier.productLimit)}
          </p>
          <input
            id={sliderId}
            type="range"
            min={0}
            max={tiers.length - 1}
            step={1}
            value={index}
            onChange={(event) => setIndex(Number(event.target.value))}
            aria-valuetext={`Hasta ${formatCount(tier.productLimit)} productos`}
            className="mt-6 h-11 w-full cursor-pointer accent-[var(--primary)]"
          />
          <div className="mt-1 flex justify-between text-xs text-muted-foreground tabular-nums">
            {tiers.map((item) => (
              <span key={item.productLimit}>
                {formatCount(item.productLimit)}
              </span>
            ))}
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Módulos</legend>
          <div className="flex items-center justify-between gap-4 rounded-xl border bg-background p-4">
            <div>
              <p className="font-medium">Inventario</p>
              <p className="text-sm text-muted-foreground">Incluido siempre</p>
            </div>
            <span className="text-sm font-medium tabular-nums">
              {formatMoney(tier.inventory)}
            </span>
          </div>
          {ADD_ONS.map((module) => (
            <label
              key={module.id}
              className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border bg-background p-4 transition-colors has-[:checked]:border-primary has-[:checked]:bg-accent/60 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
            >
              <span className="flex items-center gap-3">
                <input
                  type="checkbox"
                  checked={chosen[module.id] ?? false}
                  onChange={(event) => {
                    const checked = event.target.checked;
                    setChosen((now) => ({ ...now, [module.id]: checked }));
                  }}
                  className="size-5 accent-[var(--primary)]"
                />
                <span>
                  <span className="block font-medium">{module.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {module.summary}
                  </span>
                </span>
              </span>
              <span className="text-sm font-medium tabular-nums">
                + {formatMoney(tier[module.id])}
              </span>
            </label>
          ))}
        </fieldset>
      </div>

      <div className="flex flex-col justify-between gap-8 border-t bg-muted/50 p-6 sm:p-10 lg:border-t-0 lg:border-l">
        <div>
          <p className="text-sm font-medium text-muted-foreground">
            Total al mes
          </p>
          <p className="mt-2 flex items-baseline gap-2">
            <span
              ref={total}
              aria-hidden="true"
              className="inline-block origin-left text-5xl font-semibold tracking-tight tabular-nums"
            >
              {formatMoney(amount)}
            </span>
            <span className="sr-only" aria-live="polite">
              {formatMoney(amount)}
            </span>
          </p>
          <p className="mt-1 text-sm text-muted-foreground">MXN</p>
          <ul className="mt-6 space-y-2.5 text-sm">
            {[
              `${tier.users} personas incluidas`,
              `Hasta ${formatCount(tier.productLimit)} productos activos`,
              "Ubicaciones y movimientos sin límite",
              "Importación y exportación en Excel",
              "Verificación en dos pasos y bitácora",
            ].map((item) => (
              <li key={item} className="flex items-start gap-2">
                <Check
                  className="mt-0.5 size-4 shrink-0 text-success"
                  aria-hidden="true"
                />
                {item}
              </li>
            ))}
          </ul>
        </div>
        <Button asChild size="lg" className="w-full">
          <Link href="/registro">Crear cuenta</Link>
        </Button>
      </div>
    </div>
  );
}
