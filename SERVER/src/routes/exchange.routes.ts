import { Router } from "express";
import { exchangeController } from "../controllers/exchange.controller";
import { authenticate } from "../middleware/auth.middleware";
import { requireRole } from "../middleware/role.middleware";
import { validateParam } from "../middleware/validateParam.middleware";

const router = Router();

router.use(authenticate);

// Cashiers can read and create exchanges
router.get("/", requireRole("CASHIER"), exchangeController.getExchanges);
router.post("/", requireRole("CASHIER"), exchangeController.createExchange);
router.get("/:id", validateParam("id"), requireRole("CASHIER"), exchangeController.getExchangeById);

export default router;
