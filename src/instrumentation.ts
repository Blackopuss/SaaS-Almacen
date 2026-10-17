import type { Instrumentation } from "next";

/**
 * Error capture (BAS-11): every error the server catches (page, route,
 * Server Action, proxy) becomes one structured log line, which /api/salud
 * also counts. The path goes without its query string: email links carry
 * their tokens there.
 */
export const onRequestError: Instrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  const { log, pathWithoutQuery } = await import("@/lib");
  log.error("request_error", error, {
    method: request.method,
    path: pathWithoutQuery(request.path),
    route: context.routePath,
    routeType: context.routeType,
  });
};
