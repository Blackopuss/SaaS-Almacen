import { CircleAlert } from "lucide-react";

const link =
  "rounded font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50";

/**
 * Checkbox to accept the terms and the privacy notice (PIL-09). Sends
 * `acceptLegal=1`; the service validates it and stores the versions. The
 * links open in a new tab so what was typed in the form is not lost.
 */
export function LegalConsent({
  error,
  defaultChecked = false,
}: {
  error?: string;
  defaultChecked?: boolean;
}) {
  return (
    <div className="space-y-2">
      <div className="flex min-h-11 items-start gap-3 text-sm">
        <input
          id="acceptLegal"
          name="acceptLegal"
          type="checkbox"
          value="1"
          defaultChecked={defaultChecked}
          required
          aria-invalid={Boolean(error)}
          aria-describedby={error ? "acceptLegal-error" : undefined}
          className="mt-0.5 size-5 shrink-0 accent-primary"
        />
        <label htmlFor="acceptLegal" className="leading-6">
          Leí y acepto los{" "}
          <a href="/terminos" target="_blank" rel="noopener" className={link}>
            términos y condiciones
          </a>{" "}
          y el{" "}
          <a href="/privacidad" target="_blank" rel="noopener" className={link}>
            aviso de privacidad
          </a>
          .
        </label>
      </div>
      {error && (
        <p
          id="acceptLegal-error"
          className="flex items-start gap-1.5 text-sm text-destructive"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
    </div>
  );
}
