import {
  tellerReconciliationBootstrapSchema,
  type TellerReconciliationBootstrap,
  type TellerReconciliationRow,
  type TellerTransactionRecord
} from "@bms/shared";
import { findUserById, listUsersByTenant } from "./authStore.js";
import {
  getFloatSessionForCashier,
  listBranchFloatSessions,
  type BranchFloatSession
} from "./branchFloatService.js";
import {
  listBranchCounterStatement,
  type BranchCounterStatementLine
} from "./branchCounterStatementService.js";
import { listBranches, resolveBranchId } from "./branchService.js";
import { getBankProductById } from "./bankProductService.js";
import { userDisplayName } from "./userNameResolver.js";
import type { TransactionRequestContext } from "./transactionService.js";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function sessionToRow(
  session: BranchFloatSession,
  tellerName: string
): TellerReconciliationRow {
  const deposits = session.totalDeposits + session.totalDailySusu;
  const expectedClosing =
    session.expectedClosing ?? session.openingFloat + deposits - session.totalWithdrawals;
  const closing = session.actualClosing ?? (session.status === "open" ? null : expectedClosing);
  const difference =
    session.variance ??
    (session.actualClosing != null ? session.actualClosing - expectedClosing : null);

  return {
    tellerId: session.cashierUserId,
    tellerName,
    businessDate: session.businessDate,
    branchId: session.branchId,
    opening: session.openingFloat,
    deposits,
    withdrawals: session.totalWithdrawals,
    closing,
    expectedClosing,
    difference,
    status: session.status,
    transactionCount: session.transactionCount
  };
}

async function mapTransactionLine(
  tenantId: string,
  line: BranchCounterStatementLine
): Promise<TellerTransactionRecord> {
  const workflow =
    (line as BranchCounterStatementLine & { workflowData?: Record<string, unknown> }).workflowData ??
    {};
  const partnerAccountNumber =
    typeof workflow.account_number === "string" ? workflow.account_number : undefined;
  let bankProductName: string | undefined;
  let bankLabel: string | undefined;
  if (line.bankProductId) {
    const product = await getBankProductById(tenantId, line.bankProductId);
    if (product) {
      bankProductName = product.name;
      bankLabel = product.bankLabel;
    }
  }
  return {
    id: line.id,
    createdAt: line.createdAt,
    type: line.type,
    amount: line.amount,
    customerName: line.customerName,
    customerAccountNumber: line.customerAccountNumber,
    partnerAccountNumber,
    bankProductId: line.bankProductId,
    bankProductName,
    bankLabel,
    recordedByName: line.recordedByName,
    recordedByUserId: line.recordedByUserId,
    notes: line.notes,
    executionStatus: line.executionStatus
  };
}

export async function getTellerReconciliationBootstrap(
  context: TransactionRequestContext,
  options?: {
    branchId?: string;
    businessDate?: string;
    tellerUserId?: string;
    transactionType?: string;
    bankProductId?: string;
  }
): Promise<TellerReconciliationBootstrap> {
  const businessDate = options?.businessDate?.trim() || todayDate();
  let branchId = options?.branchId
    ? await resolveBranchId(context.tenantId, options.branchId)
    : undefined;
  if (!branchId && context.scopeType === "branch" && context.branchId) {
    branchId = await resolveBranchId(context.tenantId, context.branchId);
  }

  if (!branchId) {
    const branches = await listBranches(context.tenantId).catch(() => []);
    const active = branches.filter((b) => b.status !== "inactive");
    if (active.length === 1) {
      branchId = active[0].id;
    }
  }

  if (!branchId) {
    throw new Error("Select a branch for teller reconciliation");
  }

  const users = listUsersByTenant(context.tenantId);
  const nameById = new Map(
    users.map((user) => [user.id, userDisplayName(user.fullName, user.email, user.id)])
  );

  let sessions: BranchFloatSession[] = [];
  const scopedTellerId =
    context.role === "teller" ? context.userId : options?.tellerUserId?.trim() || undefined;

  if (scopedTellerId) {
    const session = await getFloatSessionForCashier(
      context.tenantId,
      scopedTellerId,
      businessDate,
      branchId
    );
    if (session && session.branchId === branchId) {
      sessions = [session];
    }
  } else if (context.role === "admin" || context.role === "coordinator") {
    sessions = (await listBranchFloatSessions(context.tenantId, { businessDate })).filter(
      (session) => session.branchId === branchId
    );
  } else {
    const session = await getFloatSessionForCashier(
      context.tenantId,
      context.userId,
      businessDate,
      branchId
    );
    if (session) {
      sessions = [session];
    }
  }

  const rows = sessions.map((session) =>
    sessionToRow(session, nameById.get(session.cashierUserId) ?? session.cashierUserId)
  );

  const lines = await listBranchCounterStatement(context.tenantId, branchId, businessDate);
  let filtered = lines.filter((line) => {
    if (scopedTellerId) {
      return line.recordedByUserId === scopedTellerId;
    }
    return true;
  });
  if (options?.transactionType) {
    filtered = filtered.filter((line) => line.type === options.transactionType);
  }
  if (options?.bankProductId) {
    filtered = filtered.filter((line) => line.bankProductId === options.bankProductId);
  }

  const transactions = await Promise.all(
    filtered.map((line) => mapTransactionLine(context.tenantId, line))
  );

  return tellerReconciliationBootstrapSchema.parse({
    businessDate,
    branchId,
    rows,
    transactions
  });
}

export function resolveTellerName(userId: string): string {
  const user = findUserById(userId);
  return user ? userDisplayName(user.fullName, user.email, user.id) : userId;
}
