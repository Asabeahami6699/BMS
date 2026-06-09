import { Router, type Request } from "express";
import { requirePermission } from "../middleware/requirePermission.js";
import { resolveRequestBranchFilter } from "../middleware/branchScope.js";
import {
  executeBankDeposit,
  executeBankWithdrawal,
  getAgencyBootstrap,
  initiateAgencyWithdrawal,
  listTellerAgencyDeposits,
  tellerPayWithdrawal
} from "../services/agencyBankingService.js";
import {
  approveAccountantDeposit,
  approveBackOfficeEcashRequest,
  createBackOfficeEcashRequest,
  executeBackOfficeDeposit,
  getBackOfficeBootstrap,
  openBackOfficeDay,
  updateBackOfficeAccountEntries
} from "../services/backOfficeService.js";
import {
  createPartnerBankAccount,
  findPartnerBankAccountByNumber,
  listPartnerBankAccounts
} from "../services/agencyPartnerAccountService.js";
import { ensureAgencyWalkInCustomer } from "../services/agencyWalkInCustomerService.js";
import { getTellerReconciliationBootstrap } from "../services/tellerReconciliationService.js";
import { resolveBranchId } from "../services/branchService.js";
import {
  createTellerTillJournalEntry,
  listTellerTillJournalEntries
} from "../services/tellerTillJournalService.js";
import type { TransactionRequestContext } from "../services/transactionService.js";

export const agencyRouter = Router();

function toTxContext(context: NonNullable<Request["userContext"]>): TransactionRequestContext {
  return {
    userId: context.userId,
    tenantId: context.tenantId,
    role: context.role,
    scopeType: context.scopeType,
    branchId: context.branchId,
    permissions: context.permissions
  };
}

agencyRouter.get("/bootstrap", requirePermission("transactions.read"), async (req, res, next) => {
  try {
    const context = req.userContext!;
    const bootstrap = await getAgencyBootstrap(
      toTxContext(context),
      resolveRequestBranchFilter(req)
    );
    res.json(bootstrap);
  } catch (error) {
    next(error);
  }
});

agencyRouter.post(
  "/deposits/:transactionId/execute-bank",
  requirePermission("agency.bank.execute"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const transactionId = Array.isArray(req.params.transactionId)
      ? req.params.transactionId[0]
      : req.params.transactionId;
    try {
      const result = await executeBankDeposit(toTxContext(context), transactionId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Bank execution failed" });
    }
  }
);

agencyRouter.post(
  "/withdrawals/:disclosureId/execute-bank",
  requirePermission("agency.bank.execute"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const disclosureId = Array.isArray(req.params.disclosureId)
      ? req.params.disclosureId[0]
      : req.params.disclosureId;
    try {
      const result = await executeBankWithdrawal(toTxContext(context), disclosureId, req.body?.bankProductId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Bank execution failed" });
    }
  }
);

agencyRouter.get(
  "/partner-accounts/lookup",
  requirePermission("agency.deposits.record"),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const accountNumber =
        typeof req.query.accountNumber === "string" ? req.query.accountNumber.trim() : "";
      if (!accountNumber) {
        res.status(400).json({ error: "accountNumber is required" });
        return;
      }
      const account = await findPartnerBankAccountByNumber(toTxContext(context), accountNumber);
      res.json({ account });
    } catch (error) {
      next(error);
    }
  }
);

agencyRouter.get("/partner-accounts", requirePermission("agency.accounts.create"), async (req, res, next) => {
  try {
    const context = req.userContext!;
    const customerId = typeof req.query.customerId === "string" ? req.query.customerId : undefined;
    const accounts = await listPartnerBankAccounts(toTxContext(context), {
      customerId,
      branchId: resolveRequestBranchFilter(req)
    });
    res.json({ accounts });
  } catch (error) {
    next(error);
  }
});

agencyRouter.post(
  "/partner-accounts",
  requirePermission("agency.accounts.create"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const account = await createPartnerBankAccount(toTxContext(context), req.body);
      res.status(201).json({ account });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Account creation failed" });
    }
  }
);

agencyRouter.get(
  "/walk-in-customer",
  requirePermission("agency.deposits.record"),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const branchKey =
        resolveRequestBranchFilter(req) ??
        (typeof req.query.branchId === "string" ? req.query.branchId : undefined);
      if (!branchKey) {
        res.status(400).json({ error: "branchId is required" });
        return;
      }
      const branchId = await resolveBranchId(context.tenantId, branchKey);
      if (!branchId) {
        res.status(400).json({ error: "Branch not found" });
        return;
      }
      const customer = await ensureAgencyWalkInCustomer(context.tenantId, branchId);
      res.json({ customer });
    } catch (error) {
      next(error);
    }
  }
);

agencyRouter.get(
  "/teller-reconciliation",
  requirePermission("agency.deposits.record"),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const branchId =
        resolveRequestBranchFilter(req) ??
        (typeof req.query.branchId === "string" ? req.query.branchId : undefined);
      const businessDate = typeof req.query.date === "string" ? req.query.date : undefined;
      const tellerUserId = typeof req.query.tellerUserId === "string" ? req.query.tellerUserId : undefined;
      const transactionType =
        typeof req.query.transactionType === "string" ? req.query.transactionType : undefined;
      const bankProductId =
        typeof req.query.bankProductId === "string" ? req.query.bankProductId : undefined;
      const bootstrap = await getTellerReconciliationBootstrap(toTxContext(context), {
        branchId,
        businessDate,
        tellerUserId,
        transactionType,
        bankProductId
      });
      res.json(bootstrap);
    } catch (error) {
      next(error);
    }
  }
);

agencyRouter.get(
  "/till-journal",
  requirePermission("agency.deposits.record"),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const branchId = resolveRequestBranchFilter(req);
      if (!branchId) {
        res.status(400).json({ error: "branchId is required" });
        return;
      }
      const businessDate = typeof req.query.date === "string" ? req.query.date : undefined;
      const tellerUserId = typeof req.query.tellerUserId === "string" ? req.query.tellerUserId : undefined;
      const entries = await listTellerTillJournalEntries(toTxContext(context), {
        branchId,
        businessDate,
        tellerUserId
      });
      res.json({ entries });
    } catch (error) {
      next(error);
    }
  }
);

agencyRouter.post(
  "/till-journal",
  requirePermission("agency.deposits.record"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const entry = await createTellerTillJournalEntry(toTxContext(context), req.body);
      res.status(201).json({ entry });
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Till journal entry failed" });
    }
  }
);

agencyRouter.post(
  "/withdrawals/initiate",
  requirePermission("agency.withdrawals.approve"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const disclosure = await initiateAgencyWithdrawal(toTxContext(context), req.body);
      res.status(201).json({ disclosure });
    } catch (error) {
      res.status(400).json({
        error: error instanceof Error ? error.message : "Withdrawal initiation failed"
      });
    }
  }
);

agencyRouter.get(
  "/teller/deposits",
  requirePermission("agency.deposits.record"),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const businessDate = typeof req.query.date === "string" ? req.query.date : undefined;
      const result = await listTellerAgencyDeposits(toTxContext(context), {
        branchId: resolveRequestBranchFilter(req),
        businessDate
      });
      res.json(result);
    } catch (error) {
      next(error);
    }
  }
);

agencyRouter.get(
  "/back-office/bootstrap",
  requirePermission("agency.bank.execute"),
  async (req, res, next) => {
    try {
      const context = req.userContext!;
      const businessDate =
        typeof req.query.date === "string" ? req.query.date : undefined;
      const bootstrap = await getBackOfficeBootstrap(toTxContext(context), {
        branchId: resolveRequestBranchFilter(req),
        businessDate
      });
      res.json(bootstrap);
    } catch (error) {
      next(error);
    }
  }
);

agencyRouter.post(
  "/back-office/open-day",
  requirePermission("agency.bank.execute"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const result = await openBackOfficeDay(toTxContext(context), req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Failed to open day" });
    }
  }
);

agencyRouter.patch(
  "/back-office/account-entries",
  requirePermission("agency.bank.execute"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const result = await updateBackOfficeAccountEntries(toTxContext(context), req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Update failed" });
    }
  }
);

agencyRouter.post(
  "/back-office/ecash-requests",
  requirePermission("agency.bank.execute"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    try {
      const result = await createBackOfficeEcashRequest(toTxContext(context), req.body);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Ecash request failed" });
    }
  }
);

agencyRouter.post(
  "/back-office/ecash-requests/:requestId/approve",
  requirePermission("treasury.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const requestId = Array.isArray(req.params.requestId)
      ? req.params.requestId[0]
      : req.params.requestId;
    try {
      const result = await approveBackOfficeEcashRequest(
        toTxContext(context),
        requestId,
        req.body?.approve !== false
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Ecash approval failed" });
    }
  }
);

agencyRouter.post(
  "/back-office/deposits/:transactionId/accountant-approve",
  requirePermission("treasury.read"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const transactionId = Array.isArray(req.params.transactionId)
      ? req.params.transactionId[0]
      : req.params.transactionId;
    try {
      await approveAccountantDeposit(toTxContext(context), transactionId);
      const bootstrap = await getBackOfficeBootstrap(toTxContext(context), {
        branchId: resolveRequestBranchFilter(req)
      });
      res.json(bootstrap);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Approval failed" });
    }
  }
);

agencyRouter.post(
  "/back-office/deposits/:transactionId/done",
  requirePermission("agency.bank.execute"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const transactionId = Array.isArray(req.params.transactionId)
      ? req.params.transactionId[0]
      : req.params.transactionId;
    const executionBankProductId =
      typeof req.body?.executionBankProductId === "string"
        ? req.body.executionBankProductId
        : "";
    if (!executionBankProductId) {
      res.status(400).json({ error: "executionBankProductId is required" });
      return;
    }
    try {
      const result = await executeBackOfficeDeposit(
        toTxContext(context),
        transactionId,
        executionBankProductId
      );
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Execution failed" });
    }
  }
);

agencyRouter.post(
  "/withdrawals/:disclosureId/pay-cash",
  requirePermission("agency.withdrawals.pay"),
  async (req, res) => {
    const context = req.userContext;
    if (!context) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    const disclosureId = Array.isArray(req.params.disclosureId)
      ? req.params.disclosureId[0]
      : req.params.disclosureId;
    try {
      const result = await tellerPayWithdrawal(toTxContext(context), disclosureId);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Cash payout failed" });
    }
  }
);
