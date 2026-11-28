import { Router } from "express";
import {
  incomeReportPeriodSchema,
  reverseInstitutionalIncomeCapitalTransferSchema,
  reverseInstitutionalIncomeSchema,
  transferInstitutionalIncomeToCapitalSchema
} from "@bms/shared";
import { requireAnyPermission, requirePermission } from "../middleware/requirePermission.js";
import { BranchAccessError, resolveRequestBranchFilter } from "../middleware/branchScope.js";
import { validateBody } from "../middleware/validateBody.js";
import { setRequestAuditContext } from "../services/auditService.js";
import {
  getInstitutionalIncomeReport,
  reverseInstitutionalIncome,
  reverseInstitutionalIncomeCapitalTransfer,
  transferInstitutionalIncomeToCapital
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
      setRequestAuditContext(req, {
        entityType: "institutional_income_entry",
        entityId: entry.id,
        after: {
          branchId: entry.branchId,
          amount: entry.amount,
          source: entry.source,
          reversesEntryId: entry.reversesEntryId,
          reversalReason: entry.reversalReason
        }
      });
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

institutionalIncomeRouter.post(
  "/transfer-to-capital",
  requirePermission("income.read"),
  validateBody(transferInstitutionalIncomeToCapitalSchema),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const result = await transferInstitutionalIncomeToCapital(
        {
          userId: context.userId,
          tenantId: context.tenantId,
          role: context.role,
          permissions: context.permissions,
          scopeType: context.scopeType,
          branchId: context.branchId
        },
        req.body,
        { subscribedModules: context.subscribedModules }
      );
      setRequestAuditContext(req, {
        entityType: "institutional_income_capital_transfer",
        entityId: result.transfer.id,
        before: {
          branchId: result.transfer.branchId,
          incomeAccountId: result.transfer.incomeAccountId,
          availableBalance: result.previousBalance
        },
        after: {
          branchId: result.transfer.branchId,
          incomeAccountId: result.transfer.incomeAccountId,
          availableBalance: result.newBalance,
          capitalEntryId: result.transfer.capitalEntryId,
          amount: result.transfer.amount,
          reference: result.transfer.reference,
          businessDate: result.transfer.businessDate
        },
        metadata: {
          branchId: result.transfer.branchId,
          idempotent: result.idempotent,
          idempotencyKey: result.transfer.idempotencyKey,
          notes: result.transfer.notes ?? null
        }
      });
      res.status(result.idempotent ? 200 : 201).json(result);
    } catch (error) {
      if (error instanceof BranchAccessError) {
        res.status(403).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message) {
        const status = /only authorized|cannot transfer.*another branch/i.test(error.message)
          ? 403
          : 400;
        res.status(status).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);

institutionalIncomeRouter.post(
  "/capital-transfers/:transferId/reverse",
  requirePermission("income.read"),
  validateBody(reverseInstitutionalIncomeCapitalTransferSchema),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const transferId = String(req.params.transferId ?? "").trim();
      const result = await reverseInstitutionalIncomeCapitalTransfer(
        {
          userId: context.userId,
          tenantId: context.tenantId,
          role: context.role,
          permissions: context.permissions,
          scopeType: context.scopeType,
          branchId: context.branchId
        },
        transferId,
        req.body
      );
      setRequestAuditContext(req, {
        entityType: "institutional_income_capital_transfer",
        entityId: result.transfer.id,
        before: {
          branchId: result.transfer.branchId,
          incomeAccountId: result.transfer.incomeAccountId,
          availableBalance: result.previousBalance,
          reversedAt: null
        },
        after: {
          branchId: result.transfer.branchId,
          incomeAccountId: result.transfer.incomeAccountId,
          availableBalance: result.newBalance,
          capitalEntryId: result.transfer.capitalEntryId,
          reversedAt: result.transfer.reversedAt,
          reversalReason: result.transfer.reversalReason
        },
        metadata: {
          branchId: result.transfer.branchId,
          reference: result.transfer.reference,
          amount: result.transfer.amount
        }
      });
      res.status(200).json(result);
    } catch (error) {
      if (error instanceof BranchAccessError) {
        res.status(403).json({ error: error.message });
        return;
      }
      if (error instanceof Error && error.message) {
        const status = /only authorized|cannot reverse.*another branch/i.test(error.message)
          ? 403
          : 400;
        res.status(status).json({ error: error.message });
        return;
      }
      next(error);
    }
  }
);
