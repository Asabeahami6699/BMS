import {
  createTellerTillJournalEntrySchema,
  tellerTillJournalEntrySchema,
  type TellerTillJournalEntry
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { assertBranchAccess } from "../middleware/branchScope.js";
import { resolveBranchId } from "./branchService.js";
import { resolveTellerName } from "./tellerReconciliationService.js";
import type { TransactionRequestContext } from "./transactionService.js";

const memoryEntries = new Map<string, TellerTillJournalEntry[]>();

function mapRow(
  row: Record<string, unknown>,
  extras?: { createdByName?: string }
): TellerTillJournalEntry {
  return tellerTillJournalEntrySchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    branchId: String(row.branch_id),
    tellerUserId: String(row.teller_user_id),
    businessDate: String(row.business_date).slice(0, 10),
    entryType: row.entry_type,
    amount: Number(row.amount),
    notes: row.notes != null ? String(row.notes) : undefined,
    createdAt: String(row.created_at),
    createdByUserId: String(row.created_by_user_id),
    createdByName: extras?.createdByName
  });
}

export async function listTellerTillJournalEntries(
  context: TransactionRequestContext,
  options: { branchId: string; businessDate?: string; tellerUserId?: string }
): Promise<TellerTillJournalEntry[]> {
  const branchId = await resolveBranchId(context.tenantId, options.branchId);
  if (!branchId) {
    throw new Error("Branch not found");
  }
  assertBranchAccess(context, branchId);

  const businessDate = options.businessDate?.trim() || new Date().toISOString().slice(0, 10);
  const tellerUserId =
    context.role === "teller" ? context.userId : options.tellerUserId?.trim() || context.userId;

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let query = supabase
      .from("teller_till_journal_entries")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("branch_id", branchId)
      .eq("business_date", businessDate)
      .order("created_at", { ascending: false });
    if (tellerUserId) {
      query = query.eq("teller_user_id", tellerUserId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load till journal: ${error.message}`);
    }
    return (data ?? []).map((row) =>
      mapRow(row as Record<string, unknown>, {
        createdByName: resolveTellerName(String(row.created_by_user_id))
      })
    );
  }

  const key = context.tenantId;
  return (memoryEntries.get(key) ?? []).filter((entry) => {
    if (entry.branchId !== branchId || entry.businessDate !== businessDate) {
      return false;
    }
    if (tellerUserId && entry.tellerUserId !== tellerUserId) {
      return false;
    }
    return true;
  });
}

export async function createTellerTillJournalEntry(
  context: TransactionRequestContext,
  input: unknown
): Promise<TellerTillJournalEntry> {
  const parsed = createTellerTillJournalEntrySchema.parse(input);
  const branchId = await resolveBranchId(context.tenantId, parsed.branchId);
  if (!branchId) {
    throw new Error("Branch not found");
  }
  assertBranchAccess(context, branchId);

  const now = new Date().toISOString();
  const id = randomUUID();
  const row = {
    id,
    tenant_id: context.tenantId,
    branch_id: branchId,
    teller_user_id: context.userId,
    business_date: parsed.businessDate,
    entry_type: parsed.entryType,
    amount: parsed.amount,
    notes: parsed.notes?.trim() ?? null,
    created_by_user_id: context.userId,
    created_at: now
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("teller_till_journal_entries")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      throw new Error(`Failed to save till journal entry: ${error.message}`);
    }
    return mapRow(data as Record<string, unknown>, {
      createdByName: resolveTellerName(context.userId)
    });
  }

  const entry = mapRow(row as unknown as Record<string, unknown>, {
    createdByName: resolveTellerName(context.userId)
  });
  const list = memoryEntries.get(context.tenantId) ?? [];
  memoryEntries.set(context.tenantId, [entry, ...list]);
  return entry;
}
