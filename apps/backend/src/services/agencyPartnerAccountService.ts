import {
  createPartnerBankAccountSchema,
  partnerBankAccountSchema,
  validateWorkflowFieldValues,
  workflowFieldsForStage,
  type PartnerBankAccount
} from "@bms/shared";
import type { TransactionRequestContext } from "./transactionService.js";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { assertBranchAccess } from "../middleware/branchScope.js";
import { getCustomerById } from "./customerService.js";
import { getBankProductById } from "./bankProductService.js";
import { listBranches } from "./branchService.js";

const memoryAccounts = new Map<string, PartnerBankAccount[]>();

function mapRow(
  row: Record<string, unknown>,
  extras?: { customerName?: string; branchName?: string; bankProductName?: string; createdByName?: string }
): PartnerBankAccount {
  return partnerBankAccountSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    customerName: extras?.customerName,
    bankProductId: row.bank_product_id != null ? String(row.bank_product_id) : null,
    bankProductName: extras?.bankProductName,
    bankLabel: String(row.bank_label),
    accountNumber: String(row.account_number),
    accountName: String(row.account_name),
    branchId: row.branch_id != null ? String(row.branch_id) : null,
    branchName: extras?.branchName,
    externalReference: row.external_reference != null ? String(row.external_reference) : undefined,
    workflowData: (row.workflow_data as Record<string, unknown>) ?? {},
    status: row.status,
    createdByUserId: String(row.created_by_user_id),
    createdByName: extras?.createdByName,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at ?? row.created_at)
  });
}

export async function listPartnerBankAccounts(
  context: TransactionRequestContext,
  options?: { customerId?: string; branchId?: string }
): Promise<PartnerBankAccount[]> {
  const branchId = options?.branchId;
  if (branchId) {
    assertBranchAccess(context, branchId);
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    let query = supabase
      .from("customer_partner_bank_accounts")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (options?.customerId) {
      query = query.eq("customer_id", options.customerId);
    }
    if (branchId) {
      query = query.eq("branch_id", branchId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to list partner accounts: ${error.message}`);
    }

    const branches = await listBranches(context.tenantId).catch(() => []);
    const branchById = new Map(branches.map((b) => [b.id, b.name]));

    const rows = data ?? [];
    const enriched = await Promise.all(
      rows.map(async (row) => {
        const customer = await getCustomerById(context.tenantId, String(row.customer_id));
        const product =
          row.bank_product_id != null
            ? await getBankProductById(context.tenantId, String(row.bank_product_id))
            : null;
        return mapRow(row as Record<string, unknown>, {
          customerName: customer?.fullName,
          branchName: row.branch_id ? branchById.get(String(row.branch_id)) : undefined,
          bankProductName: product?.name
        });
      })
    );
    return enriched;
  }

  const list = memoryAccounts.get(context.tenantId) ?? [];
  return list.filter((row) => {
    if (options?.customerId && row.customerId !== options.customerId) {
      return false;
    }
    if (branchId && row.branchId && row.branchId !== branchId) {
      return false;
    }
    return true;
  });
}

export async function findPartnerBankAccountByNumber(
  context: TransactionRequestContext,
  accountNumber: string
): Promise<PartnerBankAccount | null> {
  const trimmed = accountNumber.trim();
  if (!trimmed) {
    return null;
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("customer_partner_bank_accounts")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("account_number", trimmed)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to look up partner account: ${error.message}`);
    }
    if (!data) {
      return null;
    }
    const customer = await getCustomerById(context.tenantId, String(data.customer_id));
    const product =
      data.bank_product_id != null
        ? await getBankProductById(context.tenantId, String(data.bank_product_id))
        : null;
    return mapRow(data as Record<string, unknown>, {
      customerName: customer?.fullName,
      bankProductName: product?.name
    });
  }

  const list = memoryAccounts.get(context.tenantId) ?? [];
  const match = list.find(
    (row) => row.status === "active" && row.accountNumber.toLowerCase() === trimmed.toLowerCase()
  );
  return match ?? null;
}

export async function createPartnerBankAccount(
  context: TransactionRequestContext,
  input: unknown
): Promise<PartnerBankAccount> {
  const parsed = createPartnerBankAccountSchema.parse(input);
  const customer = await getCustomerById(context.tenantId, parsed.customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }

  const product = await getBankProductById(context.tenantId, parsed.bankProductId);
  if (!product || product.direction !== "account_opening" || !product.isActive) {
    throw new Error("Select an active account-opening bank product");
  }

  const branchId = parsed.branchId ?? customer.homeBranchId;
  if (branchId) {
    assertBranchAccess(context, branchId);
  }

  const fields = workflowFieldsForStage(product, "account_opening");
  const validation = validateWorkflowFieldValues(
    fields,
    parsed.workflowData ?? {},
    "account_opening"
  );
  if (!validation.ok) {
    throw new Error(validation.errors.join("; "));
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  const row = {
    id,
    tenant_id: context.tenantId,
    customer_id: parsed.customerId,
    bank_product_id: parsed.bankProductId,
    bank_label: product.bankLabel,
    account_number: parsed.accountNumber.trim(),
    account_name: parsed.accountName.trim(),
    branch_id: branchId ?? null,
    external_reference: parsed.externalReference?.trim() ?? null,
    workflow_data: validation.data,
    status: "active",
    created_by_user_id: context.userId,
    created_at: now,
    updated_at: now
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("customer_partner_bank_accounts")
      .insert(row)
      .select("*")
      .single();
    if (error) {
      if (/duplicate key|unique constraint/i.test(error.message)) {
        throw new Error("This account number is already recorded for the selected bank product");
      }
      throw new Error(`Failed to record partner account: ${error.message}`);
    }
    const branches = await listBranches(context.tenantId).catch(() => []);
    return mapRow(data as Record<string, unknown>, {
      customerName: customer.fullName,
      branchName: branchId ? branches.find((b) => b.id === branchId)?.name : undefined,
      bankProductName: product.name
    });
  }

  const account = mapRow(row as unknown as Record<string, unknown>, {
    customerName: customer.fullName,
    bankProductName: product.name
  });
  const list = memoryAccounts.get(context.tenantId) ?? [];
  memoryAccounts.set(context.tenantId, [account, ...list]);
  return account;
}
