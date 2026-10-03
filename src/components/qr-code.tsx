import { encode } from "uqr";

/**
 * QR code drawn as SVG (no images, no external service). Always dark on
 * white with a 4-module quiet zone so phone cameras read it in both themes.
 */
export function QrCode({
  value,
  label,
  className,
}: {
  value: string;
  /** Accessible description of what the code contains. */
  label: string;
  className?: string;
}) {
  const { data, size } = encode(value, { ecc: "M", border: 4 });
  let path = "";
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x},${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${size} ${size}`}
      shapeRendering="crispEdges"
      className={`bg-qr text-qr-foreground ${className ?? ""}`}
    >
      <path fill="currentColor" d={path} />
    </svg>
  );
}
