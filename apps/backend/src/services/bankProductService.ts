import {
  bankProductSchema,
  createBankProductSchema,
  normalizeBankProductCode,
  suggestBankProductCode,
  bankProductAppliesToBranch,
  workflowFieldsSchema,
  type BankProductDirection,
  type TenantBankProduct,
  updateBankProductSchema
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { listBranches } from "./branchService.js";

const memoryProducts = new Map<string, TenantBankProduct[]>();

type ListOptions = {
  direction?: BankProductDirection;
  activeOnly?: boolean;
  /** When set, returns tenant-wide products plus products for this branch. */
  branchId?: string;
};

function normalizeBranchFilter(branchId?: string | null): string | undefined {
  const trimmed = branchId?.trim();
  if (!trimmed || trimmed.toLowerCase() === "all") {
    return undefined;
  }
  return trimmed;
}

function rowToProduct(row: Record<string, unknown>, branchName?: string): TenantBankProduct {
  return bankProductSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    branchId: row.branch_id != null ? String(row.branch_id) : null,
    branchName,
    name: String(row.name),
    code: String(row.code),
    direction: row.direction,
    bankLabel: String(row.bank_label),
    isActive: row.is_active !== false,
    sortOrder: Number(row.sort_order ?? 0),
    workflowFields: workflowFieldsSchema.parse(row.workflow_fields ?? []),
    isCompanyBankAccount: row.is_company_bank_account === true,
    executionLimitAmount:
      row.execution_limit_amount != null ? Number(row.execution_limit_amount) : null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at)
  });
}

function memoryForTenant(tenantId: string): TenantBankProduct[] {
  if (!memoryProducts.has(tenantId)) {
    memoryProducts.set(tenantId, []);
  }
  return memoryProducts.get(tenantId)!;
}

function filterProducts(products: TenantBankProduct[], options?: ListOptions): TenantBankProduct[] {
  const branchFilter = normalizeBranchFilter(options?.branchId);
  return products.filter((p) => {
    if (options?.direction && p.direction !== options.direction) {
      return false;
    }
    if (options?.activeOnly && !p.isActive) {
      return false;
    }
    if (branchFilter && !bankProductAppliesToBranch(p, branchFilter)) {
      return false;
    }
    return true;
  });
}

async function resolveBranchName(tenantId: string, branchId: string | null | undefined): Promise<string | undefined> {
  if (!branchId) {
    return undefined;
  }
  const branches = await listBranches(tenantId);
  return branches.find((b) => b.id === branchId)?.name;
}

async function assertBranchBelongsToTenant(tenantId: string, branchId: string | null | undefined): Promise<void> {
  if (!branchId) {
    return;
  }
  const branches = await listBranches(tenantId);
  const branch = branches.find((b) => b.id === branchId && b.status !== "inactive");
  if (!branch) {
    throw new Error("Selected branch was not found or is inactive");
  }
}

function codeTaken(
  products: TenantBankProduct[],
  code: string,
  branchId: string | null | undefined,
  excludeId?: string
): boolean {
  return products.some(
    (p) =>
      p.id !== excludeId &&
      p.code === code &&
      (p.branchId ?? null) === (branchId ?? null)
  );
}

async function ensureUniqueCode(
  tenantId: string,
  branchId: string | null | undefined,
  baseCode: string,
  excludeId?: string
): Promise<string> {
  const products = await listBankProducts(tenantId);
  let code = normalizeBankProductCode(baseCode);
  if (!code) {
    code = "product";
  }
  if (!codeTaken(products, code, branchId, excludeId)) {
    return code;
  }
  for (let n = 2; n < 100; n++) {
    const candidate = normalizeBankProductCode(`${baseCode}_${n}`);
    if (!codeTaken(products, candidate, branchId, excludeId)) {
      return candidate;
    }
  }
  return normalizeBankProductCode(`${baseCode}_${randomUUID().slice(0, 6)}`);
}

export async function listBankProducts(
  tenantId: string,
  options?: ListOptions
): Promise<TenantBankProduct[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let query = supabase
      .from("tenant_bank_products")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });
    if (options?.direction) {
      query = query.eq("direction", options.direction);
    }
    if (options?.activeOnly) {
      query = query.eq("is_active", true);
    }
    const { data, error } = await query;
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        return filterProducts(memoryForTenant(tenantId), options);
      }
      throw new Error(`Failed to list bank products: ${error.message}`);
    }

    const branches = await listBranches(tenantId).catch(() => []);
    const branchById = new Map(branches.map((b) => [b.id, b.name]));

    const mapped = (data ?? []).map((row) =>
      rowToProduct(row as Record<string, unknown>, branchById.get(String(row.branch_id ?? "")))
    );
    return filterProducts(mapped, options);
  }
  return filterProducts(memoryForTenant(tenantId), options);
}

export async function getBankProductById(
  tenantId: string,
  productId: string,
  branchId?: string
): Promise<TenantBankProduct | null> {
  const branchFilter = normalizeBranchFilter(branchId);
  const products = await listBankProducts(tenantId, branchFilter ? { branchId: branchFilter } : undefined);
  return products.find((p) => p.id === productId) ?? null;
}

function formatZodError(error: unknown): string {
  if (error && typeof error === "object" && "errors" in error) {
    const first = (error as { errors: Array<{ message?: string }> }).errors[0];
    if (first?.message) {
      return first.message;
    }
  }
  return "Invalid bank product data";
}

export async function createBankProduct(tenantId: string, input: unknown): Promise<TenantBankProduct[]> {
  const parsed = createBankProductSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }
  const payload = parsed.data;
  const directions =
    payload.direction === "both" ? (["deposit", "withdrawal"] as const) : [payload.direction];

  const created: TenantBankProduct[] = [];
  for (const direction of directions) {
    created.push(
      await createSingleBankProduct(tenantId, {
        ...payload,
        direction,
        workflowFields: payload.workflowFields
      })
    );
  }
  return created;
}

async function createSingleBankProduct(
  tenantId: string,
  payload: {
    name: string;
    code?: string;
    direction: BankProductDirection;
    bankLabel: string;
    branchId?: string | null;
    isActive?: boolean;
    sortOrder?: number;
    workflowFields?: TenantBankProduct["workflowFields"];
    isCompanyBankAccount?: boolean;
    executionLimitAmount?: number | null;
  }
): Promise<TenantBankProduct> {
  const branchId = payload.branchId ?? null;
  await assertBranchBelongsToTenant(tenantId, branchId ?? undefined);

  const branches = await listBranches(tenantId);
  const branchCode = branchId ? branches.find((b) => b.id === branchId)?.code : undefined;

  let code = normalizeBankProductCode(payload.code ?? "");
  if (code.length < 2) {
    code = suggestBankProductCode({
      bankLabel: payload.bankLabel,
      name: payload.name,
      direction: payload.direction,
      branchCode
    });
  }
  code = await ensureUniqueCode(tenantId, branchId, code);

  const now = new Date().toISOString();
  const branchName = branchId ? branches.find((b) => b.id === branchId)?.name : undefined;
  const product = bankProductSchema.parse({
    id: randomUUID(),
    tenantId,
    branchId,
    branchName,
    name: payload.name.trim(),
    code,
    direction: payload.direction,
    bankLabel: payload.bankLabel.trim(),
    isActive: payload.isActive ?? true,
    sortOrder: payload.sortOrder ?? 0,
    workflowFields: payload.workflowFields ?? [],
    isCompanyBankAccount: payload.isCompanyBankAccount ?? false,
    executionLimitAmount: payload.executionLimitAmount ?? null,
    createdAt: now,
    updatedAt: now
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_bank_products")
      .insert({
        id: product.id,
        tenant_id: tenantId,
        branch_id: branchId,
        name: product.name,
        code: product.code,
        direction: product.direction,
        bank_label: product.bankLabel,
        is_active: product.isActive,
        sort_order: product.sortOrder,
        workflow_fields: product.workflowFields,
        is_company_bank_account: product.isCompanyBankAccount,
        execution_limit_amount: product.executionLimitAmount
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        memoryForTenant(tenantId).push(product);
        return product;
      }
      if (/duplicate key|unique constraint/i.test(error.message)) {
        throw new Error("A product with this code already exists for the selected branch scope");
      }
      throw new Error(`Failed to create bank product: ${error.message}`);
    }
    return rowToProduct(data as Record<string, unknown>, branchName);
  }

  memoryForTenant(tenantId).push(product);
  return product;
}

export async function updateBankProduct(
  tenantId: string,
  productId: string,
  input: unknown
): Promise<TenantBankProduct> {
  const parsed = updateBankProductSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(formatZodError(parsed.error));
  }
  const payload = parsed.data;

  const existing = (await listBankProducts(tenantId)).find((p) => p.id === productId);
  if (!existing) {
    throw new Error("Bank product not found");
  }

  const branchId =
    payload.branchId !== undefined ? (payload.branchId ?? null) : (existing.branchId ?? null);
  await assertBranchBelongsToTenant(tenantId, branchId ?? undefined);

  const branches = await listBranches(tenantId);
  const branchCode = branchId ? branches.find((b) => b.id === branchId)?.code : undefined;
  const branchName = branchId ? branches.find((b) => b.id === branchId)?.name : undefined;

  const nextName = payload.name?.trim() ?? existing.name;
  const nextBankLabel = payload.bankLabel?.trim() ?? existing.bankLabel;
  const nextDirection = payload.direction ?? existing.direction;

  let nextCode = payload.code ? normalizeBankProductCode(payload.code) : existing.code;
  if (nextCode.length < 2) {
    nextCode = suggestBankProductCode({
      bankLabel: nextBankLabel,
      name: nextName,
      direction: nextDirection,
      branchCode
    });
  }
  if (nextCode !== existing.code || branchId !== (existing.branchId ?? null)) {
    nextCode = await ensureUniqueCode(tenantId, branchId, nextCode, productId);
  }

  const updated = bankProductSchema.parse({
    ...existing,
    branchId,
    branchName,
    name: nextName,
    code: nextCode,
    direction: nextDirection,
    bankLabel: nextBankLabel,
    isActive: payload.isActive ?? existing.isActive,
    sortOrder: payload.sortOrder ?? existing.sortOrder,
    workflowFields: payload.workflowFields ?? existing.workflowFields,
    isCompanyBankAccount: payload.isCompanyBankAccount ?? existing.isCompanyBankAccount,
    executionLimitAmount:
      payload.executionLimitAmount !== undefined
        ? payload.executionLimitAmount
        : existing.executionLimitAmount,
    updatedAt: new Date().toISOString()
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("tenant_bank_products")
      .update({
        branch_id: branchId,
        name: updated.name,
        code: updated.code,
        direction: updated.direction,
        bank_label: updated.bankLabel,
        is_active: updated.isActive,
        sort_order: updated.sortOrder,
        workflow_fields: updated.workflowFields,
        is_company_bank_account: updated.isCompanyBankAccount,
        execution_limit_amount: updated.executionLimitAmount,
        updated_at: updated.updatedAt
      })
      .eq("tenant_id", tenantId)
      .eq("id", productId)
      .select("*")
      .single();
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        const list = memoryForTenant(tenantId);
        const idx = list.findIndex((p) => p.id === productId);
        if (idx >= 0) {
          list[idx] = updated;
        }
        return updated;
      }
      if (/duplicate key|unique constraint/i.test(error.message)) {
        throw new Error("A product with this code already exists for the selected branch scope");
      }
      throw new Error(`Failed to update bank product: ${error.message}`);
    }
    return rowToProduct(data as Record<string, unknown>, branchName);
  }

  const list = memoryForTenant(tenantId);
  const idx = list.findIndex((p) => p.id === productId);
  if (idx >= 0) {
    list[idx] = updated;
  }
  return updated;
}

function directionForTransactionType(type: string): BankProductDirection | null {
  if (type === "deposit") {
    return "deposit";
  }
  if (type === "withdrawal") {
    return "withdrawal";
  }
  return null;
}

/** Validates bank product for deposit/withdrawal; required when tenant has active products for that direction at the branch. */
export async function resolveBankProductForTransaction(
  tenantId: string,
  type: string,
  bankProductId?: string,
  branchId?: string
): Promise<string | undefined> {
  const direction = directionForTransactionType(type);
  if (!direction) {
    return undefined;
  }

  const branchFilter = normalizeBranchFilter(branchId);
  const active = await listBankProducts(tenantId, { direction, activeOnly: true, branchId: branchFilter });
  if (active.length === 0) {
    return bankProductId;
  }

  if (!bankProductId) {
    throw new Error(`Select a ${direction} bank product before posting this transaction`);
  }

  const product = active.find((p) => p.id === bankProductId);
  if (!product) {
    throw new Error("Invalid or inactive bank product for this branch and transaction type");
  }

  return product.id;
}

export async function resolveBankProductForWithdrawalApproval(
  tenantId: string,
  bankProductId?: string,
  branchId?: string
): Promise<string | undefined> {
  const branchFilter = normalizeBranchFilter(branchId);
  const active = await listBankProducts(tenantId, {
    direction: "withdrawal",
    activeOnly: true,
    branchId: branchFilter
  });
  if (active.length === 0) {
    return bankProductId;
  }
  if (!bankProductId) {
    throw new Error("Select a withdrawal bank product before debiting the customer account");
  }
  const product = active.find((p) => p.id === bankProductId);
  if (!product) {
    throw new Error("Invalid or inactive withdrawal bank product for this branch");
  }
  return product.id;
}

export async function enrichTransactionsWithBankProducts<
  T extends { bankProductId?: string; bankProductName?: string; bankLabel?: string }
>(tenantId: string, rows: T[]): Promise<T[]> {
  const productIds = [...new Set(rows.map((r) => r.bankProductId).filter(Boolean))] as string[];
  if (productIds.length === 0) {
    return rows;
  }
  const products = await listBankProducts(tenantId);
  const byId = new Map(products.map((p) => [p.id, p]));
  return rows.map((row) => {
    if (!row.bankProductId) {
      return row;
    }
    const product = byId.get(row.bankProductId);
    if (!product) {
      return row;
    }
    return {
      ...row,
      bankProductName: product.name,
      bankLabel: product.bankLabel
    };
  });
}
