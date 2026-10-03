"use client";

import { motion } from "motion/react";

import { cn } from "cn";

import { transitions } from "./motion";

/**
 * Container for account forms drawn as a warehouse front: gable roof and a
 * loading-dock hazard stripe. On entry the roof
 * settles and a roll-up shutter opens to reveal the form. With reduced motion
 * the shutter is not rendered (CSS motion-reduce, same markup on server and
 * client) and everything appears at once.
 */
export function WarehouseCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("w-full max-w-md", className)}>
      {/* Roof */}
      <motion.div
        aria-hidden="true"
        className="relative -mx-3 h-14 sm:-mx-4"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={transitions.enter}
      >
        <svg
          viewBox="0 0 400 56"
          preserveAspectRatio="none"
          className="absolute inset-0 h-full w-full"
        >
          <polygon points="0,48 200,4 400,48" fill="var(--scene-rack)" />
          <polygon
            points="16,48 200,10 384,48"
            fill="var(--scene-rack)"
            opacity="0.55"
          />
          <rect
            x="0"
            y="46"
            width="400"
            height="10"
            fill="var(--scene-forklift-dark)"
          />
        </svg>
      </motion.div>

      {/* Building */}
      <div className="relative overflow-hidden border-x border-b bg-card shadow-lg">
        <div className="relative p-6 sm:p-8">{children}</div>

        {/* Roll-up shutter that opens on entry */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 [background-image:repeating-linear-gradient(180deg,var(--scene-rack)_0,var(--scene-rack)_9px,var(--scene-forklift-dark)_9px,var(--scene-forklift-dark)_11px)] motion-reduce:hidden"
          initial={{ y: "0%" }}
          animate={{ y: "-102%" }}
          transition={{ delay: 0.25, duration: 0.75, ease: [0.65, 0, 0.35, 1] }}
        >
          <span className="absolute inset-x-0 bottom-0 h-2 bg-[var(--scene-forklift-dark)]" />
          <span className="absolute bottom-3 left-1/2 h-1.5 w-16 -translate-x-1/2 rounded-full bg-[var(--scene-beam)]" />
        </motion.div>
      </div>

      {/* Loading dock: hazard stripe and bumpers */}
      <div aria-hidden="true" className="relative">
        <div className="h-2.5 [background-image:repeating-linear-gradient(-45deg,var(--scene-beam)_0,var(--scene-beam)_10px,var(--scene-forklift-dark)_10px,var(--scene-forklift-dark)_20px)]" />
        <div className="flex justify-between px-8">
          <span className="h-2 w-6 rounded-b bg-[var(--scene-forklift-dark)]" />
          <span className="h-2 w-6 rounded-b bg-[var(--scene-forklift-dark)]" />
        </div>
      </div>
    </div>
  );
}
