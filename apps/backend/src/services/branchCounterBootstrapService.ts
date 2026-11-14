import type { BalanceDisclosure, Customer, TenantBankProduct } from "@bms/shared";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { listBranches, resolveBranchId } from "./branchService.js";
import { listBankProducts } from "./bankProductService.js";
import {
  listBranchCounterStatement,
  summarizeBranchCounterStatement,
  type BranchCounterStatementLine
} from "./branchCounterStatementService.js";
import { listCustomers } from "./customerService.js";
import {
  floatSessionSummary,
  getFloatSessionForCashier,
  listPendingFloatRequests,
  type BranchFloatSession
} from "./branchFloatService.js";
import { loadWithdrawalsPendingTellerPay } from "./agencyBankingService.js";

type BranchRow = Awaited<ReturnType<typeof listBranches>>[number];

export type BranchCounterBootstrap = {
  customers: Customer[];
  branches: BranchRow[];
  bankProducts: TenantBankProduct[];
  statement: {
    lines: BranchCounterStatementLine[];
    summary: ReturnType<typeof summarizeBranchCounterStatement>;
  } | null;
  floatSession: BranchFloatSession | null;
  floatSummary: ReturnType<typeof floatSessionSummary>;
  pendingFloatRequests: BranchFloatSession[];
  /** Coordinator/CS-approved field cash withdrawals awaiting teller Pay now. */
  pendingFieldPayouts: BalanceDisclosure[];
};

export async function getBranchCounterBootstrap(
  tenantId: string,
  options: {
    branchId?: string;
    date?: string;
    cashierUserId?: string;
    includePending?: boolean;
    /** Skip statement, float session, and pending float requests (faster teller deposit desk). */
    minimal?: boolean;
    /**
     * Hot slice only: statement + float + pending requests.
     * Skips customers, branches, and bank products (caller keeps cached catalog).
     */
    hot?: boolean;
  }
): Promise<BranchCounterBootstrap> {
  const date =
    options.date && options.date.length > 0
      ? options.date
      : new Date().toISOString().slice(0, 10);

  if (options.hot) {
    const resolvedBranchId = options.branchId
      ? await resolveBranchId(tenantId, options.branchId)
      : undefined;

    let statement: BranchCounterBootstrap["statement"] = null;
    if (resolvedBranchId) {
      try {
        const lines = await listBranchCounterStatement(tenantId, resolvedBranchId, date);
        statement = {
          lines,
          summary: summarizeBranchCounterStatement(lines, date, resolvedBranchId)
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const emptySummary = summarizeBranchCounterStatement([], date, resolvedBranchId);
        if (
          isMissingSupabaseResource(message) ||
          /invalid input syntax for type uuid/i.test(message)
        ) {
          statement = { lines: [], summary: emptySummary };
        } else {
          throw error;
        }
      }
    }

    let floatSession: BranchFloatSession | null = null;
    if (options.cashierUserId) {
      floatSession = await getFloatSessionForCashier(
        tenantId,
        options.cashierUserId,
        date,
        resolvedBranchId ?? undefined
      );
    }

    const pendingFloatRequests = options.includePending
      ? await listPendingFloatRequests(tenantId)
      : [];

    const pendingFieldPayouts = resolvedBranchId
      ? await loadWithdrawalsPendingTellerPay(tenantId, resolvedBranchId).catch(
          () => [] as BalanceDisclosure[]
        )
      : [];

    return {
      customers: [],
      branches: [],
      bankProducts: [],
      statement,
      floatSession,
      floatSummary: floatSessionSummary(floatSession),
      pendingFloatRequests,
      pendingFieldPayouts
    };
  }

  const [customers, branchRows, bankProducts] = await Promise.all([
    listCustomers(tenantId, { light: true }),
    listBranches(tenantId).catch(() => [] as BranchRow[]),
    (async () => {
      const branchKey = options.branchId
        ? await resolveBranchId(tenantId, options.branchId)
        : undefined;
      return listBankProducts(tenantId, {
        activeOnly: true,
        branchId: branchKey ?? undefined
      }).catch(() => [] as TenantBankProduct[]);
    })()
  ]);

  const branches = branchRows.filter((b) => b.status !== "inactive");

  let statement: BranchCounterBootstrap["statement"] = null;
  if (!options.minimal && options.branchId) {
    const resolvedBranchId = await resolveBranchId(tenantId, options.branchId);
    if (resolvedBranchId) {
      try {
        const lines = await listBranchCounterStatement(tenantId, resolvedBranchId, date);
        statement = {
          lines,
          summary: summarizeBranchCounterStatement(lines, date, resolvedBranchId)
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const emptySummary = summarizeBranchCounterStatement([], date, resolvedBranchId);
        if (
          isMissingSupabaseResource(message) ||
          /invalid input syntax for type uuid/i.test(message)
        ) {
          statement = { lines: [], summary: emptySummary };
        } else {
          throw error;
        }
      }
    }
  }

  let floatSession: BranchFloatSession | null = null;
  if (!options.minimal && options.cashierUserId) {
    const resolvedBranchId = options.branchId
      ? await resolveBranchId(tenantId, options.branchId)
      : undefined;
    floatSession = await getFloatSessionForCashier(
      tenantId,
      options.cashierUserId,
      date,
      resolvedBranchId ?? undefined
    );
  }

  const pendingFloatRequests =
    !options.minimal && options.includePending ? await listPendingFloatRequests(tenantId) : [];

  const tellerBankProducts = bankProducts.filter(
    (p) => !p.isCompanyBankAccount
  );

  const payoutBranchId = options.branchId
    ? await resolveBranchId(tenantId, options.branchId)
    : undefined;
  const pendingFieldPayouts =
    !options.minimal && payoutBranchId
      ? await loadWithdrawalsPendingTellerPay(tenantId, payoutBranchId).catch(
          () => [] as BalanceDisclosure[]
        )
      : [];

  return {
    customers,
    branches,
    bankProducts: tellerBankProducts,
    statement,
    floatSession,
    floatSummary: floatSessionSummary(floatSession),
    pendingFloatRequests,
    pendingFieldPayouts
  };
}
