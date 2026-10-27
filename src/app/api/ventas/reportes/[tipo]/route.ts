import type { NextRequest } from "next/server";

import { isAppError } from "@/lib";
import { buildSalesReport, isSalesReportKind } from "@/modules/sales";
import { requireOrganizationContext } from "@/platform/tenancy";

const plain = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });

/**
 * Download of a report of Ventas (VEN-23): `/api/ventas/reportes/
 * dias`, `/productos` or `/cajeros` (with `?desde=` and `?hasta=`), with
 * `?formato=xlsx` (default) or `csv`.
 *
 * Person and company come from the session; the service checks the
 * permission to export and reads through the same services as the screen
 * (without the profit for who may not see costs). Someone without access gets
 * the same answer as for a file that does not exist.
 */
export async function GET(
  request: NextRequest,
  context: RouteContext<"/api/ventas/reportes/[tipo]">,
) {
  const { user, organization } = await requireOrganizationContext();
  const { tipo } = await context.params;
  const query = request.nextUrl.searchParams;
  const format = query.get("formato") ?? "xlsx";
  if (!isSalesReportKind(tipo) || (format !== "xlsx" && format !== "csv")) {
    return plain(400, "Ese reporte no existe.");
  }
  const day = (name: string) => {
    const value = query.get(name)?.trim() ?? "";
    return value === "" ? undefined : value.slice(0, 10);
  };
  let result;
  try {
    result = await buildSalesReport(
      { organizationId: organization.id, userId: user.id },
      { kind: tipo, format, from: day("desde"), to: day("hasta") },
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return plain(404, "No encontramos ese archivo.");
    }
    throw error;
  }
  if (!result.ok) return plain(400, result.error);
  return new Response(new Uint8Array(result.bytes), {
    status: 200,
    headers: {
      "content-type": result.contentType,
      "content-length": String(result.bytes.byteLength),
      // The name is made by the server: letters, digits and dashes only.
      "content-disposition": `attachment; filename="${result.name}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
