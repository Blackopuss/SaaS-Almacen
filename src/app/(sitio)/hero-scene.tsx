"use client";

import { animate, utils } from "animejs";
import { ArrowDownToLine, MapPin } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { WarehouseScene } from "@/components";

import { formatCount } from "./content";

const START_STOCK = 1200;
const PER_DELIVERY = 100;

/**
 * Hero visual: the 3D warehouse (loaded after the page, so three.js never
 * delays the first paint) and a stock card that goes up with every box the
 * forklift brings. Without WebGL the 2D illustration takes its place.
 * Decorative: the numbers are an example, hidden from screen readers.
 */
export function HeroScene() {
  const stage = useRef<HTMLDivElement>(null);
  const count = useRef<HTMLSpanElement>(null);
  const badge = useRef<HTMLSpanElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;
    const stock = { value: START_STOCK };

    function deliver() {
      if (!count.current || !badge.current) return;
      const label = count.current;
      animate(stock, {
        value: stock.value + PER_DELIVERY,
        duration: 1100,
        ease: "outExpo",
        onUpdate: () => {
          label.textContent = formatCount(Math.round(stock.value));
        },
      });
      utils.set(badge.current, { opacity: 0, translateY: 10, scale: 0.9 });
      animate(badge.current, {
        opacity: [
          { to: 1, duration: 300 },
          { to: 0, delay: 1800, duration: 500 },
        ],
        translateY: [{ to: 0, duration: 400, ease: "outBack(2)" }],
        scale: [{ to: 1, duration: 400, ease: "outBack(2)" }],
      });
    }

    import("./warehouse-3d")
      .then(({ mountWarehouse }) => {
        if (cancelled || !stage.current) return;
        cleanup = mountWarehouse(stage.current, {
          onDeliver: deliver,
          onReady: () => setStatus("ready"),
        });
      })
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, []);

  if (status === "failed") {
    return <WarehouseScene className="aspect-[48/34] w-full" />;
  }

  return (
    <div aria-hidden="true" className="relative aspect-[5/4] w-full">
      <div
        ref={stage}
        className="absolute inset-0 transition-opacity duration-700 data-[status=loading]:opacity-0 motion-reduce:transition-none"
        data-status={status}
      />
      <div className="absolute bottom-[6%] left-0 w-64 rounded-xl border bg-card/90 p-4 shadow-lg backdrop-blur-md sm:left-[2%] sm:w-72">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              Tornillo hexagonal 1/4&quot;
            </p>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
              <MapPin className="size-3" />
              Zona A › Pasillo 2 › Estante 3
            </p>
          </div>
          <span
            ref={badge}
            className="absolute -top-3 right-4 inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-xs font-medium text-success-foreground opacity-0 shadow-md"
          >
            <ArrowDownToLine className="size-3" />
            +1 caja
          </span>
        </div>
        <p className="mt-3 flex items-baseline gap-1.5">
          <span
            ref={count}
            className="text-3xl font-semibold tracking-tight tabular-nums"
          >
            {formatCount(START_STOCK)}
          </span>
          <span className="text-sm text-muted-foreground">piezas</span>
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          1 caja = 100 piezas · se suma sola al recibir
        </p>
      </div>
    </div>
  );
}
