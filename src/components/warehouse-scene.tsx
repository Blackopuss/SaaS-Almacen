"use client";

import { ArrowDownToLine, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";

import { cn } from "cn";

/**
 * Animated warehouse illustration for the account screens. Two motions only
 * (skill guidance): boxes settle onto the racks once, and a forklift crosses
 * the floor. With reduced motion the scene renders still and complete.
 * Decorative: hidden from screen readers.
 */

type Box = { x: number; y: number; w: number; h: number };

// Two racks with three levels each (beam tops at y = 150, 210, 270).
const RACKS = [40, 270];
const LEVELS = [150, 210, 270];
const BOXES: Box[] = [
  { x: 52, y: 120, w: 40, h: 30 },
  { x: 98, y: 128, w: 30, h: 22 },
  { x: 150, y: 116, w: 44, h: 34 },
  { x: 54, y: 184, w: 34, h: 26 },
  { x: 132, y: 178, w: 46, h: 32 },
  { x: 60, y: 238, w: 46, h: 32 },
  { x: 112, y: 246, w: 30, h: 24 },
  { x: 282, y: 122, w: 38, h: 28 },
  { x: 326, y: 116, w: 34, h: 34 },
  { x: 380, y: 126, w: 40, h: 24 },
  { x: 284, y: 180, w: 48, h: 30 },
  { x: 372, y: 186, w: 36, h: 24 },
  { x: 292, y: 240, w: 36, h: 30 },
  { x: 334, y: 246, w: 30, h: 24 },
  { x: 378, y: 236, w: 44, h: 34 },
];

function Crate({ box, index }: { box: Box; index: number }) {
  return (
    <motion.g
      initial={{ opacity: 0, y: -24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        delay: 0.15 + index * 0.07,
        type: "spring",
        stiffness: 380,
        damping: 22,
      }}
    >
      <rect
        x={box.x}
        y={box.y}
        width={box.w}
        height={box.h}
        rx={3}
        fill="var(--scene-box)"
      />
      <rect
        x={box.x}
        y={box.y + box.h - 6}
        width={box.w}
        height={6}
        rx={2}
        fill="var(--scene-box-shade)"
      />
      <rect
        x={box.x + box.w / 2 - 4}
        y={box.y}
        width={8}
        height={box.h - 6}
        fill="var(--scene-tape)"
        opacity={0.85}
      />
    </motion.g>
  );
}

function Rack({ x }: { x: number }) {
  return (
    <g>
      {[x, x + 164].map((ux) => (
        <rect
          key={ux}
          x={ux}
          y={96}
          width={6}
          height={204}
          rx={2}
          fill="var(--scene-rack)"
        />
      ))}
      {LEVELS.map((y) => (
        <rect
          key={y}
          x={x}
          y={y}
          width={170}
          height={7}
          rx={2}
          fill="var(--scene-beam)"
        />
      ))}
    </g>
  );
}

/** Forklift drawing, positioned at the origin of its group. */
function ForkliftShape() {
  return (
    <>
      {/* Load on the forks */}
      <rect
        x={66}
        y={276}
        width={34}
        height={26}
        rx={3}
        fill="var(--scene-box)"
      />
      <rect x={79} y={276} width={8} height={20} fill="var(--scene-tape)" />
      {/* Forks and mast */}
      <rect
        x={60}
        y={302}
        width={44}
        height={4}
        rx={1}
        fill="var(--scene-forklift-dark)"
      />
      <rect
        x={56}
        y={256}
        width={6}
        height={52}
        rx={2}
        fill="var(--scene-forklift-dark)"
      />
      {/* Body and cabin */}
      <rect
        x={4}
        y={286}
        width={54}
        height={24}
        rx={5}
        fill="var(--scene-forklift)"
      />
      <path
        d="M14 286 V262 a4 4 0 0 1 4 -4 H40 a4 4 0 0 1 4 4 V286"
        fill="none"
        stroke="var(--scene-forklift-dark)"
        strokeWidth={4}
        strokeLinejoin="round"
      />
      <rect
        x={0}
        y={290}
        width={8}
        height={14}
        rx={2}
        fill="var(--scene-forklift-dark)"
      />
      {/* Wheels */}
      {[18, 48].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy={312} r={9} fill="var(--scene-forklift-dark)" />
          <circle cx={cx} cy={312} r={3.5} fill="var(--scene-floor)" />
        </g>
      ))}
    </>
  );
}

/**
 * Moving forklift, or a parked one when the user asks for reduced motion.
 * Chosen with CSS (motion-reduce) so server and client render the same
 * markup (no hydration mismatch).
 */
function Forklift() {
  return (
    <>
      <motion.g
        className="motion-reduce:hidden"
        initial={{ x: -140 }}
        animate={{ x: 620 }}
        transition={{
          duration: 11,
          ease: "linear",
          repeat: Infinity,
          repeatDelay: 1.5,
          delay: 1.2,
        }}
      >
        <ForkliftShape />
      </motion.g>
      <g className="hidden motion-reduce:inline" transform="translate(150 0)">
        <ForkliftShape />
      </g>
    </>
  );
}

function FloatingCard({
  className,
  delay,
  children,
}: {
  className: string;
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12, scale: 0.96 }}
      animate={{ opacity: 1, y: [0, -6, 0], scale: 1 }}
      transition={{
        opacity: { delay, duration: 0.4 },
        scale: { delay, duration: 0.4 },
        y: {
          delay: delay + 0.4,
          duration: 4.5,
          repeat: Infinity,
          ease: "easeInOut",
        },
      }}
      className={cn(
        "absolute flex items-center gap-3 rounded-xl border bg-card/95 px-3.5 py-2.5 text-sm shadow-lg backdrop-blur",
        className,
      )}
    >
      {children}
    </motion.div>
  );
}

export function WarehouseScene({
  compact = false,
  className,
}: {
  compact?: boolean;
  className?: string;
}) {
  return (
    <div aria-hidden="true" className={cn("relative select-none", className)}>
      <svg
        // Compact view crops the empty sky so the racks fill small screens.
        viewBox={compact ? "24 92 432 240" : "0 0 480 340"}
        className="h-full w-full"
        role="presentation"
      >
        <defs>
          <linearGradient id="scene-floor-fade" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--scene-floor)" stopOpacity="1" />
            <stop offset="1" stopColor="var(--scene-floor)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Floor with lane markings */}
        <rect
          x={0}
          y={300}
          width={480}
          height={40}
          fill="url(#scene-floor-fade)"
        />
        {Array.from({ length: 8 }, (_, i) => (
          <rect
            key={i}
            x={10 + i * 62}
            y={326}
            width={34}
            height={3}
            rx={1.5}
            fill="var(--scene-beam)"
            opacity={0.55}
          />
        ))}
        {RACKS.map((x) => (
          <Rack key={x} x={x} />
        ))}
        {BOXES.map((box, i) => (
          <Crate key={i} box={box} index={i} />
        ))}
        <Forklift />
      </svg>

      {!compact && (
        <>
          <FloatingCard className="top-[6%] left-[4%]" delay={1.1}>
            <span className="grid size-8 place-items-center rounded-lg bg-success/15 text-success">
              <ArrowDownToLine className="size-4" />
            </span>
            <span>
              <span className="block font-medium">Entrada registrada</span>
              <span className="block text-muted-foreground tabular-nums">
                3 cajas × 100 = 300 pzas
              </span>
            </span>
          </FloatingCard>
          <FloatingCard className="top-[2%] right-[2%]" delay={1.6}>
            <span className="grid size-8 place-items-center rounded-lg bg-warning/15 text-warning">
              <TriangleAlert className="size-4" />
            </span>
            <span>
              <span className="block font-medium">Existencia baja</span>
              <span className="block text-muted-foreground tabular-nums">
                Cable THW · 12 m
              </span>
            </span>
          </FloatingCard>
        </>
      )}
    </div>
  );
}
