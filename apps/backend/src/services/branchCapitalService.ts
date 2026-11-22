import { randomUUID } from "node:crypto";
import {
  createBranchCapitalEntrySchema,
  formatAccountAmount,
  voidBranchCapitalEntrySchema,
  type BranchCapitalEntry,
  type BranchCapitalEntryType,
  type BranchCapitalSummary
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { branchDisplayLabel } from "./branchService.js";
import { notifyTenantStaff } from "./notificationService.js";
import { fetchTenantUserNameMap } from "./userNameResolver.js";

type RoleContext = {
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
};

const memoryCapitalEntries = new Map<string, BranchCapitalEntry[]>();

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function isMissingCapitalTable(message: string): boolean {
  return /branch_capital_entries|does not exist|schema cache|could not find the table/i.test(
    message
  );
}

function mapRow(row: Record<string, unknown>): BranchCapitalEntry {
  return {
    id: String(row.id),
    tenantId: String(row.tenant_id),
    branchId: String(row.branch_id),
    businessDate: String(row.business_date).slice(0, 10),
    entryType: (row.entry_type === "drawing" ? "drawing" : "injection") as BranchCapitalEntryType,
    amount: roundMoney(Number(row.amount ?? 0)),
    source: row.source != null ? String(row.source) : undefined,
    reference: row.reference != null ? String(row.reference) : undefined,
    notes: row.notes != null ? String(row.notes) : undefined,
    recordedBy: String(row.recorded_by ?? ""),
    recordedByName: row.recorded_by_name != null ? String(row.recorded_by_name) : undefined,
    voidedAt: row.voided_at != null ? String(row.voided_at) : undefined,
    voidedBy: row.voided_by != null ? String(row.voided_by) : undefined,
    voidReason: row.void_reason != null ? String(row.void_reason) : undefined,
    createdAt: String(row.created_at ?? new Date().toISOString())
  };
}

async function loadAllTenantCapitalEntries(
  tenantId: string
): Promise<{ storageReady: boolean; entries: BranchCapitalEntry[] }> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const rows = [...(memoryCapitalEntries.get(tenantId) ?? [])].sort((a, b) =>
      b.businessDate.localeCompare(a.businessDate) || b.createdAt.localeCompare(a.createdAt)
    );
    return { storageReady: true, entries: rows };
  }

  const { data, error } = await supabase
    .from("branch_capital_entries")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("business_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    if (isMissingCapitalTable(error.message)) {
      return { storageReady: false, entries: [] };
    }
    throw new Error(`Failed to load business capital entries: ${error.message}`);
  }

  return {
    storageReady: true,
    entries: (data ?? []).map((row) => mapRow(row as Record<string, unknown>))
  };
}

export async function loadDayBranchCapitalTotals(
  tenantId: string,
  branchId: string,
  businessDate: string
): Promise<{
  storageReady: boolean;
  dayInjections: number;
  dayDrawings: number;
  branchTotalInjected: number;
  branchTotalDrawings: number;
  branchNetCapital: number;
  companyTotalInjected: number;
  companyTotalDrawings: number;
  companyNetCapital: number;
}> {
  const { storageReady, entries } = await loadAllTenantCapitalEntries(tenantId);
  let companyTotalInjected = 0;
  let companyTotalDrawings = 0;
  let branchTotalInjected = 0;
  let branchTotalDrawings = 0;
  let dayInjections = 0;
  let dayDrawings = 0;

  for (const entry of entries) {
    if (entry.voidedAt) {
      continue;
    }
    const isInjection = entry.entryType === "injection";
    if (isInjection) {
      companyTotalInjected += entry.amount;
    } else {
      companyTotalDrawings += entry.amount;
    }
    if (entry.branchId === branchId) {
      if (isInjection) {
        branchTotalInjected += entry.amount;
      } else {
        branchTotalDrawings += entry.amount;
      }
      if (entry.businessDate === businessDate) {
        if (isInjection) {
          dayInjections += entry.amount;
        } else {
          dayDrawings += entry.amount;
        }
      }
    }
  }

  return {
    storageReady,
    dayInjections: roundMoney(dayInjections),
    dayDrawings: roundMoney(dayDrawings),
    branchTotalInjected: roundMoney(branchTotalInjected),
    branchTotalDrawings: roundMoney(branchTotalDrawings),
    branchNetCapital: roundMoney(branchTotalInjected - branchTotalDrawings),
    companyTotalInjected: roundMoney(companyTotalInjected),
    companyTotalDrawings: roundMoney(companyTotalDrawings),
    companyNetCapital: roundMoney(companyTotalInjected - companyTotalDrawings)
  };
}

export async function getBranchCapitalSummary(
  tenantId: string,
  context: RoleContext,
  options: { branchId?: string; businessDate?: string }
): Promise<BranchCapitalSummary> {
  const businessDate =
    options.businessDate && /^\d{4}-\d{2}-\d{2}$/.test(options.businessDate)
      ? options.businessDate
      : new Date().toISOString().slice(0, 10);

  let branchId = options.branchId?.trim() || undefined;
  if (context.scopeType === "branch" && context.branchId) {
    if (branchId && branchId !== context.branchId) {
      throw new Error("Cannot view capital records for another branch");
    }
    branchId = context.branchId;
  }

  const { storageReady, entries } = await loadAllTenantCapitalEntries(tenantId);
  let companyTotalInjected = 0;
  let companyTotalDrawings = 0;
  let branchTotalInjected = 0;
  let branchTotalDrawings = 0;
  let dayInjections = 0;
  let dayDrawings = 0;

  const visibleEntries = branchId
    ? entries.filter((e) => e.branchId === branchId)
    : entries;

  for (const entry of entries) {
    if (entry.voidedAt) {
      continue;
    }
    const isInjection = entry.entryType === "injection";
    if (isInjection) {
      companyTotalInjected += entry.amount;
    } else {
      companyTotalDrawings += entry.amount;
    }
    if (!branchId || entry.branchId === branchId) {
      if (isInjection) {
        branchTotalInjected += entry.amount;
      } else {
        branchTotalDrawings += entry.amount;
      }
      if (entry.businessDate === businessDate) {
        if (isInjection) {
          dayInjections += entry.amount;
        } else {
          dayDrawings += entry.amount;
        }
      }
    }
  }

  return {
    storageReady,
    branchId,
    businessDate,
    companyTotalInjected: roundMoney(companyTotalInjected),
    companyTotalDrawings: roundMoney(companyTotalDrawings),
    companyNetCapital: roundMoney(companyTotalInjected - companyTotalDrawings),
    branchTotalInjected: roundMoney(branchTotalInjected),
    branchTotalDrawings: roundMoney(branchTotalDrawings),
    branchNetCapital: roundMoney(branchTotalInjected - branchTotalDrawings),
    dayInjections: roundMoney(dayInjections),
    dayDrawings: roundMoney(dayDrawings),
    entries: visibleEntries.slice(0, 100)
  };
}

export async function createBranchCapitalEntry(
  tenantId: string,
  context: RoleContext & { userId: string },
  rawInput: unknown
): Promise<BranchCapitalEntry> {
  if (context.role !== "admin" && context.role !== "accountant") {
    throw new Error("Only admin or accountant can record business capital injections or drawings");
  }

  const input = createBranchCapitalEntrySchema.parse(rawInput);
  if (context.scopeType === "branch" && context.branchId && context.branchId !== input.branchId) {
    throw new Error("Cannot record capital for another branch");
  }

  const amount = roundMoney(input.amount);
  const nameMap = await fetchTenantUserNameMap(tenantId);
  const recorderName = nameMap.get(context.userId) ?? context.userId;
  const id = randomUUID();
  const createdAt = new Date().toISOString();

  const entry: BranchCapitalEntry = {
    id,
    tenantId,
    branchId: input.branchId,
    businessDate: input.businessDate,
    entryType: input.entryType,
    amount,
    source: input.source?.trim() || undefined,
    reference: input.reference?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    recordedBy: context.userId,
    recordedByName: recorderName,
    createdAt
  };

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const list = memoryCapitalEntries.get(tenantId) ?? [];
    memoryCapitalEntries.set(tenantId, [entry, ...list]);
  } else {
    const { error } = await supabase.from("branch_capital_entries").insert({
      id: entry.id,
      tenant_id: entry.tenantId,
      branch_id: entry.branchId,
      business_date: entry.businessDate,
      entry_type: entry.entryType,
      amount: entry.amount,
      source: entry.source ?? null,
      reference: entry.reference ?? null,
      notes: entry.notes ?? null,
      recorded_by: entry.recordedBy,
      recorded_by_name: entry.recordedByName ?? null,
      created_at: entry.createdAt
    });
    if (error) {
      if (isMissingCapitalTable(error.message)) {
        throw new Error(
          "Business capital table is not ready. Apply migration 098_branch_capital_entries.sql in Supabase, then try again."
        );
      }
      throw new Error(`Failed to record capital entry: ${error.message}`);
    }
  }

  const branchLabel = await branchDisplayLabel(tenantId, entry.branchId);
  const verb = entry.entryType === "injection" ? "Capital added" : "Owner drawing recorded";
  try {
    await notifyTenantStaff({
      tenantId,
      roles: ["admin", "accountant", "coordinator"],
      kind: "business_capital_recorded",
      title: verb,
      body: `${branchLabel} · ${entry.businessDate}: GHS ${formatAccountAmount(entry.amount)} (${entry.source || (entry.entryType === "injection" ? "Business capital" : "Owner drawing")}) recorded by ${recorderName}.`
    });
  } catch {
    // Non-blocking
  }

  return entry;
}

export async function voidBranchCapitalEntry(
  tenantId: string,
  context: RoleContext & { userId: string },
  entryId: string,
  rawInput: unknown
): Promise<BranchCapitalEntry> {
  if (context.role !== "admin" && context.role !== "accountant") {
    throw new Error("Only admin or accountant can void capital entries");
  }
  const { reason } = voidBranchCapitalEntrySchema.parse(rawInput);
  const voidedAt = new Date().toISOString();

  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const list = memoryCapitalEntries.get(tenantId) ?? [];
    const idx = list.findIndex((e) => e.id === entryId);
    if (idx < 0) {
      throw new Error("Capital entry not found");
    }
    const existing = list[idx]!;
    if (context.scopeType === "branch" && context.branchId && context.branchId !== existing.branchId) {
      throw new Error("Cannot void capital entry for another branch");
    }
    if (existing.voidedAt) {
      return existing;
    }
    const updated: BranchCapitalEntry = {
      ...existing,
      voidedAt,
      voidedBy: context.userId,
      voidReason: reason
    };
    list[idx] = updated;
    memoryCapitalEntries.set(tenantId, list);
    return updated;
  }

  const { data: existingRow, error: findErr } = await supabase
    .from("branch_capital_entries")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", entryId)
    .maybeSingle();

  if (findErr) {
    throw new Error(`Failed to load capital entry: ${findErr.message}`);
  }
  if (!existingRow) {
    throw new Error("Capital entry not found");
  }
  const existing = mapRow(existingRow as Record<string, unknown>);
  if (context.scopeType === "branch" && context.branchId && context.branchId !== existing.branchId) {
    throw new Error("Cannot void capital entry for another branch");
  }
  if (existing.voidedAt) {
    return existing;
  }

  const { data: updatedRow, error: updErr } = await supabase
    .from("branch_capital_entries")
    .update({
      voided_at: voidedAt,
      voided_by: context.userId,
      void_reason: reason
    })
    .eq("tenant_id", tenantId)
    .eq("id", entryId)
    .select("*")
    .single();

  if (updErr || !updatedRow) {
    throw new Error(`Failed to void capital entry: ${updErr?.message ?? "unknown"}`);
  }

  return mapRow(updatedRow as Record<string, unknown>);
}
