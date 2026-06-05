import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getCustomerLedger } from "../services/ledgerService.js";

export const ledgerRouter = Router();

ledgerRouter.get("/customers/:customerId", requirePermission("ledger.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const customerId = Array.isArray(req.params.customerId) ? req.params.customerId[0] : req.params.customerId;
  try {
    res.json(await getCustomerLedger(tenantId, customerId));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to fetch ledger" });
  }
});
