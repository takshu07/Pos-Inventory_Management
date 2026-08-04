import { Router } from "express";
import * as healthController from "../controllers/health.controller";

const router = Router();

// /health/live - for Docker / K8s liveness probes
router.get("/live", healthController.getLiveness);

// /health/ready - for Load Balancers (AWS ALB, NGINX) to route traffic
router.get("/ready", healthController.getReadiness);

// /health/metrics - per-route latency percentiles and error rates for this
// process. See the controller for why this is unauthenticated.
router.get("/metrics", healthController.getMetrics);

// /health - legacy or detailed full-system check
router.get("/", healthController.getDetailedHealth);

export default router;
