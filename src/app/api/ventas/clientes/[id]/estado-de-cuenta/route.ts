import type { NextRequest } from "next/server";

import { isAppError } from "@/lib";
import { buildStatementPdf } from "@/modules/sales";
import { requireOrganizationContext } from "@/platform/tenancy";

const notFound = () =>
  new Response("No encontramos ese archivo.", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "x-content-type-options": "nosniff",
      "cache-control": "no-store",
    },
  });

/**
 * Download of a customer statement as PDF (PAG-06). Person and company come
 * from the session; the service checks the permission to read accounts
 * and looks for the customer only inside that company. Someone without
 * access gets the same answer as for a customer that does not exist.
 */
export async function GET(
  _request: NextRequest,
  context: RouteContext<"/api/ventas/clientes/[id]/estado-de-cuenta">,
) {
  const { user, organization } = await requireOrganizationContext();
  const { id } = await context.params;
  let pdf;
  try {
    pdf = await buildStatementPdf(
      { organizationId: organization.id, userId: user.id },
      id,
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") return notFound();
    throw error;
  }
  if (!pdf) return notFound();
  return new Response(new Uint8Array(pdf.bytes), {
    status: 200,
    headers: {
      "content-type": pdf.contentType,
      "content-length": String(pdf.bytes.byteLength),
      // The name is made by the server.
      "content-disposition": `attachment; filename="${pdf.name}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
