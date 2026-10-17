"use client";

import {
  animate,
  createTimeline,
  onScroll,
  stagger,
  svg,
  utils,
} from "animejs";
import type { Timeline } from "animejs";
import { Check, ScanBarcode } from "lucide-react";
import { useEffect, useRef } from "react";
import type { RefObject } from "react";

/**
 * Small looping demos of the landing's feature cards (anime.js). Each one
 * plays only while it is on screen; with reduced motion it shows its final
 * state and does not move. Decorative: the card text says the same.
 */

function useLoop(
  root: RefObject<HTMLElement | null>,
  build: (element: HTMLElement) => Timeline,
) {
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const timeline = build(element);
    timeline.pause();
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) timeline.play();
      else timeline.pause();
    });
    observer.observe(element);
    return () => {
      observer.disconnect();
      timeline.revert();
    };
    // `build` is static per component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** «3 cajas × 100 = 300 piezas»: boxes drop in and the total counts up. */
export function PresentationDemo() {
  const root = useRef<HTMLDivElement>(null);
  useLoop(root, (element) => {
    const boxes = element.querySelectorAll("[data-box]");
    const total = element.querySelector<HTMLElement>("[data-total]")!;
    const boxCount = element.querySelector<HTMLElement>("[data-boxes]")!;
    const state = { boxes: 0, pieces: 0 };
    const write = () => {
      boxCount.textContent = String(Math.round(state.boxes));
      total.textContent = String(Math.round(state.pieces));
    };
    return createTimeline({ loop: true, loopDelay: 1600, onUpdate: write })
      .set(boxes, { opacity: 0, translateY: -28 })
      .set(state, { boxes: 0, pieces: 0 })
      .add(boxes, {
        opacity: 1,
        translateY: 0,
        duration: 600,
        delay: stagger(260),
        ease: "outBounce",
      })
      .add(state, { boxes: 3, duration: 900, ease: "linear" }, 0)
      .add(state, { pieces: 300, duration: 1000, ease: "outExpo" })
      .add(boxes, { opacity: 0.35, duration: 500, delay: 1400 });
  });

  return (
    <div ref={root} aria-hidden="true" className="flex flex-col gap-4">
      <div className="flex h-16 items-end gap-2">
        {[0, 1, 2].map((box) => (
          <span
            key={box}
            data-box
            className="relative grid size-14 place-items-center rounded-md bg-[var(--scene-box)] shadow-sm after:absolute after:inset-y-0 after:left-1/2 after:w-2.5 after:-translate-x-1/2 after:bg-[var(--scene-tape)]/80"
          />
        ))}
      </div>
      <p className="font-mono text-lg tabular-nums">
        <span data-boxes>3</span> cajas × 100 ={" "}
        <span data-total className="font-semibold text-primary">
          300
        </span>{" "}
        piezas
      </p>
    </div>
  );
}

/** A scan line crosses a barcode and the product appears. */
export function ScanDemo() {
  const root = useRef<HTMLDivElement>(null);
  useLoop(root, (element) => {
    const line = element.querySelector("[data-line]")!;
    const result = element.querySelector("[data-result]")!;
    return createTimeline({ loop: true, loopDelay: 1200 })
      .set(result, { opacity: 0, translateY: 8 })
      .add(line, {
        translateX: ["0%", "1400%"],
        duration: 1100,
        ease: "inOutSine",
        alternate: true,
        loop: 1,
      })
      .add(result, {
        opacity: 1,
        translateY: 0,
        duration: 450,
        ease: "outBack(1.6)",
      })
      .add(result, { opacity: 1, duration: 1600 });
  });

  return (
    <div ref={root} aria-hidden="true" className="space-y-3">
      <div className="relative flex h-16 items-stretch gap-[3px] overflow-hidden rounded-md bg-qr p-2">
        {[3, 1, 2, 1, 3, 2, 1, 1, 3, 1, 2, 3, 1, 2, 1, 3, 1, 2, 2, 1, 3, 1].map(
          (width, index) => (
            <span
              key={index}
              className="bg-qr-foreground"
              style={{ width: `${width * 2}px` }}
            />
          ),
        )}
        <span
          data-line
          className="absolute inset-y-0 left-0 w-[7%] bg-destructive/60 shadow-[0_0_16px_var(--destructive)]"
        />
      </div>
      <p
        data-result
        className="flex items-center gap-2 rounded-lg border bg-card px-3 py-2 text-sm"
      >
        <ScanBarcode className="size-4 text-primary" />
        <span className="font-medium">Pija 8 × 1&quot;</span>
        <span className="ml-auto text-muted-foreground">+1 pza</span>
      </p>
    </div>
  );
}

const ORDER_STEPS = ["Borrador", "Enviada", "Parcial", "Recibida"];

/** A purchase order moves through its states. */
export function OrderDemo() {
  const root = useRef<HTMLDivElement>(null);
  useLoop(root, (element) => {
    const dots = element.querySelectorAll("[data-dot]");
    const bar = element.querySelector("[data-bar]")!;
    const timeline = createTimeline({ loop: true, loopDelay: 1500 })
      .set(bar, { scaleX: 0 })
      .set(dots, {
        backgroundColor: "var(--muted)",
        color: "var(--muted-foreground)",
      });
    dots.forEach((dot, index) => {
      timeline
        .add(bar, {
          scaleX: index / (dots.length - 1),
          duration: 700,
          ease: "inOutQuad",
        })
        .add(dot, {
          backgroundColor: "var(--primary)",
          color: "var(--primary-foreground)",
          scale: [1.25, 1],
          duration: 450,
          ease: "outBack(2)",
        });
    });
    return timeline;
  });

  return (
    <div ref={root} aria-hidden="true" className="relative px-2 pt-1">
      <span className="absolute top-[18px] right-8 left-8 h-0.5 bg-muted" />
      <span
        data-bar
        className="absolute top-[18px] right-8 left-8 h-0.5 origin-left bg-primary"
      />
      <ol className="relative flex justify-between">
        {ORDER_STEPS.map((step) => (
          <li key={step} className="flex w-16 flex-col items-center gap-2">
            <span
              data-dot
              className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground"
            >
              <Check className="size-4" />
            </span>
            <span className="text-xs text-muted-foreground">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Location chips appear one after another: Zona › Pasillo › Estante. */
export function LocationDemo() {
  const root = useRef<HTMLDivElement>(null);
  useLoop(root, (element) => {
    const chips = element.querySelectorAll("[data-chip]");
    return createTimeline({ loop: true, loopDelay: 1800 })
      .set(chips, { opacity: 0, translateX: -12 })
      .add(chips, {
        opacity: 1,
        translateX: 0,
        duration: 500,
        delay: stagger(350),
        ease: "outQuint",
      })
      .add(chips, { opacity: 1, duration: 1400 });
  });

  return (
    <div
      ref={root}
      aria-hidden="true"
      className="flex flex-wrap items-center gap-1.5"
    >
      {["Zona A", "Pasillo 2", "Estante 3"].map((chip, index) => (
        <span key={chip} data-chip className="flex items-center gap-1.5">
          {index > 0 && <span className="text-muted-foreground">›</span>}
          <span className="rounded-md border bg-card px-2.5 py-1 text-sm font-medium">
            {chip}
          </span>
        </span>
      ))}
    </div>
  );
}

/** The dashed path that joins the three steps draws itself on scroll. */
export function StepsPath() {
  const root = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const [path] = svg.createDrawable(element.querySelector("path")!);
    utils.set(path!, { draw: "0 0" });
    const animation = animate(path!, {
      draw: "0 1",
      ease: "linear",
      autoplay: onScroll({
        target: element,
        sync: 0.4,
        enter: "end start",
        leave: "center end",
      }),
    });
    return () => {
      animation.revert();
    };
  }, []);

  return (
    <svg
      ref={root}
      aria-hidden="true"
      viewBox="0 0 1000 60"
      preserveAspectRatio="none"
      className="pointer-events-none absolute top-7 left-[16%] hidden h-16 w-[68%] md:block"
    >
      <path
        d="M0 30 C 160 -10, 340 70, 500 30 S 840 -10, 1000 30"
        fill="none"
        stroke="var(--primary)"
        strokeWidth="2"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        opacity="0.5"
      />
    </svg>
  );
}
