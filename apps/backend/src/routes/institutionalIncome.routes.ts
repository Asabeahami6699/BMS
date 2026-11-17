import { Router } from "express";
import {
  incomeReportPeriodSchema,
  reverseInstitutionalIncomeSchema
} from "@bms/shared";
import { requireAnyPermission, requirePermission } from "../middleware/requirePermission.js";
import { BranchAccessError, resolveRequestBranchFilter } from "../middleware/branchScope.js";
import { validateBody } from "../middleware/validateBody.js";
import {
  getInstitutionalIncomeReport,
  reverseInstitutionalIncome
} from "../services/institutionalIncomeService.js";

export const institutionalIncomeRouter = Router();

institutionalIncomeRouter.get(
  "/report",
  requireAnyPermission("income.read", "income.read.daily"),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const periodRaw = typeof req.query.period === "string" ? req.query.period : "daily";
      const parsedPeriod = incomeReportPeriodSchema.safeParse(periodRaw);
      const period = parsedPeriod.success ? parsedPeriod.data : "daily";
      const branchId = resolveRequestBranchFilter(req);
      const report = await getInstitutionalIncomeReport(
        {
          userId: context.userId,
          tenantId: context.tenantId,
          role: context.role,
          permissions: context.permissions,
          scopeType: context.scopeType,
          branchId: context.branchId
        },
        {
          period,
          branchId: branchId ?? undefined,
          subscribedModules: context.subscribedModules
        }
      );
      res.json(report);
    } catch (error) {
      if (error instanceof BranchAccessError) {
        res.status(403).json({ error: error.message });
        return;
      }
      if (error instanceof Error && /permission/i.test(error.message)) {
        res.status(403).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);

institutionalIncomeRouter.post(
  "/reverse",
  requirePermission("income.read"),
  validateBody(reverseInstitutionalIncomeSchema),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const entry = await reverseInstitutionalIncome(
        {
          userId: context.userId,
          tenantId: context.tenantId,
          role: context.role,
          permissions: context.permissions
        },
        req.body
      );
      res.status(201).json(entry);
    } catch (error) {
      if (error instanceof Error && error.message) {
        res.status(400).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);
