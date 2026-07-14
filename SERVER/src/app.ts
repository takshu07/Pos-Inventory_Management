// =============================================================================
// EXPRESS APPLICATION SETUP
//
// Middleware registration order matters in Express:
//   1. Trust proxy   — must be first so rate limiters read the real client IP
//   2. Security headers (Helmet) — must be before CORS
//   3. Global rate limiter — applied to all routes before any route logic
//   4. CORS — before any route handlers
//   5. Body parsers — before routes that read req.body
//   6. Request logger — after parsers so we can log body size
//   7. Routes — after all request-processing middleware
//   8. 404 handler — after all route registrations
//   9. Global error handler — LAST
//
// Route prefixes use /api/v1 namespace:
//   - /api/v1/auth      — Authentication
//   - /api/v1/employees — Employee management
//   Future modules will follow the same convention.
//
// The corsOptions.origin whitelist reads from the environment variable
// ALLOWED_ORIGINS (comma-separated). Falls back to localhost:5173 (Vite dev)
// so development works out-of-the-box without configuration.
// =============================================================================

import cors from "cors";
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";

import { logger } from "./config/logger";
import { errorHandler } from "./middleware/error.middleware";
import { globalLimiter } from "./middleware/rateLimit.middleware";
import authRoutes from "./routes/auth.routes";
import brandRoutes from "./routes/brand.routes";
import categoryRoutes from "./routes/category.routes";
import customerRoutes from "./routes/customer.routes";
import employeeRoutes from "./routes/employee.routes";
import exchangeRoutes from "./routes/exchange.routes";
import inventoryMovementRoutes from "./routes/inventoryMovement.routes";
import productRoutes from "./routes/product.routes";
import productVariantRoutes from "./routes/productVariant.routes";
import purchaseRoutes from "./routes/purchase.routes";
import saleRoutes from "./routes/sale.routes";
import supplierRoutes from "./routes/supplier.routes";
import analyticsRoutes from "./routes/analytics.routes";
import configurationRoutes from "./routes/configuration.routes";
import notificationRoutes from "./routes/notification.routes";
import financeRoutes from "./routes/finance.routes";
import assetRoutes from "./routes/asset.routes";
import healthRoutes from "./routes/health.routes";
import crypto from "crypto";

const app = express();

// =============================================================================
// TRUST PROXY
// When behind a reverse proxy (Nginx, Cloudflare, AWS ALB), Express would see
// the proxy's IP as the client IP. Setting trust proxy tells Express to read
// the real client IP from the X-Forwarded-For header.
// Required for express-rate-limit to key correctly on client IPs.
// =============================================================================
app.set("trust proxy", 1);

// =============================================================================
// SECURITY HEADERS
// Helmet sets ~15 HTTP headers that protect against common web vulnerabilities
// (XSS, clickjacking, MIME sniffing, etc.).
// =============================================================================

app.use(helmet());

// =============================================================================
// GLOBAL RATE LIMITER
// Coarse-grained protection applied to ALL routes.
// Per-route limiters (e.g., authLimiter) are applied on specific endpoints.
// =============================================================================

app.use(globalLimiter);

// =============================================================================
// CORS
// Restrict cross-origin requests to known frontend origins.
// =============================================================================

const allowedOrigins = process.env["ALLOWED_ORIGINS"]
  ? process.env["ALLOWED_ORIGINS"].split(",").map((origin) => origin.trim())
  : ["http://localhost:5173", "http://localhost:5174", "http://localhost:5175"];

const corsOptions: cors.CorsOptions = {
  origin: (requestOrigin, callback) => {
    // Allow server-to-server requests (no origin header) and whitelisted origins
    if (!requestOrigin || allowedOrigins.includes(requestOrigin)) {
      callback(null, true);
    } else {
      callback(new Error(`CORS: Origin ${requestOrigin} is not allowed.`));
    }
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "Idempotency-Key"],
};

app.use(cors(corsOptions));

// =============================================================================
// BODY PARSER
// Limit payload size to 10mb to prevent denial-of-service via large payloads.
// =============================================================================

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

// =============================================================================
// REQUEST LOGGER
// Structured HTTP access logging via Pino. Logs method, url, status, and
// response time for every request. Excludes the /health endpoint to avoid
// noise from uptime monitoring.
// =============================================================================

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/health")) return next(); // Exclude health endpoints from logs

  const reqId = crypto.randomUUID();
  res.setHeader("X-Request-Id", reqId);

  const start = Date.now();

  res.on("finish", () => {
    const duration = Date.now() - start;
    const logFn = res.statusCode >= 500
      ? logger.error.bind(logger)
      : res.statusCode >= 400
        ? logger.warn.bind(logger)
        : logger.info.bind(logger);

    logFn(
      {
        reqId,
        method: req.method,
        url: req.originalUrl,
        status: res.statusCode,
        durationMs: duration,
        ip: req.ip,
      },
      "HTTP request"
    );
  });

  next();
});

// =============================================================================
// HEALTH & LIVENESS PROBES
// =============================================================================

app.use("/health", healthRoutes);

// =============================================================================
// API ROUTES
// All routes are versioned under /api/v1.
// =============================================================================

app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/customers", customerRoutes);
app.use("/api/v1/employees", employeeRoutes);
app.use("/api/v1/categories", categoryRoutes);
app.use("/api/v1/brands", brandRoutes);
app.use("/api/v1/suppliers", supplierRoutes);
app.use("/api/v1/products", productRoutes);
app.use("/api/v1/product-variants", productVariantRoutes);
app.use("/api/v1/inventory-movements", inventoryMovementRoutes);
app.use("/api/v1/exchanges", exchangeRoutes);
app.use("/api/v1/purchases", purchaseRoutes);
app.use("/api/v1/sales", saleRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/configuration", configurationRoutes);
app.use("/api/v1/notifications", notificationRoutes);
app.use("/api/v1/finance", financeRoutes);
app.use("/api/v1/assets", assetRoutes);

// =============================================================================
// 404 HANDLER
// Catches any request that didn't match a registered route.
// Must be after all route registrations but before the error handler.
// =============================================================================

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    message: "The requested endpoint does not exist.",
  });
});

// =============================================================================
// GLOBAL ERROR HANDLER
// Must be the LAST middleware registered. Express identifies it by the
// 4-argument signature (err, req, res, next).
// =============================================================================

app.use(errorHandler);

export default app;