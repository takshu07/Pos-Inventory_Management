// =============================================================================
// LOGGER
// Structured JSON logging via Pino.
//
// Why Pino over Winston?
// - Pino is 5x faster than Winston in benchmarks (async log serialization)
// - Native JSON output pairs perfectly with cloud log aggregators (Datadog,
//   CloudWatch, Loki) without additional transformers
// - `pino-pretty` is used ONLY in development for human-readable output;
//   production always emits raw JSON to stdout
//
// Usage:
//   import { logger } from '../config/logger'
//   logger.info({ userId: 'x' }, 'User logged in')
//   logger.error({ err }, 'Unhandled error')
// =============================================================================

import pino from "pino";

const isDevelopment = process.env["NODE_ENV"] !== "production";

export const logger = pino({
  level: process.env["LOG_LEVEL"] ?? (isDevelopment ? "debug" : "info"),

  // In development, use pino-pretty for readable, colorized output.
  // In production, emit raw JSON — log aggregators parse JSON natively.
  // The transport property is conditionally spread to satisfy
  // exactOptionalPropertyTypes — it must be absent, not undefined.
  ...(isDevelopment && {
    transport: {
      target: "pino-pretty",
      options: {
        colorize: true,
        translateTime: "SYS:yyyy-mm-dd HH:MM:ss",
        ignore: "pid,hostname",
      },
    },
  }),

  // Base fields added to every log line
  base: {
    env: process.env["NODE_ENV"] ?? "development",
    service: "cex-pos-server",
  },

  // Redact sensitive fields from all log output
  redact: {
    paths: [
      "*.password",
      "*.hashedPassword",
      "*.token",
      "*.authorization",
      'req.headers["authorization"]',
    ],
    censor: "[REDACTED]",
  },

  // Use ISO timestamps for precise, parseable timestamps
  timestamp: pino.stdTimeFunctions.isoTime,
});
