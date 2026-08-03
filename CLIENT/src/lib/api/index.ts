// Export the configured axios client
export { apiClient } from "./axios";

/**
 * The envelope every endpoint returns, as it actually arrives in feature code.
 *
 * ⚠ WHY THIS TYPE IS NEEDED AT ALL. The response interceptor in axios.ts returns
 * `response.data`, so what a caller receives is the server's
 * `{ success, message, data, meta }` envelope — NOT an `AxiosResponse`. Axios's
 * own types cannot express that substitution, so `apiClient.get<T>()` is still
 * typed as returning `AxiosResponse<T>` and every access to `res.meta` is a
 * compile error even though it is correct at runtime.
 *
 * Feature API layers previously worked around this by typing the response `any`,
 * which silences the error but also silences real ones — a typo in `res.mteta`
 * would compile. Casting through this type keeps `data` and `meta` checked.
 *
 * Usage:
 *   const res = await apiClient.get(BASE, { params }) as ApiEnvelope<Row[]>;
 *   res.data  // Row[]
 *   res.meta  // pagination, when the endpoint paginates
 */
export interface ApiEnvelope<TData, TMeta = ApiMeta> {
  success: boolean;
  message?: string;
  data: TData;
  /** Present only on list endpoints. */
  meta?: TMeta;
}

/**
 * Standard pagination metadata.
 *
 * Every field is optional because not all list endpoints send all of them —
 * `totalIsExact` in particular is set only where a count is capped for
 * performance (the audit tree). Callers should default rather than assume.
 */
export interface ApiMeta {
  total?: number;
  page?: number;
  limit?: number;
  totalPages?: number;
  hasNextPage?: boolean;
  hasPreviousPage?: boolean;
  /** Absent means exact. Only a capped count sets this false. */
  totalIsExact?: boolean;
}

// Future: Shared API utility functions can go here, like file download helpers
// specific to the POS application (e.g., downloading PDF receipts).
