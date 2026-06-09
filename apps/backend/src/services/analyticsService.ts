import type { Transaction } from "@bms/shared";
import { listTransactions } from "./transactionService.js";

type RoleContext = {
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
  filterBranchId?: string;
};

function scopedTransactions(transactions: Transaction[], context: RoleContext): Transaction[] {
  let scoped = transactions;
  if (context.scopeType !== "head_office") {
    scoped = transactions.filter((entry) => entry.transactionBranchId === context.branchId);
  }

  if (context.filterBranchId) {
    scoped = scoped.filter((entry) => entry.transactionBranchId === context.filterBranchId);
  }

  return scoped;
}

export async function getBranchPerformanceSummary(
  tenantId: string,
  context: RoleContext
): Promise<{
  totalTransactions: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalDailySusu: number;
}> {
  const transactions = scopedTransactions(await listTransactions(tenantId), context);

  const summary = {
    totalTransactions: transactions.length,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalDailySusu: 0
  };

  for (const transaction of transactions) {
    if (transaction.type === "deposit") {
      summary.totalDeposits += transaction.amount;
    } else if (transaction.type === "withdrawal") {
      summary.totalWithdrawals += transaction.amount;
    } else if (transaction.type === "daily_susu") {
      summary.totalDailySusu += transaction.amount;
    }
  }

  return summary;
}

export async function getAgentPerformance(
  tenantId: string,
  context: RoleContext
): Promise<
  Array<{
    fieldAgentId: string;
    totalCollections: number;
    dailySusuCount: number;
    depositCount: number;
    withdrawalCount: number;
  }>
> {
  const transactions = scopedTransactions(await listTransactions(tenantId), context);
  const map = new Map<
    string,
    {
      fieldAgentId: string;
      totalCollections: number;
      dailySusuCount: number;
      depositCount: number;
      withdrawalCount: number;
    }
  >();

  for (const transaction of transactions) {
    const existing = map.get(transaction.fieldAgentId) ?? {
      fieldAgentId: transaction.fieldAgentId,
      totalCollections: 0,
      dailySusuCount: 0,
      depositCount: 0,
      withdrawalCount: 0
    };

    existing.totalCollections += transaction.amount;
    if (transaction.type === "daily_susu") {
      existing.dailySusuCount += 1;
    } else if (transaction.type === "deposit") {
      existing.depositCount += 1;
    } else if (transaction.type === "withdrawal") {
      existing.withdrawalCount += 1;
    }

    map.set(transaction.fieldAgentId, existing);
  }

  return Array.from(map.values()).sort((a, b) => b.totalCollections - a.totalCollections);
}

export async function getBranchBreakdown(
  tenantId: string,
  context: RoleContext
): Promise<
  Array<{
    branchId: string;
    totalAmount: number;
    transactionCount: number;
    depositAmount: number;
    withdrawalAmount: number;
    dailySusuAmount: number;
  }>
> {
  const transactions = scopedTransactions(await listTransactions(tenantId), context);
  const map = new Map<
    string,
    {
      branchId: string;
      totalAmount: number;
      transactionCount: number;
      depositAmount: number;
      withdrawalAmount: number;
      dailySusuAmount: number;
    }
  >();

  for (const transaction of transactions) {
    const bucket = map.get(transaction.transactionBranchId) ?? {
      branchId: transaction.transactionBranchId,
      totalAmount: 0,
      transactionCount: 0,
      depositAmount: 0,
      withdrawalAmount: 0,
      dailySusuAmount: 0
    };
    bucket.transactionCount += 1;
    bucket.totalAmount += transaction.amount;
    if (transaction.type === "deposit") {
      bucket.depositAmount += transaction.amount;
    } else if (transaction.type === "withdrawal") {
      bucket.withdrawalAmount += transaction.amount;
    } else {
      bucket.dailySusuAmount += transaction.amount;
    }
    map.set(transaction.transactionBranchId, bucket);
  }

  return Array.from(map.values()).sort((a, b) => b.totalAmount - a.totalAmount);
}

export type DailyTrendPoint = {
  date: string;
  deposits: number;
  withdrawals: number;
  dailySusu: number;
  transactionCount: number;
  net: number;
};

export async function getDailyTransactionTrend(
  tenantId: string,
  context: RoleContext,
  days = 14
): Promise<DailyTrendPoint[]> {
  const transactions = scopedTransactions(await listTransactions(tenantId), context);
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);

  const buckets = new Map<string, DailyTrendPoint>();
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    buckets.set(key, {
      date: key,
      deposits: 0,
      withdrawals: 0,
      dailySusu: 0,
      transactionCount: 0,
      net: 0
    });
  }

  for (const tx of transactions) {
    const key = tx.createdAt.slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) {
      continue;
    }
    bucket.transactionCount += 1;
    if (tx.type === "deposit") {
      bucket.deposits += tx.amount;
    } else if (tx.type === "withdrawal") {
      bucket.withdrawals += tx.amount;
    } else {
      bucket.dailySusu += tx.amount;
    }
    bucket.net = bucket.deposits + bucket.dailySusu - bucket.withdrawals;
  }

  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export type CustomerAccountMix = {
  susu: number;
  savings: number;
  group: number;
  meba_daakye: number;
  pending: number;
  totalActive: number;
};

export async function getCustomerAccountMix(
  tenantId: string,
  context: RoleContext
): Promise<CustomerAccountMix> {
  const { listCustomers } = await import("./customerService.js");
  let customers = await listCustomers(tenantId, { light: true });
  if (context.scopeType !== "head_office" && context.branchId) {
    customers = customers.filter((c) => c.homeBranchId === context.branchId);
  }
  if (context.filterBranchId) {
    customers = customers.filter((c) => c.homeBranchId === context.filterBranchId);
  }

  const mix: CustomerAccountMix = {
    susu: 0,
    savings: 0,
    group: 0,
    meba_daakye: 0,
    pending: 0,
    totalActive: 0
  };

  for (const c of customers) {
    if (c.status === "pending_activation") {
      mix.pending += 1;
      continue;
    }
    if (c.status !== "active") {
      continue;
    }
    mix.totalActive += 1;
    const type = c.accountType ?? "susu";
    if (type === "savings") {
      mix.savings += 1;
    } else if (type === "group") {
      mix.group += 1;
    } else if (type === "meba_daakye") {
      mix.meba_daakye += 1;
    } else {
      mix.susu += 1;
    }
  }

  return mix;
}
