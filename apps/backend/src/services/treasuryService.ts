import {
  cashAccountSchema,
  cashMovementSchema,
  createCashMovementSchema,
  trialBalanceLineSchema,
  treasuryBootstrapSchema,
  type CashAccount,
  type CashAccountKind,
  type CashMovement,
  type CreateCashMovementInput,
  type TreasuryBootstrap
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { assertBranchAccess, BranchAccessError } from "../middleware/branchScope.js";
import type { UserContext } from "../types/express.js";

type MemoryAccount = CashAccount;
type MemoryMovement = CashMovement;

const memoryAccounts = new Map<string, MemoryAccount[]>();
const memoryMovements = new Map<string, MemoryMovement[]>();

function accountsKey(tenantId: string, branchId: string): string {
  return `${tenantId}:${branchId}`;
}

function defaultAccounts(tenantId: string, branchId: string, branchName: string): CashAccount[] {
  const now = new Date().toISOString();
  return [
    {
      id: randomUUID(),
      tenantId,
      branchId,
      kind: "vault",
      label: `${branchName} Vault`,
      currency: "GHS",
      balance: 0,
      isActive: true,
      createdAt: now
    },
    {
      id: randomUUID(),
      tenantId,
      branchId,
      kind: "bank",
      label: `${branchName} Bank Account`,
      currency: "GHS",
      balance: 0,
      bankName: "Company Bank",
      isActive: true,
      createdAt: now
    },
    {
      id: randomUUID(),
      tenantId,
      branchId,
      kind: "expense",
      label: `${branchName} Expenses`,
      currency: "GHS",
      balance: 0,
      isActive: true,
      createdAt: now
    },
    {
      id: randomUUID(),
      tenantId,
      branchId,
      kind: "commission",
      label: `${branchName} Commissions`,
      currency: "GHS",
      balance: 0,
      isActive: true,
      createdAt: now
    }
  ];
}

function mapAccountRow(row: Record<string, unknown>): CashAccount {
  return cashAccountSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    kind: row.kind,
    label: row.label,
    currency: row.currency ?? "GHS",
    balance: Number(row.balance ?? 0),
    tellerUserId: row.teller_user_id ?? null,
    bankName: row.bank_name ?? null,
    isActive: row.is_active !== false,
    createdAt: row.created_at ?? new Date().toISOString()
  });
}

function mapMovementRow(row: Record<string, unknown>): CashMovement {
  return cashMovementSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    movementType: row.movement_type,
    fromAccountId: row.from_account_id ?? null,
    toAccountId: row.to_account_id ?? null,
    amount: Number(row.amount),
    notes: row.notes ?? null,
    recordedByUserId: row.recorded_by_user_id,
    businessDate: row.business_date,
    createdAt: row.created_at ?? new Date().toISOString()
  });
}

async function ensureBranchAccounts(
  tenantId: string,
  branchId: string,
  branchLabel: string
): Promise<CashAccount[]> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const key = accountsKey(tenantId, branchId);
    const existing = memoryAccounts.get(key);
    if (existing?.length) {
      return existing;
    }
    const seeded = defaultAccounts(tenantId, branchId, branchLabel);
    memoryAccounts.set(key, seeded);
    return seeded;
  }

  const { data, error } = await supabase
    .from("branch_cash_accounts")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .eq("is_active", true)
    .order("kind", { ascending: true });

  if (error) {
    throw new Error(`Failed to load cash accounts: ${error.message}`);
  }

  if ((data ?? []).length > 0) {
    return (data ?? []).map((row) => mapAccountRow(row));
  }

  const seedRows = defaultAccounts(tenantId, branchId, branchLabel).map((account) => ({
    id: account.id,
    tenant_id: account.tenantId,
    branch_id: account.branchId,
    kind: account.kind,
    label: account.label,
    currency: account.currency,
    balance: account.balance,
    teller_user_id: account.tellerUserId ?? null,
    bank_name: account.bankName ?? null,
    is_active: true
  }));

  const { error: insertError } = await supabase.from("branch_cash_accounts").insert(seedRows);
  if (insertError) {
    throw new Error(`Failed to seed cash accounts: ${insertError.message}`);
  }

  return seedRows.map((row) => mapAccountRow(row));
}

function buildTrialBalance(accounts: CashAccount[]) {
  const lines = accounts.map((account) => {
    const balance = account.balance;
    const debit = balance < 0 ? Math.abs(balance) : 0;
    const credit = balance >= 0 ? balance : 0;
    return trialBalanceLineSchema.parse({
      accountId: account.id,
      label: account.label,
      kind: account.kind,
      debit,
      credit,
      balance
    });
  });
  const totalDebit = lines.reduce((sum, line) => sum + line.debit, 0);
  const totalCredit = lines.reduce((sum, line) => sum + line.credit, 0);
  return {
    lines,
    totalDebit,
    totalCredit,
    isBalanced: Math.abs(totalDebit - totalCredit) < 0.01
  };
}

function branchCashPosition(accounts: CashAccount[]) {
  const vaultCash = accounts
    .filter((a) => a.kind === "vault")
    .reduce((sum, a) => sum + a.balance, 0);
  const tellerCash = accounts
    .filter((a) => a.kind === "teller_drawer")
    .reduce((sum, a) => sum + a.balance, 0);
  const bankCash = accounts
    .filter((a) => a.kind === "bank")
    .reduce((sum, a) => sum + a.balance, 0);
  return {
    vaultCash,
    tellerCash,
    bankCash,
    totalCashPosition: vaultCash + tellerCash + bankCash
  };
}

export async function getTreasuryBootstrap(
  context: UserContext,
  branchId: string,
  branchLabel: string
): Promise<TreasuryBootstrap> {
  assertBranchAccess(context, branchId);
  const accounts = await ensureBranchAccounts(context.tenantId, branchId, branchLabel);

  const supabase = getSupabaseAdminClient();
  let recentMovements: CashMovement[] = [];
  if (supabase) {
    const { data, error } = await supabase
      .from("cash_movements")
      .select("*")
      .eq("tenant_id", context.tenantId)
      .eq("branch_id", branchId)
      .order("created_at", { ascending: false })
      .limit(40);
    if (error) {
      throw new Error(`Failed to load cash movements: ${error.message}`);
    }
    recentMovements = (data ?? []).map((row) => mapMovementRow(row));
  } else {
    recentMovements = (memoryMovements.get(accountsKey(context.tenantId, branchId)) ?? []).slice(0, 40);
  }

  return treasuryBootstrapSchema.parse({
    accounts,
    recentMovements,
    trialBalance: buildTrialBalance(accounts),
    branchCashPosition: branchCashPosition(accounts)
  });
}

function movementAccounts(
  movementType: CreateCashMovementInput["movementType"],
  accounts: CashAccount[],
  input: CreateCashMovementInput
): { fromId: string; toId: string } {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const vault = accounts.find((a) => a.kind === "vault");
  const bank = accounts.find((a) => a.kind === "bank");
  const expense = accounts.find((a) => a.kind === "expense");
  const commission = accounts.find((a) => a.kind === "commission");

  if (movementType === "vault_to_teller") {
    const to = input.toAccountId ? byId.get(input.toAccountId) : undefined;
    if (!vault || !to || to.kind !== "teller_drawer") {
      throw new Error("Select a teller drawer account for vault → teller transfer");
    }
    return { fromId: vault.id, toId: to.id };
  }
  if (movementType === "teller_to_vault") {
    const from = input.fromAccountId ? byId.get(input.fromAccountId) : undefined;
    if (!vault || !from || from.kind !== "teller_drawer") {
      throw new Error("Select a teller drawer account for teller → vault transfer");
    }
    return { fromId: from.id, toId: vault.id };
  }
  if (movementType === "vault_to_bank") {
    if (!vault || !bank) {
      throw new Error("Vault and bank accounts are required");
    }
    return { fromId: vault.id, toId: bank.id };
  }
  if (movementType === "bank_to_vault") {
    if (!vault || !bank) {
      throw new Error("Vault and bank accounts are required");
    }
    return { fromId: bank.id, toId: vault.id };
  }
  if (movementType === "expense") {
    const from = input.fromAccountId ? byId.get(input.fromAccountId) : vault;
    if (!from || !expense) {
      throw new Error("Expense account is required");
    }
    return { fromId: from.id, toId: expense.id };
  }
  if (movementType === "commission") {
    const from = input.fromAccountId ? byId.get(input.fromAccountId) : vault;
    if (!from || !commission) {
      throw new Error("Commission account is required");
    }
    return { fromId: from.id, toId: commission.id };
  }
  throw new Error("Unsupported movement type");
}

async function applyMovementBalances(
  tenantId: string,
  branchId: string,
  fromId: string,
  toId: string,
  amount: number
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const key = accountsKey(tenantId, branchId);
    const accounts = memoryAccounts.get(key) ?? [];
    for (const account of accounts) {
      if (account.id === fromId) {
        account.balance = Math.max(0, account.balance - amount);
      }
      if (account.id === toId) {
        account.balance += amount;
      }
    }
    memoryAccounts.set(key, accounts);
    return;
  }

  const { data: rows, error } = await supabase
    .from("branch_cash_accounts")
    .select("id, balance")
    .eq("tenant_id", tenantId)
    .eq("branch_id", branchId)
    .in("id", [fromId, toId]);

  if (error || !rows || rows.length !== 2) {
    throw new Error("Could not load accounts for movement");
  }

  const fromRow = rows.find((r) => r.id === fromId);
  const toRow = rows.find((r) => r.id === toId);
  if (!fromRow || !toRow) {
    throw new Error("Movement accounts not found");
  }
  const fromBalance = Number(fromRow.balance);
  if (fromBalance < amount) {
    throw new Error("Insufficient balance in source account");
  }

  const now = new Date().toISOString();
  const { error: fromError } = await supabase
    .from("branch_cash_accounts")
    .update({ balance: fromBalance - amount, updated_at: now })
    .eq("id", fromId);
  if (fromError) {
    throw new Error(`Failed to debit source account: ${fromError.message}`);
  }

  const { error: toError } = await supabase
    .from("branch_cash_accounts")
    .update({ balance: Number(toRow.balance) + amount, updated_at: now })
    .eq("id", toId);
  if (toError) {
    throw new Error(`Failed to credit destination account: ${toError.message}`);
  }
}

export async function createCashMovement(
  context: UserContext,
  input: unknown,
  branchLabel: string
): Promise<TreasuryBootstrap> {
  const parsed = createCashMovementSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid cash movement");
  }
  const body = parsed.data;
  assertBranchAccess(context, body.branchId);

  const accounts = await ensureBranchAccounts(context.tenantId, body.branchId, branchLabel);
  const { fromId, toId } = movementAccounts(body.movementType, accounts, body);
  const businessDate = body.businessDate ?? new Date().toISOString().slice(0, 10);
  const movementId = randomUUID();

  await applyMovementBalances(context.tenantId, body.branchId, fromId, toId, body.amount);

  const movement: CashMovement = {
    id: movementId,
    tenantId: context.tenantId,
    branchId: body.branchId,
    movementType: body.movementType,
    fromAccountId: fromId,
    toAccountId: toId,
    amount: body.amount,
    notes: body.notes ?? null,
    recordedByUserId: context.userId,
    businessDate,
    createdAt: new Date().toISOString()
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("cash_movements").insert({
      id: movement.id,
      tenant_id: movement.tenantId,
      branch_id: movement.branchId,
      movement_type: movement.movementType,
      from_account_id: movement.fromAccountId,
      to_account_id: movement.toAccountId,
      amount: movement.amount,
      notes: movement.notes,
      recorded_by_user_id: movement.recordedByUserId,
      business_date: movement.businessDate
    });
    if (error) {
      throw new Error(`Failed to record cash movement: ${error.message}`);
    }
  } else {
    const key = accountsKey(context.tenantId, body.branchId);
    const list = memoryMovements.get(key) ?? [];
    memoryMovements.set(key, [movement, ...list]);
  }

  return getTreasuryBootstrap(context, body.branchId, branchLabel);
}

export async function ensureTellerDrawerAccount(
  tenantId: string,
  branchId: string,
  branchLabel: string,
  tellerUserId: string,
  tellerName: string
): Promise<CashAccount> {
  const accounts = await ensureBranchAccounts(tenantId, branchId, branchLabel);
  const existing = accounts.find((a) => a.kind === "teller_drawer" && a.tellerUserId === tellerUserId);
  if (existing) {
    return existing;
  }

  const account: CashAccount = {
    id: randomUUID(),
    tenantId,
    branchId,
    kind: "teller_drawer" as CashAccountKind,
    label: `${tellerName} Drawer`,
    currency: "GHS",
    balance: 0,
    tellerUserId,
    isActive: true,
    createdAt: new Date().toISOString()
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("branch_cash_accounts").insert({
      id: account.id,
      tenant_id: account.tenantId,
      branch_id: account.branchId,
      kind: account.kind,
      label: account.label,
      currency: account.currency,
      balance: account.balance,
      teller_user_id: account.tellerUserId,
      is_active: true
    });
    if (error) {
      throw new Error(`Failed to create teller drawer account: ${error.message}`);
    }
  } else {
    const key = accountsKey(tenantId, branchId);
    memoryAccounts.set(key, [...accounts, account]);
  }

  return account;
}
