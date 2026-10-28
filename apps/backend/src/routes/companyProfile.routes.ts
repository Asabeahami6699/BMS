import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getCompanyProfile, updateCompanyProfile } from "../services/tenantProfileService.js";

export const companyProfileRouter = Router();

function tenantIdOrReject(req: import("express").Request, res: import("express").Response): string | null {
  const tenantId = req.userContext?.tenantId;
  if (!tenantId || tenantId === "platform") {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return tenantId;
}

companyProfileRouter.get("/", async (req, res) => {
  const tenantId = tenantIdOrReject(req, res);
  if (!tenantId) {
    return;
  }
  try {
    res.json(await getCompanyProfile(tenantId));
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load company profile"
    });
  }
});

companyProfileRouter.put("/", requirePermission("users.update"), async (req, res) => {
  const tenantId = tenantIdOrReject(req, res);
  if (!tenantId) {
    return;
  }
  try {
    res.json(await updateCompanyProfile(tenantId, req.body));
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to save company profile"
    });
  }
});
