import { accountantDashboardSchema, type AccountantDashboard, type Permission } from "@bms/shared";
import {
  getBranchBreakdown,
  getBranchPerformanceSummary
} from "./analyticsService.js";
import { getBackOfficeBootstrap } from "./backOfficeService.js";
import { listBranches } from "./branchService.js";
import { listCustomers } from "./customerService.js";
import { getLoansBootstrap } from "./loanService.js";
import { getTreasuryBootstrap } from "./treasuryService.js";
import type { TransactionRequestContext } from "./transactionService.js";
import type { UserContext } from "../types/express.js";

const HIGH_VALUE_DEFAULT = 10_000;

function toUserContext(context: TransactionRequestContext): UserContext {
  return {
    userId: context.userId,
    tenantId: context.tenantId,
    role: context.role,
    scopeType: context.scopeType,
    branchId: context.branchId,
    permissions: (context.permissions ?? []) as Permission[]
  };
}

export async function getAccountantDashboard(
  context: TransactionRequestContext,
  options?: { branchId?: string }
): Promise<AccountantDashboard> {
  const filterBranchId = options?.branchId?.trim() || undefined;
  const scope = {
    role: context.role,
    scopeType: context.scopeType,
    branchId: context.branchId,
    filterBranchId
  };

  const userCtx = toUserContext(context);
  const [summary, branchReports, branches, customers] = await Promise.all([
    getBranchPerformanceSummary(context.tenantId, scope),
    getBranchBreakdown(context.tenantId, scope),
    listBranches(context.tenantId).catch(() => []),
    listCustomers(context.tenantId).catch(() => [])
  ]);

  const operationalBranches = filterBranchId
    ? branches.filter((b) => b.id === filterBranchId && b.status === "active")
    : branches.filter((b) => b.status === "active");

  let cashInVault = 0;
  let cashInBank = 0;
  let tellerCash = 0;
  let totalExpenses = 0;
  let commissionIncome = 0;
  let unbalancedBranches = 0;

  await Promise.all(
    operationalBranches.map(async (branch) => {
      try {
        const bootstrap = await getTreasuryBootstrap(userCtx, branch.id, branch.name);
        cashInVault += bootstrap.branchCashPosition.vaultCash;
        cashInBank += bootstrap.branchCashPosition.bankCash;
        tellerCash += bootstrap.branchCashPosition.tellerCash;
        if (!bootstrap.trialBalance.isBalanced) {
          unbalancedBranches += 1;
        }
        for (const account of bootstrap.accounts) {
          if (account.kind === "expense") {
            totalExpenses += account.balance;
          }
          if (account.kind === "commission") {
            commissionIncome += account.balance;
          }
        }
      } catch {
        // Branch may be out of scope for this user
      }
    })
  );

  let loanPortfolio = 0;
  try {
    const loans = await getLoansBootstrap(context.tenantId, filterBranchId);
    loanPortfolio = loans.summary.totalOutstanding;
  } catch {
    loanPortfolio = 0;
  }

  let fixedDepositPortfolio = 0;
  for (const customer of customers) {
    if (customer.status !== "active") {
      continue;
    }
    if (filterBranchId && customer.homeBranchId !== filterBranchId) {
      continue;
    }
    if (customer.accountType === "savings") {
      fixedDepositPortfolio += customer.accountBalance ?? 0;
    }
  }

  let pendingApprovals = 0;
  try {
    const backOffice = await getBackOfficeBootstrap(context, {
      branchId: filterBranchId ?? (context.scopeType === "head_office" ? "all" : context.branchId),
      businessDate: new Date().toISOString().slice(0, 10)
    });
    pendingApprovals =
      (backOffice.pendingAccountantCount ?? 0) + (backOffice.pendingEcashCount ?? 0);
  } catch {
    pendingApprovals = 0;
  }

  const branchById = new Map(branches.map((b) => [b.id, b]));
  const branchSummary = branchReports.map((row) => {
    const branch = branchById.get(row.branchId);
    return {
      branchId: row.branchId,
      branchName: branch?.name,
      branchCode: branch?.code,
      deposits: row.depositAmount,
      withdrawals: row.withdrawalAmount,
      netFlow: row.depositAmount - row.withdrawalAmount,
      transactionCount: row.transactionCount
    };
  });

  return accountantDashboardSchema.parse({
    totals: {
      totalDeposits: summary.totalDeposits,
      totalWithdrawals: summary.totalWithdrawals,
      cashInVault,
      cashInBank,
      totalExpenses,
      commissionIncome,
      loanPortfolio,
      fixedDepositPortfolio,
      tellerCash,
      netCashPosition: cashInVault + cashInBank + tellerCash
    },
    branchSummary,
    pendingApprovals,
    unbalancedBranches
  });
}

export { HIGH_VALUE_DEFAULT };
