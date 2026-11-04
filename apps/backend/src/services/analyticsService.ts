import { isActiveDailySusu, type Transaction } from "@bms/shared";
import { listTransactions } from "./transactionService.js";

type RoleContext = {
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
  filterBranchId?: string;
  fromDate?: string;
  toDate?: string;
};

function scopedTransactions(transactions: Transaction[], context: RoleContext): Transaction[] {
  let scoped = transactions;
  if (context.scopeType !== "head_office") {
    scoped = transactions.filter((entry) => entry.transactionBranchId === context.branchId);
  }

  if (context.filterBranchId) {
    scoped = scoped.filter((entry) => entry.transactionBranchId === context.filterBranchId);
  }

  if (context.fromDate) {
    const from = context.fromDate.slice(0, 10);
    scoped = scoped.filter((entry) => entry.createdAt.slice(0, 10) >= from);
  }
  if (context.toDate) {
    const to = context.toDate.slice(0, 10);
    scoped = scoped.filter((entry) => entry.createdAt.slice(0, 10) <= to);
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
    totalTransactions: 0,
    totalDeposits: 0,
    totalWithdrawals: 0,
    totalDailySusu: 0
  };

  for (const transaction of transactions) {
    if (transaction.type === "susu_reversal" || (transaction.type === "daily_susu" && transaction.reversedAt)) {
      continue;
    }
    summary.totalTransactions += 1;
    if (transaction.type === "deposit") {
      summary.totalDeposits += transaction.amount;
    } else if (transaction.type === "withdrawal") {
      summary.totalWithdrawals += transaction.amount;
    } else if (isActiveDailySusu(transaction)) {
      summary.totalDailySusu += transaction.amount;
    }
  }

  return summary;
}

export type AgentPerformanceRow = {
  fieldAgentId: string;
  totalCollections: number;
  dailySusuCount: number;
  depositCount: number;
  withdrawalCount: number;
  dailySusuAmount: number;
  depositAmount: number;
  withdrawalAmount: number;
};

export async function getAgentPerformance(
  tenantId: string,
  context: RoleContext
): Promise<AgentPerformanceRow[]> {
  const transactions = scopedTransactions(await listTransactions(tenantId), context);
  const map = new Map<string, AgentPerformanceRow>();

  for (const transaction of transactions) {
    const existing = map.get(transaction.fieldAgentId) ?? {
      fieldAgentId: transaction.fieldAgentId,
      totalCollections: 0,
      dailySusuCount: 0,
      depositCount: 0,
      withdrawalCount: 0,
      dailySusuAmount: 0,
      depositAmount: 0,
      withdrawalAmount: 0
    };

    if (isActiveDailySusu(transaction)) {
      existing.dailySusuCount += 1;
      existing.dailySusuAmount += transaction.amount;
      existing.totalCollections += transaction.amount;
    } else if (transaction.type === "deposit") {
      existing.depositCount += 1;
      existing.depositAmount += transaction.amount;
      existing.totalCollections += transaction.amount;
    } else if (transaction.type === "withdrawal") {
      existing.withdrawalCount += 1;
      existing.withdrawalAmount += transaction.amount;
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
    if (transaction.type === "susu_reversal" || (transaction.type === "daily_susu" && transaction.reversedAt)) {
      continue;
    }
    bucket.transactionCount += 1;
    bucket.totalAmount += transaction.amount;
    if (transaction.type === "deposit") {
      bucket.depositAmount += transaction.amount;
    } else if (transaction.type === "withdrawal") {
      bucket.withdrawalAmount += transaction.amount;
    } else if (isActiveDailySusu(transaction)) {
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
  if (context.toDate && /^\d{4}-\d{2}-\d{2}$/.test(context.toDate)) {
    end.setTime(new Date(`${context.toDate}T23:59:59.999`).getTime());
  } else {
    end.setHours(23, 59, 59, 999);
  }
  const start = new Date(end);
  if (context.fromDate && /^\d{4}-\d{2}-\d{2}$/.test(context.fromDate)) {
    start.setTime(new Date(`${context.fromDate}T00:00:00.000`).getTime());
  } else {
    start.setDate(start.getDate() - (days - 1));
    start.setHours(0, 0, 0, 0);
  }

  const dayCount = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1
  );

  const buckets = new Map<string, DailyTrendPoint>();
  for (let i = 0; i < dayCount; i++) {
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
    if (tx.type === "susu_reversal" || (tx.type === "daily_susu" && tx.reversedAt)) {
      continue;
    }
    bucket.transactionCount += 1;
    if (tx.type === "deposit") {
      bucket.deposits += tx.amount;
    } else if (tx.type === "withdrawal") {
      bucket.withdrawals += tx.amount;
    } else if (isActiveDailySusu(tx)) {
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
