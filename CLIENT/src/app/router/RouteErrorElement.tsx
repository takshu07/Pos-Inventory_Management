/**
 * @file app/router/RouteErrorElement.tsx
 *
 * The router's error UI — what renders when a route fails OUTSIDE of React's
 * render pass.
 *
 * ── The blank screen this fixes ──────────────────────────────────────────────
 * Every route in this app is `async lazy()` — 77 of them. When one of those
 * dynamic imports rejects, the failure happens in React Router's data layer,
 * NOT during a component render. That distinction is the whole bug:
 *
 *   • `components/ui/ErrorBoundary` is a React error boundary. It catches
 *     throws from render/lifecycle. It cannot see a rejected route import.
 *   • React Router handles that itself, by walking up to the nearest route with
 *     an `errorElement`. There were none, so it fell back to its own default —
 *     which replaces the ENTIRE element tree, unmounting RootLayout, MainLayout,
 *     the sidebar and the navbar along with it.
 *
 * The result is a page with no navigation and no way back. Reported as
 * "Cycle Counts sometimes renders a completely blank white page".
 *
 * ── Why "sometimes" ─────────────────────────────────────────────────────────
 * A chunk import fails when the file cannot be fetched, so it is intermittent by
 * nature: a dropped connection, a captive-portal wifi hop mid-shift, or — the
 * common one — a redeploy that changes the content-hashed chunk filenames while
 * a till still has the old index loaded. Every lazy route on that tab then 404s
 * on click. A POS terminal stays open for days, so it sees this far more than a
 * typical web app.
 *
 * Mounting this at the layout level keeps the failure contained: the sidebar and
 * navbar stay mounted, so the operator can navigate to a working screen instead
 * of being stranded.
 */

import { isRouteErrorResponse, useNavigate, useRouteError } from "react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui";
import { reportClientError } from "@/lib/errorReporting";

/**
 * A failed dynamic import, as distinct from a thrown app error.
 *
 * Browsers do not agree on the message, so this matches the shapes seen in
 * practice rather than one canonical string. Worth identifying because the
 * recovery differs: a stale chunk is fixed by a RELOAD (which fetches the new
 * index and its new chunk names), where "Try again" would just re-request the
 * same missing file and fail identically.
 */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const text = `${error.name} ${error.message}`;
  return (
    /ChunkLoadError/i.test(text) ||
    /Loading chunk/i.test(text) ||
    /Failed to fetch dynamically imported module/i.test(text) ||
    /error loading dynamically imported module/i.test(text) ||
    /Importing a module script failed/i.test(text)
  );
}

export function RouteErrorElement() {
  const error = useRouteError();
  const navigate = useNavigate();

  const isChunkError = isChunkLoadError(error);

  // A 404 from a loader is a normal, expected outcome — not a defect worth
  // reporting. Everything else is.
  const routeResponse = isRouteErrorResponse(error) ? error : null;
  const isNotFound = routeResponse?.status === 404;

  if (!isNotFound) {
    reportClientError(error instanceof Error ? error : new Error(String(error)), {
      boundary: "route-error-element",
      isChunkError,
      ...(routeResponse ? { status: routeResponse.status } : {}),
    });
  }

  const title = isChunkError
    ? "This screen could not be loaded"
    : isNotFound
      ? "Page not found"
      : routeResponse
        ? `Request failed (${routeResponse.status})`
        : "Something went wrong";

  const message = isChunkError
    ? // Named plainly: this is nearly always a stale tab after a deploy, and
      // "reload" is the fix. Saying so beats a generic error the user cannot act on.
      "The application was updated while this tab was open, so part of it is no longer available. Reloading will pick up the new version."
    : isNotFound
      ? "That page does not exist. It may have been moved or renamed."
      : error instanceof Error && error.message
        ? error.message
        : "An unexpected error stopped this screen from loading.";

  const requestId =
    error && typeof error === "object" && "requestId" in error
      ? (error as { requestId?: string }).requestId
      : undefined;

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center p-6">
      <div className="flex max-w-md flex-col items-center space-y-3 rounded-xl border border-destructive/20 bg-card p-6 text-center shadow-sm">
        <AlertTriangle className="h-9 w-9 text-destructive" />

        <h2 className="text-lg font-bold tracking-tight">{title}</h2>

        <p className="text-sm text-muted-foreground">{message}</p>

        {requestId && (
          <p className="text-xs text-muted-foreground">
            Reference:{" "}
            <span className="select-all font-mono text-foreground">{requestId}</span>
          </p>
        )}

        <div className="mt-2 flex items-center gap-2">
          {isChunkError ? (
            // A reload is the ONLY thing that fixes a stale chunk — retrying the
            // same import re-requests a file that is no longer deployed.
            <Button onClick={() => window.location.reload()} leftIcon={<RefreshCw className="h-4 w-4" />}>
              Reload
            </Button>
          ) : (
            <Button onClick={() => void navigate(0)} leftIcon={<RefreshCw className="h-4 w-4" />}>
              Try again
            </Button>
          )}

          {/* Always offer a way OUT of the broken screen. The sidebar is still
              mounted, but on mobile it is behind a drawer, so an explicit exit
              matters. */}
          <Button variant="outline" onClick={() => void navigate("/")}>
            Go to dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
