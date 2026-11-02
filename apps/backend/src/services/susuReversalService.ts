import { randomUUID } from "node:crypto";
import { reverseSusuCollectionSchema, type Transaction } from "@bms/shared";
import { assertBranchAccess } from "../middleware/branchScope.js";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { listBranches } from "./branchService.js";
import { getCustomerById } from "./customerService.js";
import { getCompanyProfile } from "./tenantProfileService.js";
import { addLedgerEntry, computeCustomerBalance } from "./ledgerService.js";
import { notifyTenantStaff } from "./notificationService.js";
import {
  findTransaction,
  listTransactions,
  upsertMemoryTransaction,
  type TransactionRequestContext
} from "./transactionService.js";
import { fetchUserNameMap } from "./userNameResolver.js";

const REVERSAL_ROLES = new Set(["admin", "coordinator"]);

export type SusuCollectionDetail = {
  transactionId: string;
  customerId: string;
  customerName: string;
  accountNumber?: string;
  amount: number;
  collectedAt: string;
  postedByUserId: string;
  postedByName: string;
  branchId: string;
  notes?: string;
  status: "posted" | "reversed";
  reversalReference?: string;
  reversalTransactionId?: string;
  reversalReason?: string;
  reversedByUserId?: string;
  reversedByName?: string;
  reversedAt?: string;
  canReverse: boolean;
  receiptText: string;
};

export type SusuReversalHistoryItem = {
  reversalTransactionId: string;
  reversalReference: string;
  originalTransactionId: string;
  customerId: string;
  customerName: string;
  accountNumber?: string;
  amount: number;
  collectedAt: string;
  reversedAt: string;
  postedByName: string;
  reversedByName: string;
  reason: string;
  branchId: string;
};

function assertReversalRole(role: string): void {
  if (!REVERSAL_ROLES.has(role)) {
    throw new Error("Only a company admin or coordinator can reverse a susu collection");
  }
}

function shortReference(id: string): string {
  return `REV-${id.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString();
}

function buildReceipt(input: {
  customerName: string;
  accountNumber?: string;
  amount: number;
  collectedAt: string;
  postedByName: string;
  originalId: string;
  reversalReference?: string;
  reversalReason?: string;
  reversedByName?: string;
  reversedAt?: string;
  branchLabel: string;
  companyName: string;
}): string {
  const lines = [
    "AABANKER SUSU COLLECTION REVERSAL",
    `Company: ${input.companyName}`,
    `Branch: ${input.branchLabel}`,
    `Original reference: ${input.originalId}`,
    `Reversal reference: ${input.reversalReference ?? "Pending"}`,
    `Customer: ${input.customerName}`,
    `Account: ${input.accountNumber ?? "Pending assignment"}`,
    `Amount: GHS ${input.amount.toFixed(2)}`,
    `Collection date: ${formatWhen(input.collectedAt)}`,
    `Posted by: ${input.postedByName}`,
    `Status: ${input.reversalReference ? "Reversed" : "Posted"}`,
    `Reversal reason: ${input.reversalReason ?? "—"}`,
    `Reversed by: ${input.reversedByName ?? "—"}`,
    `Reversed at: ${input.reversedAt ? formatWhen(input.reversedAt) : "—"}`,
    "",
    "The original collection remains on the customer record.",
    "This reversal corrects the susu balance. It does not refund cash."
  ];
  return lines.join("\n");
}

async function loadOriginal(
  tenantId: string,
  transactionId: string
): Promise<{ original: Transaction; reversal: Transaction | null }> {
  const found = await findTransaction(tenantId, transactionId);
  if (!found) {
    throw new Error("Transaction not found");
  }

  if (found.type === "susu_reversal") {
    if (!found.reversesTransactionId) {
      throw new Error("Reversal record is missing its original collection");
    }
    const original = await findTransaction(tenantId, found.reversesTransactionId);
    if (!original) {
      throw new Error("Original susu collection was not found");
    }
    return { original, reversal: found };
  }

  if (found.type !== "daily_susu") {
    throw new Error("Only a posted susu collection can be reversed");
  }

  const reversal = found.reversedByTransactionId
    ? await findTransaction(tenantId, found.reversedByTransactionId)
    : null;
  return { original: found, reversal };
}

export async function getSusuCollectionDetail(
  context: TransactionRequestContext,
  transactionId: string
): Promise<SusuCollectionDetail> {
  const { original, reversal } = await loadOriginal(context.tenantId, transactionId);
  assertBranchAccess(context, original.transactionBranchId);

  const customer = await getCustomerById(context.tenantId, original.customerId);
  const [branches, profile] = await Promise.all([
    listBranches(context.tenantId),
    getCompanyProfile(context.tenantId).catch(() => null)
  ]);
  const branch = branches.find((item) => item.id === original.transactionBranchId);
  const branchLabel = branch ? `${branch.name} (${branch.code})` : "—";
  const nameIds = [original.recordedByUserId, original.reversedByUserId, reversal?.recordedByUserId].filter(
    (id): id is string => Boolean(id)
  );
  const names = await fetchUserNameMap(context.tenantId, nameIds);
  const reversed = Boolean(original.reversedAt || original.reversedByTransactionId);
  const reversalId = reversal?.id ?? original.reversedByTransactionId;
  const postedByName = names.get(original.recordedByUserId) ?? original.recordedByUserId;
  const reversedByName = original.reversedByUserId
    ? names.get(original.reversedByUserId) ?? original.reversedByUserId
    : undefined;

  const detail: Omit<SusuCollectionDetail, "receiptText"> = {
    transactionId: original.id,
    customerId: original.customerId,
    customerName: customer?.fullName ?? original.customerId,
    accountNumber: customer?.accountNumber,
    amount: original.amount,
    collectedAt: original.createdAt,
    postedByUserId: original.recordedByUserId,
    postedByName,
    branchId: original.transactionBranchId,
    notes: original.notes,
    status: reversed ? "reversed" : "posted",
    reversalReference: reversalId ? shortReference(reversalId) : undefined,
    reversalTransactionId: reversalId,
    reversalReason: original.reversalReason ?? reversal?.reversalReason,
    reversedByUserId: original.reversedByUserId,
    reversedByName,
    reversedAt: original.reversedAt ?? reversal?.createdAt,
    canReverse: !reversed && REVERSAL_ROLES.has(context.role)
  };

  return {
    ...detail,
    receiptText: buildReceipt({
      customerName: detail.customerName,
      accountNumber: detail.accountNumber,
      amount: detail.amount,
      collectedAt: detail.collectedAt,
      postedByName: detail.postedByName,
      originalId: detail.transactionId,
      reversalReference: detail.reversalReference,
      reversalReason: detail.reversalReason,
      reversedByName: detail.reversedByName,
      reversedAt: detail.reversedAt,
      branchLabel,
      companyName: profile?.name ?? context.tenantId
    })
  };
}

function isMissingReversalFunction(message: string): boolean {
  return /reverse_susu_collection_atomic|could not find the function|schema cache/i.test(message);
}

export async function reverseSusuCollection(
  context: TransactionRequestContext,
  transactionId: string,
  input: unknown
): Promise<SusuCollectionDetail> {
  assertReversalRole(context.role);
  const parsed = reverseSusuCollectionSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Enter a reversal reason");
  }
  const reason = parsed.data.reason.trim();

  const existing = await findTransaction(context.tenantId, transactionId);
  if (!existing) {
    throw new Error("Transaction not found");
  }
  if (existing.type === "susu_reversal" || existing.reversesTransactionId) {
    throw new Error("A reversal record cannot be reversed");
  }
  if (existing.type !== "daily_susu") {
    throw new Error("Only a posted susu collection can be reversed");
  }
  if (existing.reversedAt || existing.reversedByTransactionId) {
    throw new Error("This collection has already been reversed");
  }
  if (existing.executionStatus && existing.executionStatus !== "completed") {
    throw new Error("Only a completed susu collection can be reversed");
  }
  assertBranchAccess(context, existing.transactionBranchId);

  const reversalId = randomUUID();
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    await applyMemoryReversal(context, existing, reversalId, reason);
  } else {
    const { error } = await supabase.rpc("reverse_susu_collection_atomic", {
      p_reversal_id: reversalId,
      p_tenant_id: context.tenantId,
      p_original_id: existing.id,
      p_actor_user_id: context.userId,
      p_actor_role: context.role,
      p_reason: reason
    });
    if (error) {
      if (isMissingReversalFunction(error.message)) {
        throw new Error(
          "Susu reversal storage is not ready. Apply migration 071_susu_collection_reversal.sql in Supabase, then try again."
        );
      }
      const message = error.message.replace(/^.*ERROR:\s*/i, "");
      if (/already been reversed|duplicate key|uq_customer_transactions/i.test(message)) {
        throw new Error("This collection has already been reversed");
      }
      throw new Error(message);
    }
  }

  const detail = await getSusuCollectionDetail(context, existing.id);
  try {
    await notifyTenantStaff({
      tenantId: context.tenantId,
      roles: ["admin", "coordinator"],
      kind: "susu_collection_reversed",
      title: "Susu collection reversed",
      body: `${detail.customerName} · GHS ${detail.amount.toFixed(2)} · ${detail.reversalReference ?? "reversal"} · ${reason}`,
      customerId: detail.customerId
    });
  } catch {
    // The ledger reversal is already stored. A missed alert does not undo it.
  }
  return detail;
}

async function applyMemoryReversal(
  context: TransactionRequestContext,
  original: Transaction,
  reversalId: string,
  reason: string
): Promise<void> {
  const customer = await getCustomerById(context.tenantId, original.customerId);
  const balance = await computeCustomerBalance(context.tenantId, original.customerId);
  const locked = customer?.lockedBalance ?? 0;
  if (balance - original.amount < locked) {
    throw new Error("Customer balance is not high enough to reverse this collection");
  }

  const now = new Date().toISOString();
  const reversal: Transaction = {
    id: reversalId,
    tenantId: context.tenantId,
    customerId: original.customerId,
    type: "susu_reversal",
    amount: original.amount,
    transactionBranchId: original.transactionBranchId,
    homeBranchId: original.homeBranchId,
    recordedByUserId: context.userId,
    fieldAgentId: original.fieldAgentId,
    createdAt: now,
    notes: `Reversal of ${original.id}. ${reason}`,
    reversesTransactionId: original.id,
    reversalReason: reason,
    executionStatus: "completed"
  };
  upsertMemoryTransaction(context.tenantId, reversal);
  upsertMemoryTransaction(context.tenantId, {
    ...original,
    reversedByTransactionId: reversalId,
    reversalReason: reason,
    reversedByUserId: context.userId,
    reversedAt: now
  });
  await addLedgerEntry({
    tenantId: context.tenantId,
    customerId: original.customerId,
    transactionId: reversalId,
    entryType: "debit",
    amount: original.amount,
    transactionBranchId: original.transactionBranchId
  });
}

export async function listSusuReversals(
  context: TransactionRequestContext,
  branchId?: string
): Promise<SusuReversalHistoryItem[]> {
  if (context.scopeType === "branch") {
    if (!context.branchId) {
      throw new Error("You do not have access to this branch");
    }
    assertBranchAccess(context, branchId ?? context.branchId);
  } else if (branchId) {
    assertBranchAccess(context, branchId);
  }

  const scopedBranch = context.scopeType === "branch" ? context.branchId : branchId;
  const transactions = await listTransactions(context.tenantId, { branchId: scopedBranch });
  const reversals = transactions.filter((tx) => tx.type === "susu_reversal" && tx.reversesTransactionId);
  const originals = new Map(
    transactions
      .filter((tx) => tx.type === "daily_susu")
      .map((tx) => [tx.id, tx])
  );

  const userIds = reversals.flatMap((tx) => {
    const original = tx.reversesTransactionId ? originals.get(tx.reversesTransactionId) : undefined;
    return [tx.recordedByUserId, original?.recordedByUserId].filter((id): id is string => Boolean(id));
  });
  const names = await fetchUserNameMap(context.tenantId, userIds);

  const items: SusuReversalHistoryItem[] = [];
  for (const reversal of reversals) {
    const original = reversal.reversesTransactionId
      ? originals.get(reversal.reversesTransactionId) ??
        (await findTransaction(context.tenantId, reversal.reversesTransactionId))
      : null;
    if (!original) {
      continue;
    }
    const customer = await getCustomerById(context.tenantId, original.customerId);
    items.push({
      reversalTransactionId: reversal.id,
      reversalReference: shortReference(reversal.id),
      originalTransactionId: original.id,
      customerId: original.customerId,
      customerName: customer?.fullName ?? original.customerId,
      accountNumber: customer?.accountNumber,
      amount: original.amount,
      collectedAt: original.createdAt,
      reversedAt: original.reversedAt ?? reversal.createdAt,
      postedByName: names.get(original.recordedByUserId) ?? original.recordedByUserId,
      reversedByName: names.get(reversal.recordedByUserId) ?? reversal.recordedByUserId,
      reason: original.reversalReason ?? reversal.reversalReason ?? reversal.notes ?? "",
      branchId: original.transactionBranchId
    });
  }

  return items.sort((a, b) => b.reversedAt.localeCompare(a.reversedAt));
}
