import {
  approveCustomerRequestSchema,
  balanceDisclosureSchema,
  rejectBalanceDisclosureSchema,
  requestCustomerApprovalSchema,
  type BalanceDisclosure,
  type CustomerRequestType
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import {
  getCustomerById,
  getCustomerWithdrawableBalance,
  listCustomers
} from "./customerService.js";
import { computeCustomerBalance } from "./ledgerService.js";
import { createAgentNotification, notifyTenantStaff } from "./notificationService.js";
import {
  postWithdrawalForApprovedDisclosure,
  type TransactionRequestContext
} from "./transactionService.js";

const DEFAULT_VISIBLE_HOURS = 6;

function resolveVisibleMs(visibleHours: number | undefined): number {
  const hours = visibleHours ?? DEFAULT_VISIBLE_HOURS;
  return hours * 60 * 60 * 1000;
}

function formatVisibleDuration(visibleHours: number): string {
  if (visibleHours < 1) {
    const mins = Math.round(visibleHours * 60);
    return `${mins} minute${mins === 1 ? "" : "s"}`;
  }
  if (Number.isInteger(visibleHours)) {
    return `${visibleHours} hour${visibleHours === 1 ? "" : "s"}`;
  }
  return `${visibleHours} hours`;
}

type DisclosureRow = {
  id: string;
  tenant_id: string;
  customer_id: string;
  field_agent_id: string;
  request_type: CustomerRequestType;
  status: string;
  balance_amount: number | null;
  withdrawal_amount: number | null;
  fulfillment_mode: string | null;
  requested_at: string;
  approved_at: string | null;
  expires_at: string | null;
  approved_by: string | null;
  request_reason: string | null;
  rejected_reason: string | null;
  momo_number: string | null;
  momo_account_name: string | null;
  payout_reference: string | null;
  transaction_proof_image: string | null;
  generated_receipt_image: string | null;
  paid_at: string | null;
};

const DISCLOSURE_COLUMNS =
  "id, tenant_id, customer_id, field_agent_id, request_type, status, balance_amount, withdrawal_amount, fulfillment_mode, requested_at, approved_at, expires_at, approved_by, request_reason, rejected_reason, momo_number, momo_account_name, payout_reference, transaction_proof_image, generated_receipt_image, paid_at";

const memoryDisclosures = new Map<string, DisclosureRow[]>();

function disclosureDbError(action: string, message: string): Error {
  const lower = message.toLowerCase();
  if (lower.includes("request_type") || lower.includes("withdrawal_amount")) {
    return new Error(
      `${action}: run Supabase migration 019_customer_request_withdrawals.sql.`
    );
  }
  if (lower.includes("request_reason")) {
    return new Error(
      `${action}: run Supabase migration 018_balance_disclosure_request_reason.sql.`
    );
  }
  if (lower.includes("customer_balance_disclosures")) {
    return new Error(
      `${action}: run Supabase migration 017_customer_balance_disclosures.sql.`
    );
  }
  if (
    lower.includes("momo_number") ||
    lower.includes("transaction_proof") ||
    lower.includes("image_url")
  ) {
    return new Error(`${action}: run Supabase migration 020_momo_withdrawal_receipts.sql.`);
  }
  if (lower.includes("agent_notifications_kind_check")) {
    return new Error(
      `${action}: re-run migration 017, 019, or 020 for notification kinds in Supabase.`
    );
  }
  return new Error(`${action}: ${message}`);
}

function tenantKey(tenantId: string): string {
  return tenantId;
}

function getMemoryList(tenantId: string): DisclosureRow[] {
  return memoryDisclosures.get(tenantKey(tenantId)) ?? [];
}

function setMemoryList(tenantId: string, rows: DisclosureRow[]): void {
  memoryDisclosures.set(tenantKey(tenantId), rows);
}

function mapRow(
  row: DisclosureRow,
  extras?: { customerName?: string; fieldAgentName?: string }
): BalanceDisclosure {
  return balanceDisclosureSchema.parse({
    id: row.id,
    tenantId: row.tenant_id,
    customerId: row.customer_id,
    fieldAgentId: row.field_agent_id,
    customerName: extras?.customerName,
    fieldAgentName: extras?.fieldAgentName,
    requestType: row.request_type ?? "balance",
    status: row.status,
    balanceAmount: row.balance_amount != null ? Number(row.balance_amount) : undefined,
    withdrawalAmount:
      row.withdrawal_amount != null ? Number(row.withdrawal_amount) : undefined,
    fulfillmentMode: row.fulfillment_mode ?? undefined,
    requestedAt: row.requested_at,
    approvedAt: row.approved_at ?? undefined,
    expiresAt: row.expires_at ?? undefined,
    requestReason: row.request_reason ?? undefined,
    rejectedReason: row.rejected_reason ?? undefined,
    momoNumber: row.momo_number ?? undefined,
    momoAccountName: row.momo_account_name ?? undefined,
    payoutReference: row.payout_reference ?? undefined,
    transactionProofImage: row.transaction_proof_image ?? undefined,
    generatedReceiptImage: row.generated_receipt_image ?? undefined,
    paidAt: row.paid_at ?? undefined
  });
}

function isVisibleBalanceApproval(row: DisclosureRow, now = Date.now()): boolean {
  if (row.request_type !== "balance") {
    return false;
  }
  if (row.status !== "approved" || row.balance_amount == null || !row.expires_at) {
    return false;
  }
  return new Date(row.expires_at).getTime() > now;
}

function isActiveWithdrawalApproval(row: DisclosureRow): boolean {
  return row.request_type === "withdrawal" && row.status === "approved";
}

async function expireStaleBalanceRows(tenantId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const now = new Date().toISOString();
  if (supabase) {
    await supabase
      .from("customer_balance_disclosures")
      .update({ status: "expired" })
      .eq("tenant_id", tenantId)
      .eq("request_type", "balance")
      .eq("status", "approved")
      .lt("expires_at", now);
    return;
  }

  const rows = getMemoryList(tenantId);
  let changed = false;
  for (const row of rows) {
    if (
      row.request_type === "balance" &&
      row.status === "approved" &&
      row.expires_at &&
      new Date(row.expires_at).getTime() <= Date.now()
    ) {
      row.status = "expired";
      changed = true;
    }
  }
  if (changed) {
    setMemoryList(tenantId, rows);
  }
}

async function fetchRowsForAgent(tenantId: string, fieldAgentId: string): Promise<DisclosureRow[]> {
  await expireStaleBalanceRows(tenantId);
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("customer_balance_disclosures")
      .select(DISCLOSURE_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("field_agent_id", fieldAgentId)
      .order("requested_at", { ascending: false });
    if (error) {
      throw disclosureDbError("Failed to load customer requests", error.message);
    }
    return (data ?? []).map((r) => ({
      ...r,
      request_type: (r.request_type ?? "balance") as CustomerRequestType
    })) as DisclosureRow[];
  }

  return getMemoryList(tenantId).filter((r) => r.field_agent_id === fieldAgentId);
}

async function fetchPendingForTenant(tenantId: string): Promise<DisclosureRow[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("customer_balance_disclosures")
      .select(DISCLOSURE_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("status", "pending")
      .order("requested_at", { ascending: true });
    if (error) {
      throw disclosureDbError("Failed to load pending requests", error.message);
    }
    return (data ?? []).map((r) => ({
      ...r,
      request_type: (r.request_type ?? "balance") as CustomerRequestType
    })) as DisclosureRow[];
  }

  return getMemoryList(tenantId).filter((r) => r.status === "pending");
}

async function getRowById(tenantId: string, id: string): Promise<DisclosureRow | undefined> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("customer_balance_disclosures")
      .select(DISCLOSURE_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("id", id)
      .maybeSingle();
    if (error) {
      throw disclosureDbError("Failed to load customer request", error.message);
    }
    if (!data) {
      return undefined;
    }
    return {
      ...data,
      request_type: (data.request_type ?? "balance") as CustomerRequestType
    } as DisclosureRow;
  }

  return getMemoryList(tenantId).find((r) => r.id === id);
}

async function reconcileApprovedWithdrawalDebit(
  tenantId: string,
  row: DisclosureRow,
  customer: NonNullable<Awaited<ReturnType<typeof getCustomerById>>>
): Promise<void> {
  if (row.request_type !== "withdrawal" || row.status !== "approved") {
    return;
  }
  const amount = Number(row.withdrawal_amount ?? 0);
  if (amount <= 0) {
    return;
  }
  try {
    await postWithdrawalForApprovedDisclosure({
      tenantId,
      customerId: row.customer_id,
      homeBranchId: customer.homeBranchId,
      amount,
      disclosureId: row.id,
      recordedByUserId: row.approved_by ?? row.field_agent_id,
      fieldAgentId: row.field_agent_id,
      notes: withdrawalApprovalNotes(row.id, row.fulfillment_mode, row.payout_reference)
    });
  } catch (error) {
    console.warn(
      `[balanceDisclosure] Could not reconcile withdrawal debit for disclosure ${row.id}:`,
      error instanceof Error ? error.message : error
    );
  }
}

async function enrichDisclosures(
  tenantId: string,
  rows: DisclosureRow[]
): Promise<BalanceDisclosure[]> {
  const result: BalanceDisclosure[] = [];
  for (const row of rows) {
    const customer = await getCustomerById(tenantId, row.customer_id);
    if (customer) {
      await reconcileApprovedWithdrawalDebit(tenantId, row, customer);
    }
    result.push(
      mapRow(row, {
        customerName: customer?.fullName,
        fieldAgentName: customer?.assignedFieldAgentName ?? customer?.createdByFieldAgentName
      })
    );
  }
  return result;
}

async function assertAgentOwnsCustomer(
  tenantId: string,
  fieldAgentId: string,
  customerId: string
) {
  const customer = await getCustomerById(tenantId, customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }
  if (customer.status !== "active") {
    throw new Error("Requests are only allowed for active customers");
  }
  if (
    customer.assignedFieldAgentId !== fieldAgentId &&
    customer.createdByFieldAgentId !== fieldAgentId
  ) {
    throw new Error("Customer is not assigned to you");
  }
  return customer;
}

export async function requestCustomerApproval(
  tenantId: string,
  fieldAgentId: string,
  customerId: string,
  input: unknown
): Promise<BalanceDisclosure> {
  const payload = requestCustomerApprovalSchema.parse(input ?? {});
  if (payload.type === "withdrawal" && payload.fulfillmentMode === "momo") {
    if (!payload.momoNumber?.trim() || !payload.momoAccountName?.trim()) {
      throw new Error("MoMo number and account name are required for MoMo withdrawals");
    }
  }
  const customer = await assertAgentOwnsCustomer(tenantId, fieldAgentId, customerId);

  const existing = await fetchRowsForAgent(tenantId, fieldAgentId);
  const forCustomer = existing.filter((r) => r.customer_id === customerId);
  const pendingSameType = forCustomer.find(
    (r) => r.status === "pending" && r.request_type === payload.type
  );
  if (pendingSameType) {
    return mapRow(pendingSameType, { customerName: customer.fullName });
  }

  if (payload.type === "balance") {
    const visible = forCustomer.find((r) => isVisibleBalanceApproval(r));
    if (visible) {
      throw new Error("Balance is already visible. Wait until the coordinator's visibility window ends.");
    }
  } else {
    const activeWithdrawal = forCustomer.find((r) => isActiveWithdrawalApproval(r));
    if (activeWithdrawal) {
      throw new Error(
        "A withdrawal is already approved for this customer. Pay out or wait for coordinator to clear it before requesting again."
      );
    }
    const withdrawable = await getCustomerWithdrawableBalance(tenantId, customerId);
    if (payload.amount > withdrawable) {
      throw new Error(
        `Withdrawal exceeds available funds. Withdrawable: GHS ${withdrawable.toFixed(2)} (opening deposit cannot be withdrawn).`
      );
    }
  }

  const id = randomUUID();
  const requestedAt = new Date().toISOString();
  const row: DisclosureRow = {
    id,
    tenant_id: tenantId,
    customer_id: customerId,
    field_agent_id: fieldAgentId,
    request_type: payload.type,
    status: "pending",
    balance_amount: null,
    withdrawal_amount: payload.type === "withdrawal" ? payload.amount : null,
    fulfillment_mode: payload.type === "withdrawal" ? payload.fulfillmentMode : null,
    requested_at: requestedAt,
    approved_at: null,
    expires_at: null,
    approved_by: null,
    request_reason: payload.reason,
    rejected_reason: null,
    momo_number: payload.type === "withdrawal" && payload.fulfillmentMode === "momo" ? payload.momoNumber!.trim() : null,
    momo_account_name:
      payload.type === "withdrawal" && payload.fulfillmentMode === "momo"
        ? payload.momoAccountName!.trim()
        : null,
    payout_reference: null,
    transaction_proof_image: null,
    generated_receipt_image: null,
    paid_at: null
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("customer_balance_disclosures").insert({
      id: row.id,
      tenant_id: row.tenant_id,
      customer_id: row.customer_id,
      field_agent_id: row.field_agent_id,
      request_type: row.request_type,
      status: row.status,
      withdrawal_amount: row.withdrawal_amount,
      fulfillment_mode: row.fulfillment_mode,
      requested_at: row.requested_at,
      request_reason: row.request_reason,
      momo_number: row.momo_number,
      momo_account_name: row.momo_account_name
    });
    if (error) {
      throw disclosureDbError("Failed to submit request", error.message);
    }
  } else {
    setMemoryList(tenantId, [row, ...getMemoryList(tenantId)]);
  }

  const pendingKind =
    payload.type === "withdrawal" ? "withdrawal_request_pending" : "balance_request_pending";
  const pendingTitle =
    payload.type === "withdrawal" ? "Withdrawal pending approval" : "Balance request pending";
  const amountLine =
    payload.type === "withdrawal" && payload.amount != null
      ? ` GHS ${payload.amount.toFixed(2)}`
      : "";
  try {
    const staffRoles =
      payload.type === "withdrawal"
        ? payload.fulfillmentMode === "momo"
          ? (["customer_service", "coordinator", "admin"] as const)
          : (["customer_service", "admin"] as const)
        : (["customer_service", "admin"] as const);
    await notifyTenantStaff({
      tenantId,
      roles: [...staffRoles],
      kind: pendingKind,
      customerId,
      title: pendingTitle,
      body:
        payload.type === "withdrawal" && payload.fulfillmentMode !== "momo"
          ? `${customer.fullName}${amountLine} — Customer Service verifies under Susu → Withdrawals.`
          : `${customer.fullName}${amountLine} — review in Pending approvals.`
    });
  } catch {
    // Non-blocking
  }

  return mapRow(row, { customerName: customer.fullName });
}

/** @deprecated Use requestCustomerApproval */
export async function requestCustomerBalanceDisclosure(
  tenantId: string,
  fieldAgentId: string,
  customerId: string,
  input: unknown
): Promise<BalanceDisclosure> {
  const body =
    typeof input === "object" && input !== null && "type" in input
      ? input
      : { type: "balance" as const, ...(input as object) };
  return requestCustomerApproval(tenantId, fieldAgentId, customerId, body);
}

function latestPerCustomerAndType(rows: DisclosureRow[]): DisclosureRow[] {
  const latest = new Map<string, DisclosureRow>();
  for (const row of rows) {
    const key = `${row.customer_id}:${row.request_type}`;
    if (!latest.has(key)) {
      latest.set(key, row);
    }
  }
  return [...latest.values()];
}

export async function listAgentBalanceDisclosures(
  tenantId: string,
  fieldAgentId: string
): Promise<BalanceDisclosure[]> {
  const rows = await fetchRowsForAgent(tenantId, fieldAgentId);
  const visibleOrActionable = latestPerCustomerAndType(rows).filter((r) => {
    if (r.status === "pending" || r.status === "rejected") {
      return true;
    }
    if (r.request_type === "balance") {
      return isVisibleBalanceApproval(r);
    }
    return isActiveWithdrawalApproval(r);
  });
  return enrichDisclosures(tenantId, visibleOrActionable);
}

export async function listPendingBalanceDisclosures(tenantId: string): Promise<BalanceDisclosure[]> {
  const rows = await fetchPendingForTenant(tenantId);
  return enrichDisclosures(tenantId, rows);
}

async function fetchWithdrawalsForTenant(tenantId: string, limit = 300): Promise<DisclosureRow[]> {
  await expireStaleBalanceRows(tenantId);
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("customer_balance_disclosures")
      .select(DISCLOSURE_COLUMNS)
      .eq("tenant_id", tenantId)
      .eq("request_type", "withdrawal")
      .order("requested_at", { ascending: false })
      .limit(limit);
    if (error) {
      throw disclosureDbError("Failed to load withdrawal requests", error.message);
    }
    return (data ?? []).map((r) => ({
      ...r,
      request_type: "withdrawal" as const
    })) as DisclosureRow[];
  }

  return getMemoryList(tenantId)
    .filter((r) => r.request_type === "withdrawal")
    .sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime())
    .slice(0, limit);
}

function enrichWithdrawalsLight(
  rows: DisclosureRow[],
  customers: Awaited<ReturnType<typeof listCustomers>>
): BalanceDisclosure[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));
  const agentNameById = new Map<string, string>();
  for (const c of customers) {
    if (c.assignedFieldAgentId && c.assignedFieldAgentName) {
      agentNameById.set(c.assignedFieldAgentId, c.assignedFieldAgentName);
    }
  }

  return rows.map((row) => {
    const customer = customerById.get(row.customer_id);
    return mapRow(row, {
      customerName: customer?.fullName,
      fieldAgentName:
        agentNameById.get(row.field_agent_id) ??
        customer?.assignedFieldAgentName ??
        customer?.createdByFieldAgentName
    });
  });
}

type DisclosureScope = {
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
  filterBranchId?: string;
  fieldAgentId?: string;
};

function filterWithdrawalsByScope(
  rows: DisclosureRow[],
  customers: Awaited<ReturnType<typeof listCustomers>>,
  scope: DisclosureScope
): DisclosureRow[] {
  const customerById = new Map(customers.map((c) => [c.id, c]));
  let filtered = rows;

  if (scope.fieldAgentId) {
    filtered = filtered.filter((r) => r.field_agent_id === scope.fieldAgentId);
  }

  const branchId =
    scope.filterBranchId?.trim() ||
    (scope.scopeType !== "head_office" ? scope.branchId : undefined);
  if (branchId) {
    filtered = filtered.filter((r) => customerById.get(r.customer_id)?.homeBranchId === branchId);
  }

  return filtered;
}

export async function listTenantWithdrawalDisclosures(
  tenantId: string,
  scope: DisclosureScope
): Promise<BalanceDisclosure[]> {
  const [rows, customers] = await Promise.all([
    fetchWithdrawalsForTenant(tenantId),
    listCustomers(tenantId)
  ]);
  const scoped = filterWithdrawalsByScope(rows, customers, scope);
  return enrichWithdrawalsLight(scoped, customers);
}

function withdrawalApprovalNotes(
  disclosureId: string,
  fulfillmentMode: string | null,
  payoutReference?: string | null
): string {
  const modeLabel =
    fulfillmentMode === "momo"
      ? "MoMo"
      : fulfillmentMode === "agent_next_day"
        ? "agent next-day cash"
        : fulfillmentMode === "next_day_cash"
          ? "next-day cash"
          : "cash";
  const ref = payoutReference?.trim() ? ` · Ref ${payoutReference.trim()}` : "";
  return `Field agent withdrawal approved (${modeLabel}) · req ${disclosureId.slice(0, 8)}${ref}`;
}

export async function approveBalanceDisclosure(
  context: TransactionRequestContext,
  disclosureId: string,
  input: unknown = {}
): Promise<BalanceDisclosure> {
  const tenantId = context.tenantId;
  const coordinatorId = context.userId;
  const approvalPayload = approveCustomerRequestSchema.parse(input ?? {});
  const row = await getRowById(tenantId, disclosureId);
  if (!row) {
    throw new Error("Request not found");
  }
  if (row.status !== "pending") {
    throw new Error("Only pending requests can be approved");
  }

  const customer = await getCustomerById(tenantId, row.customer_id);
  if (!customer) {
    throw new Error("Customer not found");
  }

  const approvedAt = new Date();
  const ledgerBalance = await computeCustomerBalance(tenantId, row.customer_id);

  if (row.request_type === "withdrawal") {
    const amount = Number(row.withdrawal_amount ?? 0);
    if (amount <= 0) {
      throw new Error("Invalid withdrawal amount on request");
    }
    const withdrawable = await getCustomerWithdrawableBalance(tenantId, row.customer_id);
    if (withdrawable < amount) {
      throw new Error(
        `Insufficient withdrawable balance. Available: GHS ${withdrawable.toFixed(2)} (ledger GHS ${ledgerBalance.toFixed(2)}); withdrawal is GHS ${amount.toFixed(2)}.`
      );
    }

    const isMomo = row.fulfillment_mode === "momo";
    const hasCsApproval = context.permissions?.includes("agency.withdrawals.approve");
    const isLegacyCoordinator =
      (context.role === "admin" || context.role === "coordinator") && !hasCsApproval;

    if (isMomo && isLegacyCoordinator) {
      if (!approvalPayload.transactionProofImage?.trim()) {
        throw new Error("Upload the MoMo transaction screenshot before approving.");
      }
      if (!approvalPayload.generatedReceiptImage?.trim()) {
        throw new Error("Receipt image is required for MoMo payout.");
      }

      const paidAt = approvedAt.toISOString();
      const payoutReference = approvalPayload.payoutReference?.trim() ?? null;

      await postWithdrawalForApprovedDisclosure({
        tenantId,
        customerId: row.customer_id,
        homeBranchId: customer.homeBranchId,
        amount,
        disclosureId,
        recordedByUserId: coordinatorId,
        fieldAgentId: row.field_agent_id,
        notes: withdrawalApprovalNotes(disclosureId, row.fulfillment_mode, payoutReference)
      });

      const balanceAfterWithdrawal = await computeCustomerBalance(tenantId, row.customer_id);

      const patch = {
        status: "approved" as const,
        balance_amount: balanceAfterWithdrawal,
        approved_at: approvedAt.toISOString(),
        approved_by: coordinatorId,
        payout_reference: payoutReference,
        transaction_proof_image: approvalPayload.transactionProofImage ?? null,
        generated_receipt_image: approvalPayload.generatedReceiptImage ?? null,
        paid_at: paidAt
      };

      const supabase = getSupabaseAdminClient();
      if (supabase) {
        const { error } = await supabase
          .from("customer_balance_disclosures")
          .update(patch)
          .eq("tenant_id", tenantId)
          .eq("id", disclosureId);
        if (error) {
          throw disclosureDbError("Failed to approve withdrawal", error.message);
        }
      } else {
        Object.assign(row, patch);
      }

      const updated: DisclosureRow = { ...row, ...patch, status: "approved" };
      const ref = payoutReference ? ` Ref: ${payoutReference}.` : "";
      await createAgentNotification({
        tenantId,
        userId: row.field_agent_id,
        customerId: row.customer_id,
        kind: "withdrawal_momo_sent",
        title: "MoMo withdrawal sent",
        body: `${customer.fullName}: GHS ${amount.toFixed(2)} sent to ${row.momo_account_name} (${row.momo_number}).${ref} Receipt attached.`,
        imageUrl: patch.generated_receipt_image ?? undefined
      });

      return mapRow(updated, { customerName: customer.fullName });
    }

    if (!isMomo && isLegacyCoordinator) {
      await postWithdrawalForApprovedDisclosure({
        tenantId,
        customerId: row.customer_id,
        homeBranchId: customer.homeBranchId,
        amount,
        disclosureId,
        recordedByUserId: coordinatorId,
        fieldAgentId: row.field_agent_id,
        notes: withdrawalApprovalNotes(disclosureId, row.fulfillment_mode, null)
      });

      const balanceAfterWithdrawal = await computeCustomerBalance(tenantId, row.customer_id);

      const patch = {
        status: "approved" as const,
        balance_amount: balanceAfterWithdrawal,
        approved_at: approvedAt.toISOString(),
        approved_by: coordinatorId
      };

      const supabase = getSupabaseAdminClient();
      if (supabase) {
        const { error } = await supabase
          .from("customer_balance_disclosures")
          .update(patch)
          .eq("tenant_id", tenantId)
          .eq("id", disclosureId);
        if (error) {
          throw disclosureDbError("Failed to approve withdrawal", error.message);
        }
      } else {
        Object.assign(row, patch);
      }

      const updated: DisclosureRow = { ...row, ...patch, status: "approved" };

      await createAgentNotification({
        tenantId,
        userId: row.field_agent_id,
        customerId: row.customer_id,
        kind: "withdrawal_request_approved",
        title: "Withdrawal approved",
        body: `${customer.fullName}: GHS ${amount.toFixed(2)} approved by coordinator.`
      });

      return mapRow(updated, { customerName: customer.fullName });
    }

    if (!isMomo) {
      if (!hasCsApproval && context.role !== "admin") {
        throw new Error("Only Customer Service can verify cash withdrawal requests.");
      }

      const { customerServiceApproveWithdrawal } = await import("./agencyBankingService.js");
      return customerServiceApproveWithdrawal(context, disclosureId, {
        bankProductId: approvalPayload.bankProductId,
        workflowData: approvalPayload.workflowData
      });
    }

    if (!hasCsApproval && context.role !== "admin") {
      throw new Error("Only Customer Service can verify MoMo withdrawal requests.");
    }

    const { customerServiceApproveWithdrawal } = await import("./agencyBankingService.js");
    return customerServiceApproveWithdrawal(context, disclosureId, {
      bankProductId: approvalPayload.bankProductId,
      workflowData: approvalPayload.workflowData
    });
  }

  if (context.role !== "admin" && context.role !== "coordinator") {
    throw new Error("Only admin or coordinator can approve balance visibility requests");
  }

  const visibleHours = approvalPayload.visibleHours ?? DEFAULT_VISIBLE_HOURS;
  const expiresAt = new Date(approvedAt.getTime() + resolveVisibleMs(visibleHours));
  const patch = {
    status: "approved",
    balance_amount: ledgerBalance,
    approved_at: approvedAt.toISOString(),
    expires_at: expiresAt.toISOString(),
    approved_by: coordinatorId
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customer_balance_disclosures")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", disclosureId);
    if (error) {
      throw disclosureDbError("Failed to approve balance request", error.message);
    }
  } else {
    Object.assign(row, patch);
  }

  const updated: DisclosureRow = { ...row, ...patch, balance_amount: ledgerBalance };

  await createAgentNotification({
    tenantId,
    userId: row.field_agent_id,
    customerId: row.customer_id,
    kind: "balance_disclosure_approved",
    title: "Balance approved",
    body: `${customer.fullName}: GHS ${ledgerBalance.toFixed(2)} — visible for ${formatVisibleDuration(visibleHours)}`
  });

  return mapRow(updated, { customerName: customer.fullName });
}

export async function rejectBalanceDisclosure(
  tenantId: string,
  coordinatorId: string,
  disclosureId: string,
  input: unknown
): Promise<BalanceDisclosure> {
  const parsed = rejectBalanceDisclosureSchema.parse(input ?? {});
  const row = await getRowById(tenantId, disclosureId);
  if (!row) {
    throw new Error("Request not found");
  }
  if (row.status !== "pending") {
    throw new Error("Only pending requests can be rejected");
  }

  const customer = await getCustomerById(tenantId, row.customer_id);
  const patch = {
    status: "rejected",
    approved_by: coordinatorId,
    rejected_reason: parsed.reason ?? null
  };

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customer_balance_disclosures")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", disclosureId);
    if (error) {
      throw disclosureDbError("Failed to reject request", error.message);
    }
  } else {
    Object.assign(row, patch);
  }

  const updated: DisclosureRow = { ...row, ...patch, status: "rejected" };
  const isWithdrawal = row.request_type === "withdrawal";

  await createAgentNotification({
    tenantId,
    userId: row.field_agent_id,
    customerId: row.customer_id,
    kind: isWithdrawal ? "withdrawal_request_rejected" : "balance_disclosure_rejected",
    title: isWithdrawal ? "Withdrawal declined" : "Balance request declined",
    body: customer
      ? `${customer.fullName}${parsed.reason ? ` — ${parsed.reason}` : ""}`
      : "Your coordinator declined this request."
  });

  return mapRow(updated, { customerName: customer?.fullName });
}
