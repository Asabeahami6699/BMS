import {
  SITE_MANUAL_ARTICLES,
  SITE_MANUAL_DEPARTMENTS,
  canUseSusuLoanBridge,
  filterSiteManualArticles,
  type TenantProductModule
} from "@bms/shared";
import { Router } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { getSusuLoanBridgeEnabled } from "../services/tenantProfileService.js";
import { loadTenantModules } from "../services/tenantModuleService.js";

export const siteManualRouter = Router();

siteManualRouter.get(
  "/",
  requirePermission("workspace.manual.read"),
  async (req, res) => {

  const tenantId = req.userContext?.tenantId;
  if (!tenantId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const [modules, bridgeEnabled] = await Promise.all([
      loadTenantModules(tenantId),
      getSusuLoanBridgeEnabled(tenantId)
    ]);
    const productModules = modules as TenantProductModule[];
    const bridgeActive = canUseSusuLoanBridge(productModules, bridgeEnabled);
    const query = typeof req.query.q === "string" ? req.query.q : undefined;
    const articles = filterSiteManualArticles({
      modules: productModules,
      bridgeActive,
      query
    });
    res.json({
      departments: SITE_MANUAL_DEPARTMENTS,
      articles,
      total: SITE_MANUAL_ARTICLES.length,
      bridgeActive,
      modules: productModules
    });
  } catch (error) {
    res.status(400).json({
      error: error instanceof Error ? error.message : "Failed to load site manual"
    });
  }
  }
);
