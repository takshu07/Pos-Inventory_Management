import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

import { reportClientError } from "@/lib/errorReporting";

interface Props {
  children?: ReactNode;
  /**
   * "app"   — full-screen fallback. Used once, at the root.
   * "route" — contained fallback that keeps the surrounding chrome (sidebar,
   *           navbar) usable so the operator can navigate away instead of
   *           being forced to reload the whole application.
   */
  variant?: "app" | "route";
  /** Shown in the fallback and attached to the error report. */
  label?: string;
  /** Resets the boundary when this value changes — see componentDidUpdate. */
  resetKey?: string | number;
}

interface State {
  hasError: boolean;
  error: Error | null;
  /** Correlation id, when the failure came from an API call. */
  requestId?: string;
}

/**
 * Error Boundary
 *
 * Responsibility: catch render-time errors in the child tree, report them, and
 * show a fallback instead of an unmounted (blank) screen.
 *
 * Why the `variant` split
 * -----------------------
 * Previously this was mounted once at the root with a full-screen fallback, so
 * ANY component that threw — a single dashboard widget with an unexpected null
 * — replaced the entire application with "Something went wrong" and a Refresh
 * button. For a POS that is a serious failure mode: a broken analytics widget
 * should never stop a cashier from taking payment. Mounting `variant="route"`
 * boundaries below the layout contains a crash to the pane that caused it.
 */
export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    // The API client attaches `requestId` to errors it rejects with (see
    // lib/api/axios.ts), which lets the fallback show the id that locates this
    // exact failure in the server logs.
    const requestId = (error as { requestId?: string }).requestId;

    return {
      hasError: true,
      error,
      ...(requestId !== undefined && { requestId }),
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportClientError(error, {
      componentStack: errorInfo.componentStack ?? undefined,
      boundary: this.props.label ?? this.props.variant ?? "app",
      requestId: (error as { requestId?: string }).requestId,
    });
  }

  /**
   * Clears the error when `resetKey` changes.
   *
   * Without this, a route-level boundary that caught an error stays in its
   * fallback state forever — React does not re-attempt a render on its own — so
   * navigating to a different, working page would still show the previous
   * page's error. Passing the pathname as `resetKey` makes navigation the
   * recovery action, which is what a user naturally tries first.
   */
  public componentDidUpdate(prevProps: Props) {
    if (
      this.state.hasError &&
      prevProps.resetKey !== this.props.resetKey
    ) {
      this.setState({ hasError: false, error: null, requestId: undefined });
    }
  }

  private handleRetry = () => {
    this.setState({ hasError: false, error: null, requestId: undefined });
  };

  public render() {
    if (!this.state.hasError) return this.props.children;

    const isRoute = this.props.variant === "route";

    const details = (
      <div
        className={
          isRoute
            ? "flex max-w-md flex-col items-center space-y-3 rounded-xl border border-destructive/20 bg-card p-6 text-center shadow-sm"
            : "flex max-w-md flex-col items-center space-y-4 rounded-xl border border-destructive/20 bg-card p-6 text-center shadow-sm"
        }
      >
        <AlertTriangle className={isRoute ? "h-9 w-9 text-destructive" : "h-12 w-12 text-destructive"} />

        <h2 className={isRoute ? "text-lg font-bold tracking-tight" : "text-xl font-bold tracking-tight"}>
          Something went wrong
        </h2>

        <p className="text-sm text-muted-foreground">
          {this.state.error?.message ||
            "An unexpected error occurred in the application."}
        </p>

        {/* The correlation id is the one piece of information that turns a
            support report into a searchable log query. Shown in a monospace,
            selectable block so it can be copied accurately. */}
        {this.state.requestId && (
          <p className="text-xs text-muted-foreground">
            Reference:{" "}
            <span className="select-all font-mono text-foreground">
              {this.state.requestId}
            </span>
          </p>
        )}

        <div className="mt-2 flex items-center gap-2">
          {/* A contained failure gets a retry that re-renders just this pane;
              only the app-level fallback needs a full reload. */}
          {isRoute ? (
            <button
              className="inline-flex items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              onClick={this.handleRetry}
            >
              <RefreshCw className="h-4 w-4" />
              Try again
            </button>
          ) : (
            <button
              className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow transition-colors hover:bg-primary/90"
              onClick={() => window.location.reload()}
            >
              Refresh Application
            </button>
          )}
        </div>
      </div>
    );

    if (isRoute) {
      // Contained: fills the content pane, leaves navigation chrome mounted so
      // the operator can move to a working screen without a reload.
      return (
        <div className="flex min-h-[60vh] flex-col items-center justify-center p-6">
          {details}
        </div>
      );
    }

    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-background p-6 text-foreground">
        {details}
      </div>
    );
  }
}
