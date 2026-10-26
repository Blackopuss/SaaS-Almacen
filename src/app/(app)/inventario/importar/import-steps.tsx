import { Check } from "lucide-react";

const STEPS = ["Subir archivo", "Columnas", "Revisar y confirmar"] as const;

/**
 * Where the person is in an import: three steps, always the same names,
 * so the flow reads as one task and not as separate screens (KISS).
 */
export function ImportSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <ol
      aria-label={`Paso ${current} de ${STEPS.length}`}
      className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm"
    >
      {STEPS.map((label, index) => {
        const step = index + 1;
        const done = step < current;
        const now = step === current;
        return (
          <li
            key={label}
            aria-current={now ? "step" : undefined}
            className={`flex items-center gap-2 ${now ? "font-medium" : "text-muted-foreground"}`}
          >
            <span
              aria-hidden="true"
              className={`grid size-6 place-items-center rounded-full text-xs font-semibold tabular-nums ${
                done
                  ? "bg-success/15 text-success"
                  : now
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? <Check className="size-4" /> : step}
            </span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}
