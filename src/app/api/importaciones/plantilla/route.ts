import type { NextRequest } from "next/server";

import { isAppError } from "@/lib";
import { buildImportTemplate } from "@/modules/inventory";
import { requireOrganizationContext } from "@/platform/tenancy";

/**
 * Download of the import template (IMP-03): `?formato=xlsx` (default) or
 * `csv`. Only for people who may import; the template has no data of the
 * company, but it is part of that flow.
 */
export async function GET(request: NextRequest) {
  const { user, organization } = await requireOrganizationContext();
  const format =
    request.nextUrl.searchParams.get("formato") === "csv" ? "csv" : "xlsx";
  let template;
  try {
    template = await buildImportTemplate(
      { organizationId: organization.id, userId: user.id },
      format,
    );
  } catch (error) {
    if (isAppError(error) && error.kind === "forbidden") {
      return new Response("No encontramos ese archivo.", {
        status: 404,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }
    throw error;
  }
  return new Response(new Uint8Array(template.bytes), {
    status: 200,
    headers: {
      "content-type": template.contentType,
      "content-length": String(template.bytes.byteLength),
      "content-disposition": `attachment; filename="${template.name}"`,
      "x-content-type-options": "nosniff",
      "cache-control": "private, no-store",
    },
  });
}
