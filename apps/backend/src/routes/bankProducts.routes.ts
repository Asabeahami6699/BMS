import { Router } from "express";
import { createBankProductSchema, updateBankProductSchema } from "@bms/shared";
import { resolveRequestBranchFilter } from "../middleware/branchScope.js";
import { requirePermission } from "../middleware/requirePermission.js";
import { validateBody } from "../middleware/validateBody.js";
import {
  createBankProduct,
  listBankProducts,
  updateBankProduct
} from "../services/bankProductService.js";

export const bankProductsRouter = Router();

bankProductsRouter.get("/", requirePermission("banking.products.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId || tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const direction = req.query.direction;
  const activeOnly = req.query.activeOnly === "true";
  const branchId = resolveRequestBranchFilter(req);

  try {
    const products = await listBankProducts(tenantId, {
      direction:
        direction === "deposit" ||
        direction === "withdrawal" ||
        direction === "account_opening"
          ? direction
          : undefined,
      activeOnly,
      branchId
    });
    res.json({ products });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list bank products"
    });
  }
});

bankProductsRouter.post(
  "/",
  requirePermission("banking.products.manage"),
  validateBody(createBankProductSchema),
  async (req, res) => {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId || tenantId === "platform") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    try {
      const products = await createBankProduct(tenantId, req.body);
      res.status(201).json({ products });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to create bank product"
      });
    }
  }
);

bankProductsRouter.patch(
  "/:productId",
  requirePermission("banking.products.manage"),
  validateBody(updateBankProductSchema),
  async (req, res) => {
    const tenantId = req.userContext?.tenantId;
    if (!tenantId || tenantId === "platform") {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const productId = Array.isArray(req.params.productId)
      ? req.params.productId[0]
      : req.params.productId;

    try {
      const product = await updateBankProduct(tenantId, productId, req.body);
      res.json({ product });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to update bank product"
      });
    }
  }
);
