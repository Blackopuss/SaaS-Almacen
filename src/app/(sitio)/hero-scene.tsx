"use client";

import { useEffect, useRef, useState } from "react";

import { WarehouseScene } from "@/components";

/**
 * Hero visual: the 3D warehouse (loaded after the page, so three.js never
 * delays the first paint). Without WebGL the 2D illustration takes its place.
 * Decorative, hidden from screen readers.
 */
export function HeroScene() {
  const stage = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );

  useEffect(() => {
    let cleanup: (() => void) | undefined;
    let cancelled = false;

    import("./warehouse-3d")
      .then(({ mountWarehouse }) => {
        if (cancelled || !stage.current) return;
        cleanup = mountWarehouse(stage.current, {
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
    </div>
  );
}
