import { Router, type Request } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { resolveRequestBranchFilter } from "../middleware/branchScope.js";
import {
  createInvestmentApplication,
  createInvestmentProduct,
  getInvestmentDetail,
  getInvestmentFormConfig,
  getInvestmentReports,
  getInvestmentsBootstrap,
  listInvestmentAudit,
  listInvestmentProducts,
  processMaturedInvestments,
  setInvestmentStatus,
  updateInvestmentApplication,
  updateInvestmentFormConfig,
  updateInvestmentProduct
} from "../services/investmentService.js";

export const investmentsRouter = Router();

function actorFromReq(req: Request) {
  const ctx = req.userContext!;
  return {
    tenantId: ctx.tenantId,
    userId: ctx.userId,
    role: ctx.role,
    branchId: ctx.branchId
  };
}

investmentsRouter.get("/bootstrap", requirePermission("investments.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json(await getInvestmentsBootstrap(tenantId, resolveRequestBranchFilter(req)));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load investments" });
  }
});

investmentsRouter.get("/form-config", requirePermission("investments.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json({ formConfig: await getInvestmentFormConfig(tenantId) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load form config" });
  }
});

investmentsRouter.put("/form-config", requirePermission("investments.forms.manage"), async (req, res) => {
  try {
    const formConfig = await updateInvestmentFormConfig(actorFromReq(req).tenantId, actorFromReq(req), req.body);
    res.json({ formConfig });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to save form config" });
  }
});

investmentsRouter.get("/products", requirePermission("investments.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    res.json({ products: await listInvestmentProducts(tenantId) });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list products" });
  }
});

investmentsRouter.post("/products", requirePermission("investments.products.manage"), async (req, res) => {
  try {
    const product = await createInvestmentProduct(actorFromReq(req).tenantId, req.body);
    res.status(201).json({ product });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create product" });
  }
});

investmentsRouter.patch("/products/:productId", requirePermission("investments.products.manage"), async (req, res) => {
  try {
    const product = await updateInvestmentProduct(
      actorFromReq(req).tenantId,
      String(req.params.productId),
      req.body
    );
    res.json({ product });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update product" });
  }
});

investmentsRouter.get("/applications", requirePermission("investments.read"), async (req, res) => {
  try {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const { listInvestments } = await import("../services/investmentService.js");
    res.json({
      investments: await listInvestments(tenantId, req.query, resolveRequestBranchFilter(req))
    });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list investments" });
  }
});

investmentsRouter.get("/applications/:investmentId", requirePermission("investments.read"), async (req, res) => {
  try {
    const investment = await getInvestmentDetail(
      actorFromReq(req).tenantId,
      String(req.params.investmentId)
    );
    if (!investment) {
      res.status(404).json({ error: "Investment not found" });
      return;
    }
    res.json({ investment });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load investment" });
  }
});

investmentsRouter.post("/applications", requirePermission("investments.applications.create"), async (req, res) => {
  try {
    const investment = await createInvestmentApplication(actorFromReq(req), req.body);
    res.status(201).json({ investment });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create investment" });
  }
});

investmentsRouter.patch(
  "/applications/:investmentId",
  requirePermission("investments.applications.create"),
  async (req, res) => {
    try {
      const investment = await updateInvestmentApplication(
        actorFromReq(req),
        String(req.params.investmentId),
        req.body
      );
      res.json({ investment });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update investment" });
    }
  }
);

investmentsRouter.post(
  "/applications/:investmentId/redeem",
  requirePermission("investments.redeem"),
  async (req, res) => {
    try {
      const investment = await setInvestmentStatus(
        actorFromReq(req),
        String(req.params.investmentId),
        "redeemed",
        "redeemed"
      );
      res.json({ investment });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to redeem investment" });
    }
  }
);

investmentsRouter.post(
  "/applications/:investmentId/close",
  requirePermission("investments.redeem"),
  async (req, res) => {
    try {
      const investment = await setInvestmentStatus(
        actorFromReq(req),
        String(req.params.investmentId),
        "closed",
        "closed"
      );
      res.json({ investment });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to close investment" });
    }
  }
);

investmentsRouter.post(
  "/applications/:investmentId/cancel",
  requirePermission("investments.redeem"),
  async (req, res) => {
    try {
      const investment = await setInvestmentStatus(
        actorFromReq(req),
        String(req.params.investmentId),
        "cancelled",
        "cancelled"
      );
      res.json({ investment });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to cancel investment" });
    }
  }
);

investmentsRouter.get(
  "/applications/:investmentId/audit",
  requirePermission("investments.read"),
  async (req, res) => {
    try {
      res.json({
        events: await listInvestmentAudit(actorFromReq(req).tenantId, String(req.params.investmentId))
      });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load audit trail" });
    }
  }
);

investmentsRouter.get("/reports", requirePermission("investments.reports.read"), async (req, res) => {
  try {
    res.json(await getInvestmentReports(actorFromReq(req).tenantId, resolveRequestBranchFilter(req)));
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to load reports" });
  }
});

investmentsRouter.post("/process-maturities", requirePermission("investments.applications.approve"), async (req, res) => {
  try {
    const renewed = await processMaturedInvestments(actorFromReq(req));
    res.json({ renewed });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to process maturities" });
  }
});
