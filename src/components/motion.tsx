"use client";

import {
  AnimatePresence,
  MotionConfig,
  motion,
  type HTMLMotionProps,
  type Transition,
} from "motion/react";

/**
 * Motion presets (BAS-12). Short and purposeful: motion explains a change,
 * never decorates. Exits are faster than entries. Users who ask the OS to
 * reduce motion get instant state changes (MotionConfig reducedMotion="user").
 */
export const transitions = {
  enter: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
  exit: { duration: 0.15, ease: [0.4, 0, 1, 1] },
  spring: { type: "spring", stiffness: 420, damping: 34, mass: 0.8 },
} satisfies Record<string, Transition>;

export function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Fades content in with a small upward offset (8px). */
export function FadeIn({ transition, ...props }: HTMLMotionProps<"div">) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{
        opacity: 1,
        y: 0,
        transition: transition ?? transitions.enter,
      }}
      exit={{ opacity: 0, y: 4, transition: transitions.exit }}
      {...props}
    />
  );
}

export { AnimatePresence, motion };
