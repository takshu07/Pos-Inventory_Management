import type { Request, Response } from "express";
import { prisma } from "../config/prisma";
import { getMetricsSnapshot } from "../utils/metrics";
import { SLOW_QUERY_THRESHOLD_MS } from "../config/queryInstrumentation";
import os from "os";

// =============================================================================
// SHUTDOWN STATE — why readiness must fail BEFORE the server closes
//
// A load balancer keeps routing to this instance until its readiness probe
// fails. Graceful shutdown alone does not tell it anything: on SIGTERM the old
// implementation went straight to `server.close()`, so for the seconds between
// the signal and the socket actually closing, the LB was still sending requests
// to an instance that was refusing them — surfacing to cashiers as failed sales
// during every deploy.
//
// Marking the instance NOT ready first gives the LB a probe interval to take it
// out of rotation while in-flight requests finish normally. This is the drain
// phase, and it is the difference between a zero-downtime deploy and a visible
// one.
// =============================================================================

let shuttingDown = false;

/** Called by the shutdown handler at the START of graceful shutdown. */
export function beginShutdown(): void {
  shuttingDown = true;
}

/** Test seam — restores the ready state. */
export function resetShutdownState(): void {
  shuttingDown = false;
}

export const getLiveness = (_req: Request, res: Response) => {
  // Liveness simply indicates the Node.js process is running and hasn't deadlocked.
  //
  // It stays 200 during shutdown ON PURPOSE: a failing LIVENESS probe tells an
  // orchestrator the process is wedged and should be SIGKILLed, which would
  // abort the very drain we are trying to perform. Readiness is the probe that
  // reflects draining.
  return res.status(200).json({ status: "alive", timestamp: new Date().toISOString() });
};

export const getReadiness = async (_req: Request, res: Response) => {
  // Readiness indicates if the app can accept traffic (Database is reachable)
  if (shuttingDown) {
    return res
      .status(503)
      .json({ status: "shutting_down", database: "draining" });
  }

  try {
    await prisma.$queryRaw`SELECT 1`;
    return res.status(200).json({ status: "ready", database: "connected" });
  } catch {
    return res.status(503).json({ status: "not_ready", database: "disconnected" });
  }
};

export const getDetailedHealth = async (_req: Request, res: Response) => {
  // Full health dump for internal admin dashboards
  const health = {
    status: shuttingDown ? "shutting_down" : "ok",
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    system: {
      memory: {
        free: os.freemem(),
        total: os.totalmem(),
        processRss: process.memoryUsage().rss
      },
      cpu: os.loadavg(),
    },
    database: "unknown"
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    health.database = "connected";
    return res.status(shuttingDown ? 503 : 200).json(health);
  } catch {
    health.status = "degraded";
    health.database = "disconnected";
    return res.status(503).json(health); // 503 Service Unavailable
  }
};

/**
 * Per-route latency percentiles and error rates for THIS process.
 *
 * Deliberately unauthenticated, matching the other probes: it exposes no
 * business data — only route templates, counts and timings — and it has to stay
 * reachable when authentication is the thing that is broken. Route paths are
 * normalized (`/sales/:id`), so no identifiers appear.
 *
 * If this is ever deployed on a public interface, restrict `/health` at the
 * ingress/security-group layer rather than adding auth here, so probes keep
 * working during an auth outage.
 */
export const getMetrics = (_req: Request, res: Response) => {
  return res.status(200).json({
    ...getMetricsSnapshot(),
    slowQueryThresholdMs: SLOW_QUERY_THRESHOLD_MS,
  });
};
