// =============================================================================
// SERVER ENTRY POINT
//
// IMPORTANT: The dotenv import MUST be the very first import in this file.
// Module evaluation order in Node.js means that any imported module that reads
// process.env at module scope (e.g., config/prisma.ts) will see an empty env
// if dotenv hasn't been loaded first.
//
// "dotenv/config" is a side-effect import that calls dotenv.config() during
// module evaluation — before any subsequent imports are processed.
// =============================================================================

import "dotenv/config";

import { validateEnvironment } from "./config/prisma";
import { prisma, closeDatabasePool } from "./config/prisma";
import { logger } from "./config/logger";
import app from "./app";
import { beginShutdown } from "./controllers/health.controller";
import { ConfigurationEngine } from "./engines/configuration.engine";
import { printQueue } from "./engines/label/queue/printQueue";
import { registerNotificationSubscribers } from "./events/subscribers/notification.subscriber";
import {
  initializeOfflineRuntime,
  shutdownOfflineRuntime,
} from "./offline/runtime";
import { ensureSystemTemplates } from "./services/labelTemplate.service";

// Validate required environment variables before binding to any port.
// This throws immediately if JWT_SECRET or DATABASE_URL is missing.
validateEnvironment();

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

let server: any;

async function startServer() {
  // 0. Offline-first runtime.
  //    Must come first: on an edge node it opens and verifies the local SQLite
  //    database, which every step below then reads through. A no-op unless
  //    OFFLINE_MODE_ENABLED is set.
  await initializeOfflineRuntime();

  // 1. Load Enterprise Configuration into memory
  await ConfigurationEngine.init();

  // 2. Register Event Subscribers (Event Bus)
  registerNotificationSubscribers();

  // 3. Label Engine bootstrap.
  //    Seeding is awaited so the first print request always finds its default
  //    templates. Both steps are non-fatal: a POS that cannot print labels must
  //    still take payments, so a failure here degrades the Label Engine rather
  //    than preventing the server from starting.
  try {
    await ensureSystemTemplates();
    await printQueue.start();
  } catch (err) {
    logger.error(
      { err },
      "⚠️  Label Engine failed to start. Printing is unavailable; the rest of the API is unaffected."
    );
  }

  // 4. Start HTTP Server
  server = app.listen(PORT, () => {
    logger.info(`🚀 Server running on port ${PORT}`);
    logger.info(`🌍 Environment: ${process.env["NODE_ENV"] ?? "development"}`);
    logger.info(`🔗 Health check: http://localhost:${PORT}/health`);
    logger.info(`🔗 API base:     http://localhost:${PORT}/api/v1`);
  });
}

startServer().catch(err => {
  logger.error({ err }, "❌ Failed to start server");
  process.exit(1);
});

// =============================================================================
// GRACEFUL SHUTDOWN
// On receiving SIGTERM (e.g., from Docker/Kubernetes) or SIGINT (Ctrl+C),
// we stop accepting new connections, wait for in-flight requests to complete,
// then close the Prisma connection pool cleanly.
// =============================================================================

/** Guards against a second signal re-entering an in-progress shutdown. */
let shutdownStarted = false;

/**
 * Time the instance keeps serving traffic after being marked NOT ready, so the
 * load balancer's next readiness probe can take it out of rotation before the
 * socket closes. Must exceed one probe interval — 5s covers the common
 * 2s/3s configurations. Set DRAIN_DELAY_MS=0 in local development for an
 * instant Ctrl+C.
 */
const DRAIN_DELAY_MS = Number.parseInt(
  process.env["DRAIN_DELAY_MS"] ?? (process.env["NODE_ENV"] === "production" ? "5000" : "0"),
  10
);

async function gracefulShutdown(signal: string): Promise<void> {
  if (shutdownStarted) {
    logger.warn(`Received ${signal} during shutdown — already draining.`);
    return;
  }
  shutdownStarted = true;

  logger.info(`⚠️  Received ${signal}. Starting graceful shutdown...`);

  // STEP 1 — fail readiness FIRST, while still serving.
  // `server.close()` stops accepting new connections immediately, but the load
  // balancer does not know that until a probe fails. Closing first means every
  // request the LB routes here during that window is refused — which cashiers
  // see as failed sales on every deploy. Marking not-ready and waiting one
  // probe interval lets the LB drain us cleanly first.
  beginShutdown();
  logger.info("🔻 Readiness probe now failing; draining traffic…");

  if (DRAIN_DELAY_MS > 0) {
    await new Promise((resolve) => setTimeout(resolve, DRAIN_DELAY_MS));
  }

  // Force shutdown if the steps below hang. Started only now, so the drain
  // delay does not consume the close budget.
  const forceExit = setTimeout(() => {
    logger.error("❌ Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 10_000);
  // Do not let this timer alone hold the event loop open.
  forceExit.unref();

  server.close(async () => {
    logger.info("✅ HTTP server closed.");

    try {
      // Stop the print worker BEFORE closing the DB pool: it finishes the label
      // it is on, then stops claiming new ones. Disconnecting first would fail
      // the in-flight job's status write and leave it stuck in PRINTING.
      await printQueue.stop();
      logger.info("✅ Print queue stopped.");

      // Stop sync work before closing databases, for the same reason as the
      // print queue: an in-flight upload batch must be allowed to finish
      // marking its items, or they would be re-sent on the next run.
      await shutdownOfflineRuntime();

      await prisma.$disconnect();
      // Prisma does not end a pool it did not create, and this app hands it an
      // instrumented one. Without this the process would hold Neon connection
      // slots that the incoming instance needs during a rolling deploy.
      await closeDatabasePool();
      logger.info("✅ Database connection closed.");
    } catch (err) {
      logger.error({ err }, "Error during shutdown cleanup");
    }

    clearTimeout(forceExit);
    process.exit(0);
  });
}

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch(console.error);
});

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").catch((err) => logger.error(err));
});

// Handle unhandled promise rejections.
//
// The process is in an unknown state and must not keep serving, but it is
// exited through the SAME graceful path as a deploy rather than with an
// immediate `process.exit(1)`. The old behavior killed the process
// mid-statement: any checkout in flight lost its response, and because a sale
// is written in an interactive transaction, the client was left unable to tell
// whether the sale committed. Draining lets in-flight requests answer.
process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ reason }, "❌ Unhandled Promise Rejection — shutting down");
  gracefulShutdown("unhandledRejection").catch(() => process.exit(1));
});

// Handle uncaught synchronous exceptions.
//
// This one exits IMMEDIATELY and deliberately. After an uncaught exception the
// interpreter state is genuinely untrustworthy — unlike a rejected promise,
// which is usually one broken operation — so running further code, including a
// graceful shutdown that writes to the database, risks corrupting data rather
// than protecting it. Fail fast and let the orchestrator restart us.
process.on("uncaughtException", (error: Error) => {
  logger.error({ err: error }, "❌ Uncaught Exception");
  process.exit(1);
});