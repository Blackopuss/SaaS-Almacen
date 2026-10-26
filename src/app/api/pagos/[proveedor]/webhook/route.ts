import { handleWebhook } from "@/platform/billing";

/**
 * Webhooks of the payment providers (ADR 0028): public, authenticated by
 * the provider's signature, never by a session. The body is read raw: the
 * signature covers exactly those bytes.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ proveedor: string }> },
) {
  const { proveedor } = await params;
  const rawBody = await request.text();
  if (rawBody.length > 256 * 1024) {
    return new Response(null, { status: 413 });
  }
  const { status } = await handleWebhook(proveedor, {
    headers: request.headers,
    rawBody,
    url: new URL(request.url),
  });
  return new Response(null, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
