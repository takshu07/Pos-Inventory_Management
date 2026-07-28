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
import { prisma } from "./config/prisma";
import { logger } from "./config/logger";
import app from "./app";
import { ConfigurationEngine } from "./engines/configuration.engine";
import { printQueue } from "./engines/label/queue/printQueue";
import { registerNotificationSubscribers } from "./events/subscribers/notification.subscriber";
import { ensureSystemTemplates } from "./services/labelTemplate.service";

// Validate required environment variables before binding to any port.
// This throws immediately if JWT_SECRET or DATABASE_URL is missing.
validateEnvironment();

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);

let server: any;

async function startServer() {
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

async function gracefulShutdown(signal: string): Promise<void> {
  console.log(`\n⚠️  Received ${signal}. Starting graceful shutdown...`);
// restart 2

  server.close(async () => {
    logger.info("✅ HTTP server closed.");

    // Stop the print worker BEFORE closing the DB pool: it finishes the label
    // it is on, then stops claiming new ones. Disconnecting first would fail
    // the in-flight job's status write and leave it stuck in PRINTING.
    await printQueue.stop();
    logger.info("✅ Print queue stopped.");

    await prisma.$disconnect();
    logger.info("✅ Database connection closed.");

    process.exit(0);
  });

  // Force shutdown after 10 seconds if graceful shutdown hangs
  setTimeout(() => {
    logger.error("❌ Graceful shutdown timed out. Forcing exit.");
    process.exit(1);
  }, 10_000);
}

process.on("SIGTERM", () => {
  gracefulShutdown("SIGTERM").catch(console.error);
});

process.on("SIGINT", () => {
  gracefulShutdown("SIGINT").catch((err) => logger.error(err));
});

// Handle unhandled promise rejections — log and exit.
// A process running with unhandled rejections is in an unknown state.
process.on("unhandledRejection", (reason: unknown) => {
  logger.error({ reason }, "❌ Unhandled Promise Rejection");
  process.exit(1);
});

// Handle uncaught synchronous exceptions.
process.on("uncaughtException", (error: Error) => {
  logger.error({ err: error }, "❌ Uncaught Exception");
  process.exit(1);
});