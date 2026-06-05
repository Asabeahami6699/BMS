import { updateBranchSchema } from "@bms/shared";
import { Router } from "express";
import { z } from "zod";
import { requirePermission } from "../middleware/requirePermission.js";
import { createBranch, deleteBranch, listBranches, updateBranch } from "../services/branchService.js";

export const branchesRouter = Router();

const createBranchSchema = z.object({
  id: z.string().uuid().optional(),
  code: z.string().min(1),
  name: z.string().min(1)
});

branchesRouter.get("/", requirePermission("branches.read"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const branches = await listBranches(tenantId);
    res.json(branches);
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Failed to list branches" });
  }
});

branchesRouter.post("/", requirePermission("branches.create"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = createBranchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid branch payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const branch = await createBranch(tenantId, parsed.data);
    res.status(201).json(branch);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to create branch" });
  }
});

branchesRouter.patch("/:branchId", requirePermission("branches.update"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = updateBranchSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid branch update payload", details: parsed.error.flatten() });
    return;
  }

  try {
    const branchId = Array.isArray(req.params.branchId) ? req.params.branchId[0] : req.params.branchId;
    const branch = await updateBranch(tenantId, branchId, parsed.data);
    res.json(branch);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to update branch" });
  }
});

branchesRouter.delete("/:branchId", requirePermission("branches.delete"), async (req, res) => {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const branchId = Array.isArray(req.params.branchId) ? req.params.branchId[0] : req.params.branchId;
    await deleteBranch(tenantId, branchId);
    res.status(204).send();
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Failed to delete branch" });
  }
});
