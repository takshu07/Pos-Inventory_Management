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

import compression from "compression";
import cors from "cors";
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";

import { logger } from "./config/logger";
import {
  runWithRequestContext,
  type RequestContext,
} from "./config/requestContext";
import { errorHandler } from "./middleware/error.middleware";
import { exportLimiter, globalLimiter } from "./middleware/rateLimit.middleware";
import { recordRequest } from "./utils/metrics";
import authRoutes from "./routes/auth.routes";
import brandRoutes from "./routes/brand.routes";
import categoryRoutes from "./routes/category.routes";
import customerRoutes from "./routes/customer.routes";
import employeeRoutes from "./routes/employee.routes";
import exchangeRoutes from "./routes/exchange.routes";
import inventoryMovementRoutes from "./routes/inventoryMovement.routes";
import ownerInventoryRoutes from "./routes/owner.inventory.routes";
import managerInventoryRoutes from "./routes/manager.inventory.routes";
import cashierInventoryRoutes from "./routes/cashier.inventory.routes";
import productRoutes from "./routes/product.routes";
import ownerProductRoutes from "./routes/owner.products.routes";
import managerProductRoutes from "./routes/manager.products.routes";
import ownerCategoryRoutes from "./routes/owner.categories.routes";
import managerCategoryRoutes from "./routes/manager.categories.routes";
import ownerDiscountRoutes from "./routes/owner.discounts.routes";
import pricingRoutes from "./routes/pricing.routes";
import productVariantRoutes from "./routes/productVariant.routes";
import purchaseRoutes from "./routes/purchase.routes";
import saleRoutes from "./routes/sale.routes";
import supplierRoutes from "./routes/supplier.routes";
import analyticsRoutes from "./routes/analytics.routes";
import configurationRoutes from "./routes/configuration.routes";
import notificationRoutes from "./routes/notification.routes";
import financeRoutes from "./routes/finance.routes";
import registerRoutes from "./routes/register.routes";
import reportsRoutes from "./routes/reports.routes";
import assetRoutes from "./routes/asset.routes";
import labelRoutes from "./routes/label.routes";
import ownerLabelRoutes from "./routes/owner.labels.routes";
import ownerWorkforceRoutes from "./routes/owner.workforce.routes";
import ownerAuditRoutes from "./routes/owner.audit.routes";
import managerWorkforceRoutes from "./routes/manager.workforce.routes";
import healthRoutes from "./routes/health.routes";
import syncRoutes, { isSignedSyncPath, SYNC_MOUNT_PATH } from "./offline/api/sync.routes";
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
// RESPONSE COMPRESSION
// gzip large JSON responses (sales history, analytics, product/variant lists)
// before they hit the wire. Only bodies above `threshold` are compressed — for
// tiny payloads the CPU cost outweighs the byte savings. Clients that send a
// `x-no-compression` header (or don't advertise gzip) are served uncompressed.
// This must run before the routes so their responses pass through it.
// =============================================================================

app.use(
  compression({
    threshold: 1024, // only compress responses larger than 1KB
    filter: (req, res) => {
      // Allow an explicit opt-out for debugging/streaming.
      if (req.headers["x-no-compression"]) return false;
      return compression.filter(req, res);
    },
  })
);

// =============================================================================
// GLOBAL RATE LIMITER
// Coarse-grained protection applied to ALL routes.
// Per-route limiters (e.g., authLimiter) are applied on specific endpoints.
// =============================================================================

app.use(globalLimiter);

// =============================================================================
// EXPORT RATE LIMITER
// Applied by PATH rather than per-route because export endpoints are spread
// across twelve routers (reports, finance, inventory x3, workforce x2,
// register x4, categories, products). Matching here covers all of them from one
// place — and covers any export route added later, which per-route wiring would
// silently miss. See exportLimiter for why these need a tighter budget than the
// global one.
// =============================================================================

const EXPORT_PATH = /\/export(\/|$)/;

app.use((req: Request, res: Response, next: NextFunction) => {
  if (EXPORT_PATH.test(req.path)) {
    return exportLimiter(req, res, next);
  }
  return next();
});

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
//
// The machine-to-machine sync endpoints are DELIBERATELY excluded. They are
// authenticated by an HMAC signature computed over the exact bytes the edge
// node serialized, so their router installs its own parser with a `verify`
// hook that keeps those raw bytes. A parser here would drain the stream first,
// that hook would never run, and the verifier would end up hashing "" for
// every upload — rejecting all of them with a 401 that looks like a bad
// credential rather than a body that was consumed too early.
// =============================================================================

const skipForSignedSyncRoutes =
  (parser: express.RequestHandler): express.RequestHandler =>
  (req, res, next) => {
    if (isSignedSyncPath(req.path)) {
      next();
      return;
    }
    parser(req, res, next);
  };

app.use(skipForSignedSyncRoutes(express.json({ limit: "10mb" })));
app.use(skipForSignedSyncRoutes(express.urlencoded({ extended: true, limit: "10mb" })));

// =============================================================================
// REQUEST LOGGER + OBSERVABILITY CONTEXT
//
// Three things happen here, in this order, for every non-health request:
//
//   1. A correlation id is minted and returned as `X-Request-Id`, so a user
//      reporting a failure can be matched to the exact log lines that explain
//      it. The client surfaces this id on its error screen.
//   2. The rest of the request runs INSIDE an AsyncLocalStorage context
//      (`runWithRequestContext`). Everything downstream — services, engines,
//      repositories, the slow-query logger and the global error handler — can
//      read that id without it being threaded through their signatures.
//      `next()` must be called inside the callback, or the context is lost for
//      every handler that follows.
//   3. On finish, the request is recorded into the in-process metrics rollup
//      exposed at `GET /health/metrics`.
//
// Health endpoints stay excluded: an uptime monitor hitting /health/live every
// few seconds would otherwise dominate both the log volume and the metrics.
// =============================================================================

app.use((req: Request, res: Response, next: NextFunction) => {
  if (req.path.startsWith("/health")) return next(); // Exclude health endpoints from logs

  const reqId = crypto.randomUUID();
  res.setHeader("X-Request-Id", reqId);

  const start = Date.now();

  const context: RequestContext = {
    reqId,
    method: req.method,
    path: req.path,
    dbQueryCount: 0,
    dbTimeMs: 0,
  };

  runWithRequestContext(context, () => {
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
          // Actor, when the request authenticated. Lets the log be filtered by
          // who was affected, not just by which endpoint failed.
          ...(context.userId !== undefined && { userId: context.userId }),
          ...(context.role !== undefined && { role: context.role }),
          // Database cost of this request. `dbQueryCount` is the direct signal
          // for an N+1: a list endpoint issuing one query per row shows here as
          // a count that scales with page size.
          dbQueryCount: context.dbQueryCount,
          dbTimeMs: Math.round(context.dbTimeMs),
        },
        "HTTP request"
      );

      recordRequest(req.method, req.path, res.statusCode, duration);
    });

    next();
  });
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
// Role-scoped product modules (independently routed + independently authorized).
// owner/products = full CRUD (OWNER only); manager/products = read-only catalog.
app.use("/api/v1/owner/products", ownerProductRoutes);
app.use("/api/v1/manager/products", managerProductRoutes);
// Role-scoped category modules. owner/categories = full administration incl.
// analytics, discounts, bulk ops and export (OWNER only); manager/categories =
// read-only, and deliberately WITHOUT the analytics endpoints.
app.use("/api/v1/owner/categories", ownerCategoryRoutes);
app.use("/api/v1/manager/categories", managerCategoryRoutes);
// Catalog discount administration (OWNER-only) and the shared read-only
// effective-pricing surface (MANAGER+OWNER).
app.use("/api/v1/owner/discounts", ownerDiscountRoutes);
app.use("/api/v1/pricing", pricingRoutes);
app.use("/api/v1/product-variants", productVariantRoutes);
app.use("/api/v1/inventory-movements", inventoryMovementRoutes);
app.use("/api/v1/exchanges", exchangeRoutes);
app.use("/api/v1/purchases", purchaseRoutes);
app.use("/api/v1/sales", saleRoutes);
app.use("/api/v1/analytics", analyticsRoutes);
app.use("/api/v1/configuration", configurationRoutes);
app.use("/api/v1/notifications", notificationRoutes);
// ── Finance, Cash Register & Reporting ──────────────────────────────────────
// Three trees with deliberately different reach:
//   /register  OPERATIONAL — every authenticated role. A cashier must be able
//              to open their own drawer, or they cannot sell at all. Which
//              SESSIONS an actor may touch is a per-row decision the service
//              makes, not something a route guard can express.
//   /finance   OWNER-only. Revenue, margins, payroll and supplier balances are
//              the business's private financials.
//   /reports   OWNER-only, except global search, which managers need for
//              day-to-day invoice and customer lookup.
app.use("/api/v1/register", registerRoutes);
app.use("/api/v1/finance", financeRoutes);
app.use("/api/v1/reports", reportsRoutes);
app.use("/api/v1/assets", assetRoutes);
// Label Management & Printing Engine. /labels is the operational surface every
// role uses (preview, print, queue); /owner/labels is administration
// (templates, printers, settings, history) and is OWNER-only.
app.use("/api/v1/labels", labelRoutes);
app.use("/api/v1/owner/labels", ownerLabelRoutes);
// Workforce Management ("Employee Activity"). Same role-scoped split as the
// product and category modules: /owner/workforce is the full surface including
// every mutation (OWNER only); /manager/workforce is read-only monitoring plus
// the manager's own clock in/out. The manager tree registers no mutation
// routes at all, so the read-only guarantee is structural, not just guarded.
app.use("/api/v1/owner/workforce", ownerWorkforceRoutes);
app.use("/api/v1/manager/workforce", managerWorkforceRoutes);
// Audit trail. READ-ONLY and OWNER-only — there is no manager counterpart by
// design, and no write routes exist because entries are written by the module
// that performed the action, never through the API.
app.use("/api/v1/owner/audit-logs", ownerAuditRoutes);
// Offline-first synchronization. Two authentication regimes on one tree:
// /sync/download and /sync/upload are machine-to-machine and authenticated by
// HMAC device signature (an edge node syncs at 2am with nobody logged in);
// everything else is the operator surface behind the normal JWT + RBAC. Inert
// unless OFFLINE_MODE_ENABLED is set.
app.use(SYNC_MOUNT_PATH, syncRoutes);

// ── Inventory ───────────────────────────────────────────────────────────────
// Three trees, one controller. /owner/inventory is the full surface including
// every stock mutation; /manager/inventory is operational (count, request,
// reserve) with cost stripped; /inventory is the baseline read a cashier uses
// at the till. The mutating routes are ABSENT from the narrower trees rather
// than merely guarded, and the service enforces the same split independently.
//
// Stock itself is written in exactly one place — executeMovement() — which is
// what makes this module a ledger rather than a stock column with opinions.
app.use("/api/v1/owner/inventory", ownerInventoryRoutes);
app.use("/api/v1/manager/inventory", managerInventoryRoutes);
app.use("/api/v1/inventory", cashierInventoryRoutes);

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