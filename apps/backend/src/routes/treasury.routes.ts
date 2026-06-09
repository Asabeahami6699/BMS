import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { BranchAccessError, resolveRequestBranchFilter } from "../middleware/branchScope.js";
import { validateBody } from "../middleware/validateBody.js";
import { createCashMovementSchema } from "@bms/shared";
import { listBranches } from "../services/branchService.js";
import { createCashMovement, getTreasuryBootstrap } from "../services/treasuryService.js";

export const treasuryRouter = Router();

treasuryRouter.get("/bootstrap", requirePermission("treasury.read"), async (req, res, next) => {
  try {
    const context = req.userContext!;
    const branchId = resolveRequestBranchFilter(req);
    const branches = (await listBranches(context.tenantId)).filter((b) => b.status !== "inactive");

    if (!branchId) {
      const items = await Promise.all(
        branches.map((branch) => getTreasuryBootstrap(context, branch.id, branch.name))
      );
      res.json({
        scope: "all_branches",
        branches: branches.map((branch, index) => ({
          branchId: branch.id,
          branchName: branch.name,
          bootstrap: items[index]
        }))
      });
      return;
    }

    const branch = branches.find((b) => b.id === branchId);
    const bootstrap = await getTreasuryBootstrap(context, branchId, branch?.name ?? "Branch");
    res.json(bootstrap);
  } catch (error) {
    if (error instanceof BranchAccessError) {
      res.status(403).json({ error: error.message });
      return;
    }
    next(error);
  }
});

treasuryRouter.post(
  "/movements",
  requirePermission("treasury.cash.move"),
  validateBody(createCashMovementSchema),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const branchId = req.body.branchId as string;
      const branches = await listBranches(context.tenantId);
      const branch = branches.find((b) => b.id === branchId);
      const bootstrap = await createCashMovement(context, req.body, branch?.name ?? "Branch");
      res.status(201).json(bootstrap);
    } catch (error) {
      if (error instanceof BranchAccessError) {
        res.status(403).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);
