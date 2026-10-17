import { CircleAlert } from "lucide-react";

import { Label } from "./ui/label";

/**
 * Label + control + hint + error, wired for screen readers. Pass the control
 * as a render function to receive the ids and aria props it must carry.
 */
export function FormField({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: (control: {
    id: string;
    "aria-invalid": boolean;
    "aria-describedby": string | undefined;
  }) => React.ReactNode;
}) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      {children({
        id,
        "aria-invalid": Boolean(error),
        "aria-describedby": describedBy,
      })}
      {error && (
        <p
          id={errorId}
          className="flex items-start gap-1.5 text-sm text-destructive"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      )}
    </div>
  );
}
