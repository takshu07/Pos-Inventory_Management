/**
 * @file lib/api/requestId.ts
 *
 * Resolves the server's correlation id from a failed response.
 *
 * Kept as a standalone, dependency-free function so it can be unit-tested
 * without importing the axios client (which pulls in `import.meta.env` and the
 * auth store, neither of which belongs in a pure test).
 *
 * The server emits the id in two places:
 *   • the `X-Request-Id` header, on EVERY response
 *   • a `requestId` field in the JSON body, on a 500
 *
 * The header wins because it is present even when the failure produced no
 * parseable body (a gateway timeout, a truncated response). The body is the
 * fallback for the case the header did not survive an intermediary.
 */

export interface ErrorBodyWithRequestId {
  requestId?: unknown;
}

export function resolveRequestId(
  headers: unknown,
  body: ErrorBodyWithRequestId | undefined
): string | undefined {
  // Axios lowercases response header names, but a raw fetch/proxy may not, so
  // both spellings are accepted rather than relying on the casing of the day.
  if (typeof headers === "object" && headers !== null) {
    const record = headers as Record<string, unknown>;
    const fromHeader = record["x-request-id"] ?? record["X-Request-Id"];
    if (typeof fromHeader === "string" && fromHeader.length > 0) {
      return fromHeader;
    }
  }

  const fromBody = body?.requestId;
  if (typeof fromBody === "string" && fromBody.length > 0) {
    return fromBody;
  }

  return undefined;
}
