import { ledgerEntrySchema, type LedgerEntry } from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { fetchUserNameMap, ledgerPerformerLabel } from "./userNameResolver.js";

const ledgerStore = new Map<string, LedgerEntry[]>();

function tenantEntries(tenantId: string): LedgerEntry[] {
  return ledgerStore.get(tenantId) ?? [];
}

function setTenantEntries(tenantId: string, entries: LedgerEntry[]): void {
  ledgerStore.set(tenantId, entries);
}

export async function computeCustomerBalance(tenantId: string, customerId: string): Promise<number> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return tenantEntries(tenantId)
      .filter((entry) => entry.customerId === customerId)
      .reduce((balance, entry) => {
        return entry.entryType === "credit" ? balance + entry.amount : balance - entry.amount;
      }, 0);
  }

  const { data, error } = await supabase
    .from("ledger_entries")
    .select("entry_type, amount")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);

  if (error) {
    throw new Error(`Failed to compute balance: ${error.message}`);
  }

  return (data ?? []).reduce((balance, row) => {
    const amount = Number(row.amount);
    return row.entry_type === "credit" ? balance + amount : balance - amount;
  }, 0);
}

export async function addLedgerEntry(input: {
  tenantId: string;
  customerId: string;
  transactionId: string;
  entryType: "credit" | "debit";
  amount: number;
  transactionBranchId: string;
}): Promise<LedgerEntry> {
  const nextBalance =
    (await computeCustomerBalance(input.tenantId, input.customerId)) +
    (input.entryType === "credit" ? input.amount : -input.amount);

  const entry = ledgerEntrySchema.parse({
    id: randomUUID(),
    tenantId: input.tenantId,
    customerId: input.customerId,
    transactionId: input.transactionId,
    entryType: input.entryType,
    amount: input.amount,
    balanceAfter: nextBalance,
    transactionBranchId: input.transactionBranchId,
    createdAt: new Date().toISOString()
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("ledger_entries").insert({
      id: entry.id,
      tenant_id: entry.tenantId,
      customer_id: entry.customerId,
      transaction_id: entry.transactionId,
      entry_type: entry.entryType,
      amount: entry.amount,
      balance_after: entry.balanceAfter,
      transaction_branch_id: entry.transactionBranchId
    });

    if (error) {
      throw new Error(`Failed to add ledger entry: ${error.message}`);
    }
  } else {
    const entries = tenantEntries(input.tenantId);
    setTenantEntries(input.tenantId, [...entries, entry]);
  }

  return entry;
}

type TransactionMeta = {
  recordedByUserId: string;
  fieldAgentId: string;
  type: string;
  notes?: string;
  reversesTransactionId?: string;
  reversedByTransactionId?: string;
  reversalReason?: string;
  reversedByUserId?: string;
  reversedAt?: string;
};

function reversalMeta(row: Record<string, unknown>): Pick<
  TransactionMeta,
  "reversesTransactionId" | "reversedByTransactionId" | "reversalReason" | "reversedByUserId" | "reversedAt"
> {
  return {
    reversesTransactionId: row.reverses_transaction_id ? String(row.reverses_transaction_id) : undefined,
    reversedByTransactionId: row.reversed_by_transaction_id
      ? String(row.reversed_by_transaction_id)
      : undefined,
    reversalReason: row.reversal_reason ? String(row.reversal_reason) : undefined,
    reversedByUserId: row.reversed_by_user_id ? String(row.reversed_by_user_id) : undefined,
    reversedAt: row.reversed_at ? String(row.reversed_at) : undefined
  };
}

async function enrichLedgerEntries(
  tenantId: string,
  rows: Array<{
    id: string;
    tenant_id: string;
    customer_id: string;
    transaction_id: string;
    entry_type: string;
    amount: number | string;
    balance_after: number | string;
    transaction_branch_id: string;
    created_at: string;
  }>
): Promise<LedgerEntry[]> {
  if (rows.length === 0) {
    return [];
  }

  const supabase = getSupabaseAdminClient();
  const txMap = new Map<string, TransactionMeta>();

  if (supabase) {
    const transactionIds = [...new Set(rows.map((row) => row.transaction_id))];
    const fullResult = await supabase
      .from("customer_transactions")
      .select(
        "id, recorded_by_user_id, field_agent_id, type, notes, reverses_transaction_id, reversed_by_transaction_id, reversal_reason, reversed_by_user_id, reversed_at"
      )
      .eq("tenant_id", tenantId)
      .in("id", transactionIds);

    let txRows: Record<string, unknown>[] = [];
    if (
      fullResult.error &&
      /reverses_transaction_id|reversed_by_transaction_id|reversal_reason|reversed_at/i.test(fullResult.error.message)
    ) {
      const basicResult = await supabase
        .from("customer_transactions")
        .select("id, recorded_by_user_id, field_agent_id, type, notes")
        .eq("tenant_id", tenantId)
        .in("id", transactionIds);
      if (basicResult.error) {
        throw new Error(`Failed to load transaction metadata: ${basicResult.error.message}`);
      }
      txRows = (basicResult.data ?? []) as Record<string, unknown>[];
    } else if (fullResult.error) {
      throw new Error(`Failed to load transaction metadata: ${fullResult.error.message}`);
    } else {
      txRows = (fullResult.data ?? []) as Record<string, unknown>[];
    }

    for (const tx of txRows) {
      const row = tx;
      txMap.set(String(row.id), {
        recordedByUserId: String(row.recorded_by_user_id),
        fieldAgentId: String(row.field_agent_id),
        type: String(row.type),
        notes: row.notes ? String(row.notes) : undefined,
        ...reversalMeta(row)
      });
    }
  }

  const userIds = [...txMap.values()].flatMap((tx) => [
    tx.recordedByUserId,
    tx.fieldAgentId,
    tx.reversedByUserId
  ]);
  const nameMap = await fetchUserNameMap(tenantId, userIds.filter((id): id is string => Boolean(id)));

  return rows.map((row) => {
    const tx = txMap.get(row.transaction_id);
    const recordedByName = tx ? nameMap.get(tx.recordedByUserId) : undefined;
    const fieldAgentName = tx ? nameMap.get(tx.fieldAgentId) : undefined;
    const reversalId = tx?.type === "susu_reversal" ? tx.reversesTransactionId : tx?.reversedByTransactionId;

    return ledgerEntrySchema.parse({
      id: row.id,
      tenantId: row.tenant_id,
      customerId: row.customer_id,
      transactionId: row.transaction_id,
      entryType: row.entry_type,
      amount: Number(row.amount),
      balanceAfter: Number(row.balance_after),
      transactionBranchId: row.transaction_branch_id,
      createdAt: row.created_at,
      transactionType: tx?.type,
      notes: tx?.notes,
      recordedByName,
      fieldAgentName,
      performedByName: tx
        ? ledgerPerformerLabel({
            recordedByName,
            fieldAgentName,
            recordedByUserId: tx.recordedByUserId,
            fieldAgentId: tx.fieldAgentId,
            transactionType: tx.type
          })
        : undefined,
      reversalStatus: tx?.type === "daily_susu" && tx.reversedAt ? "reversed" : tx?.type === "daily_susu" ? "posted" : undefined,
      reversalReference: reversalId ? `REV-${reversalId.replace(/-/g, "").slice(0, 8).toUpperCase()}` : undefined,
      reversalReason: tx?.reversalReason,
      reversedByName: tx?.reversedByUserId ? nameMap.get(tx.reversedByUserId) : undefined,
      reversedAt: tx?.reversedAt
    });
  });
}

export async function getCustomerLedger(tenantId: string, customerId: string): Promise<LedgerEntry[]> {
  const { reconcileCustomerApprovedWithdrawalDebits } = await import(
    "./transactionService.js"
  );
  await reconcileCustomerApprovedWithdrawalDebits(tenantId, customerId);

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return tenantEntries(tenantId).filter((entry) => entry.customerId === customerId);
  }

  const { data, error } = await supabase
    .from("ledger_entries")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch ledger: ${error.message}`);
  }

  return enrichLedgerEntries(tenantId, data ?? []);
}
