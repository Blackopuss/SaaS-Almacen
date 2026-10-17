import { checkHealth } from "@/platform/ops";

/**
 * Health for the uptime monitor (BAS-11, PIL-04): 200 with `"ok": true`
 * when everything works, 503 otherwise. States only, no company data.
 */
export async function GET() {
  const health = await checkHealth();
  return Response.json(health, {
    status: health.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
