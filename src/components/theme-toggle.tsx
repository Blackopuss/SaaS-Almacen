"use client";

import { Moon, Sun } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

import { cn } from "cn";

const subscribe = () => () => {};

/** True only after hydration: the theme is unknown while rendering on the server. */
function useMounted(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}

const STARS = [
  { top: "22%", left: "18%", size: 2 },
  { top: "58%", left: "30%", size: 1.5 },
  { top: "30%", left: "44%", size: 1 },
];

/**
 * Light/dark switch: a day-to-night track with a sliding sun/moon thumb.
 * Accessible as a switch (Space/Enter), 44px target, reduced-motion aware.
 */
export function ThemeToggle({
  className,
  showLabel = false,
}: {
  className?: string;
  showLabel?: boolean;
}) {
  const { resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const dark = mounted && resolvedTheme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label="Modo oscuro"
      disabled={!mounted}
      onClick={() => setTheme(dark ? "light" : "dark")}
      className={cn(
        "group inline-flex min-h-11 items-center gap-3 rounded-full px-1 text-sm font-medium text-muted-foreground outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative flex h-8 w-14 shrink-0 items-center overflow-hidden rounded-full p-1 shadow-inner ring-1 ring-black/5 transition-colors duration-300",
          dark
            ? "bg-gradient-to-br from-zinc-950 via-zinc-800 to-zinc-700 ring-white/10"
            : "bg-gradient-to-br from-sky-300 via-sky-200 to-amber-100",
        )}
      >
        <AnimatePresence>
          {dark &&
            STARS.map((star, i) => (
              <motion.span
                key={i}
                className="absolute rounded-full bg-white"
                style={{
                  top: star.top,
                  left: star.left,
                  width: star.size,
                  height: star.size,
                }}
                initial={{ opacity: 0, scale: 0 }}
                animate={{
                  opacity: 0.9,
                  scale: 1,
                  transition: { delay: 0.08 * i + 0.1 },
                }}
                exit={{ opacity: 0, transition: { duration: 0.1 } }}
              />
            ))}
        </AnimatePresence>
        <motion.span
          className={cn(
            "relative z-10 grid size-6 place-items-center rounded-full shadow-md",
            dark ? "bg-zinc-200 text-zinc-900" : "bg-white text-amber-500",
          )}
          initial={false}
          animate={{ x: dark ? 24 : 0 }}
          transition={{ type: "spring", stiffness: 500, damping: 32 }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={dark ? "moon" : "sun"}
              initial={{ rotate: -90, scale: 0.4, opacity: 0 }}
              animate={{ rotate: 0, scale: 1, opacity: 1 }}
              exit={{ rotate: 90, scale: 0.4, opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="grid place-items-center"
            >
              {dark ? (
                <Moon className="size-3.5" strokeWidth={2.5} />
              ) : (
                <Sun className="size-3.5" strokeWidth={2.5} />
              )}
            </motion.span>
          </AnimatePresence>
        </motion.span>
      </span>
      {showLabel && (
        <span className="transition-colors group-hover:text-foreground">
          Modo oscuro
        </span>
      )}
    </button>
  );
}
