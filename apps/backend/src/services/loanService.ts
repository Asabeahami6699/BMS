import type { LoanApplication, LoanProduct, LoanRepayment, LoanScheduleInstallment } from "@bms/shared";
import { computeLoanFigures,
  createLoanApplicationSchema,
  createLoanProductSchema,
  generateScheduleDueDates,
  loanApplicationSchema,
  loanGuarantorSchema,
  loanProductSchema,
  loanRepaymentSchema,
  loanScheduleInstallmentSchema,
  recordLoanRepaymentSchema,
  rejectLoanApplicationSchema,
  scheduleStatusFromAmounts,
  susuCreditSnapshotSchema,
  updateLoanProductSchema, formatAccountAmount } from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { resolveBranchId } from "./branchService.js";
import { getCustomerById, patchCustomerKycPhotos, registerLoanBorrower } from "./customerService.js";
import { getLoanGroupNameMap, listLoanGroups, validateGroupForLoanApplication } from "./loanGroupService.js";
import { assertBranchAccess } from "../middleware/branchScope.js";
import {
  buildSusuCreditSnapshot,
  isSusuLoanBridgeActive,
  postSusuCreditForLoanDisbursement,
  postSusuDebitForLoanRepayment,
  recomputeCustomerLoanCollateralLocked,
  reverseSusuDebitForLoanRepayment,
  setCustomerLoanCollateralLocked
} from "./susuLoanBridgeService.js";
import {
  evaluateCustomerLoanQualification,
  getLoanQualificationSetup
} from "./loanQualificationService.js";
import { computeCustomerBalance } from "./ledgerService.js";

type ActorContext = {
  tenantId: string;
  userId: string;
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
};

function assertLoanBranchAccess(context: ActorContext, loanBranchId: string): void {
  assertBranchAccess(
    { scopeType: context.scopeType, branchId: context.branchId },
    loanBranchId
  );
}

async function assertLoanQualificationForMoneyPath(
  context: ActorContext,
  app: LoanApplication
): Promise<void> {
  if (!(await isSusuLoanBridgeActive(context.tenantId))) {
    return;
  }
  const setup = await getLoanQualificationSetup(context.tenantId);
  if (!setup.enabled) {
    return;
  }
  const result = await evaluateCustomerLoanQualification(context.tenantId, app.customerId);
  if (!result.qualified) {
    throw new Error(
      `Borrower does not meet loan qualification: ${result.reasons.join(" ")}`
    );
  }
  if (
    result.suggestedMaxLoanGhs > 0 &&
    app.principalAmount > result.suggestedMaxLoanGhs + 1e-9
  ) {
    throw new Error(
      `Principal GHS ${formatAccountAmount(app.principalAmount)} exceeds suggested max GHS ${formatAccountAmount(result.suggestedMaxLoanGhs)} from qualification setup.`
    );
  }
}

type MemoryStore = {
  products: LoanProduct[];
  applications: LoanApplication[];
  repayments: LoanRepayment[];
  schedule: LoanScheduleInstallment[];
};

const memory = new Map<string, MemoryStore>();

function ensureMemory(tenantId: string): MemoryStore {
  let store = memory.get(tenantId);
  if (!store) {
    store = { products: [], applications: [], repayments: [], schedule: [] };
    memory.set(tenantId, store);
  }
  return store;
}

function rowToProduct(row: Record<string, unknown>): LoanProduct {
  return loanProductSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    description: row.description != null ? String(row.description) : undefined,
    interestRatePercent: Number(row.interest_rate_percent ?? 0),
    termMonths: Number(row.term_months ?? 0),
    repaymentFrequency: row.repayment_frequency === "weekly" ? "weekly" : "monthly",
    minAmount: Number(row.min_amount ?? 0),
    maxAmount: Number(row.max_amount ?? 0),
    loanType: row.loan_type === "group_solidarity" ? "group_solidarity" : "individual",
    minGroupMembers: row.min_group_members != null ? Number(row.min_group_members) : undefined,
    maxGroupMembers: row.max_group_members != null ? Number(row.max_group_members) : undefined,
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.created_at != null ? String(row.created_at) : undefined
  });
}

function rowToApplication(row: Record<string, unknown>): LoanApplication {
  return loanApplicationSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    customerId: String(row.customer_id),
    productId: String(row.product_id),
    loanType: row.loan_type === "group_solidarity" ? "group_solidarity" : "individual",
    groupId: row.group_id != null ? String(row.group_id) : undefined,
    branchId: String(row.branch_id),
    principalAmount: Number(row.principal_amount ?? 0),
    interestRatePercent: Number(row.interest_rate_percent ?? 0),
    termMonths: Number(row.term_months ?? 0),
    repaymentFrequency: row.repayment_frequency === "weekly" ? "weekly" : "monthly",
    installmentAmount:
      row.installment_amount != null ? Number(row.installment_amount) : undefined,
    totalInterest: Number(row.total_interest ?? 0),
    totalRepayable: Number(row.total_repayable ?? 0),
    installmentsTotal: row.installments_total != null ? Number(row.installments_total) : undefined,
    installmentsPaid: Number(row.installments_paid ?? 0),
    nextDueDate: row.next_due_date != null ? String(row.next_due_date) : undefined,
    status: row.status,
    outstandingPrincipal: Number(row.outstanding_principal ?? 0),
    totalRepaid: Number(row.total_repaid ?? 0),
    applicationNotes: row.application_notes != null ? String(row.application_notes) : undefined,
    loanPurpose: row.loan_purpose != null ? row.loan_purpose : undefined,
    loanPurposeOther: row.loan_purpose_other != null ? String(row.loan_purpose_other) : undefined,
    sourceOfIncome: row.source_of_income != null ? row.source_of_income : undefined,
    sourceOfIncomeOther:
      row.source_of_income_other != null ? String(row.source_of_income_other) : undefined,
    occupation: row.occupation != null ? String(row.occupation) : undefined,
    employerOrBusiness:
      row.employer_or_business != null ? String(row.employer_or_business) : undefined,
    monthlyIncome: row.monthly_income != null ? Number(row.monthly_income) : undefined,
    monthlyExpenses: row.monthly_expenses != null ? Number(row.monthly_expenses) : undefined,
    existingLoanBalance:
      row.existing_loan_balance != null ? Number(row.existing_loan_balance) : undefined,
    yearsAtCurrentJob:
      row.years_at_current_job != null ? Number(row.years_at_current_job) : undefined,
    guarantor:
      row.guarantor != null
        ? loanGuarantorSchema.parse(row.guarantor as Record<string, unknown>)
        : undefined,
    susuCreditSnapshot:
      row.susu_credit_snapshot != null
        ? susuCreditSnapshotSchema.parse(row.susu_credit_snapshot as Record<string, unknown>)
        : undefined,
    collateralLienAmount:
      row.collateral_lien_amount != null ? Number(row.collateral_lien_amount) : undefined,
    disburseToSusu: row.disburse_to_susu == null ? undefined : Boolean(row.disburse_to_susu),
    susuDisbursementTransactionId:
      row.susu_disbursement_transaction_id != null
        ? String(row.susu_disbursement_transaction_id)
        : undefined,
    autoDebitFailCount:
      row.auto_debit_fail_count != null ? Number(row.auto_debit_fail_count) : undefined,
    autoDebitLastFailedAt:
      row.auto_debit_last_failed_at != null ? String(row.auto_debit_last_failed_at) : undefined,
    autoDebitRecoveryStage:
      row.auto_debit_recovery_stage === "retry_pending" ||
      row.auto_debit_recovery_stage === "sms_sent" ||
      row.auto_debit_recovery_stage === "agent_task" ||
      row.auto_debit_recovery_stage === "par_escalated"
        ? row.auto_debit_recovery_stage
        : undefined,
    parEscalatedAt: row.par_escalated_at != null ? String(row.par_escalated_at) : undefined,
    rejectionReason: row.rejection_reason != null ? String(row.rejection_reason) : undefined,
    appliedAt: String(row.applied_at),
    approvedAt: row.approved_at != null ? String(row.approved_at) : undefined,
    approvedBy: row.approved_by != null ? String(row.approved_by) : undefined,
    disbursedAt: row.disbursed_at != null ? String(row.disbursed_at) : undefined,
    disbursedBy: row.disbursed_by != null ? String(row.disbursed_by) : undefined,
    closedAt: row.closed_at != null ? String(row.closed_at) : undefined,
    createdBy: String(row.created_by)
  });
}

function rowToSchedule(row: Record<string, unknown>): LoanScheduleInstallment {
  return loanScheduleInstallmentSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    loanId: String(row.loan_id),
    installmentNumber: Number(row.installment_number ?? 0),
    dueDate: String(row.due_date),
    amountDue: Number(row.amount_due ?? 0),
    amountPaid: Number(row.amount_paid ?? 0),
    status: row.status,
    paidAt: row.paid_at != null ? String(row.paid_at) : undefined
  });
}

function rowToRepayment(row: Record<string, unknown>): LoanRepayment {
  return loanRepaymentSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    loanId: String(row.loan_id),
    amount: Number(row.amount ?? 0),
    branchId: String(row.branch_id),
    installmentNumber:
      row.installment_number != null ? Number(row.installment_number) : undefined,
    notes: row.notes != null ? String(row.notes) : undefined,
    paymentSource: row.payment_source === "susu_account" ? "susu_account" : "cash",
    susuTransactionId:
      row.susu_transaction_id != null ? String(row.susu_transaction_id) : undefined,
    recordedBy: String(row.recorded_by),
    createdAt: String(row.created_at)
  });
}

async function enrichApplications(
  tenantId: string,
  applications: LoanApplication[],
  products: LoanProduct[]
): Promise<LoanApplication[]> {
  const productMap = new Map(products.map((p) => [p.id, p.name]));
  const groupMap = await getLoanGroupNameMap(tenantId);
  const enriched: LoanApplication[] = [];
  for (const app of applications) {
    const customer = await getCustomerById(tenantId, app.customerId);
    enriched.push({
      ...app,
      customerName: customer?.fullName,
      productName: productMap.get(app.productId),
      groupName: app.groupId ? groupMap.get(app.groupId) : undefined
    });
  }
  return enriched;
}

export async function listLoanProducts(tenantId: string): Promise<LoanProduct[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_products")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name", { ascending: true });
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        return ensureMemory(tenantId).products;
      }
      throw new Error(`Failed to list loan products: ${error.message}`);
    }
    return (data ?? []).map((row) => rowToProduct(row as Record<string, unknown>));
  }
  return ensureMemory(tenantId).products;
}

export async function createLoanProduct(tenantId: string, input: unknown): Promise<LoanProduct> {
  const payload = createLoanProductSchema.parse(input);
  const product: LoanProduct = loanProductSchema.parse({
    id: crypto.randomUUID(),
    tenantId,
    ...payload,
    repaymentFrequency: payload.repaymentFrequency ?? "monthly",
    loanType: payload.loanType ?? "individual",
    status: payload.status ?? "active",
    createdAt: new Date().toISOString()
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_products")
      .insert({
        id: product.id,
        tenant_id: tenantId,
        name: product.name,
        description: product.description ?? null,
        interest_rate_percent: product.interestRatePercent,
        term_months: product.termMonths,
        repayment_frequency: product.repaymentFrequency,
        min_amount: product.minAmount,
        max_amount: product.maxAmount,
        loan_type: product.loanType,
        min_group_members: product.minGroupMembers ?? null,
        max_group_members: product.maxGroupMembers ?? null,
        status: product.status
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        ensureMemory(tenantId).products.push(product);
        return product;
      }
      throw new Error(`Failed to create loan product: ${error.message}`);
    }
    return rowToProduct(data as Record<string, unknown>);
  }

  ensureMemory(tenantId).products.push(product);
  return product;
}

export async function updateLoanProduct(
  tenantId: string,
  productId: string,
  input: unknown
): Promise<LoanProduct> {
  const payload = updateLoanProductSchema.parse(input);
  const products = await listLoanProducts(tenantId);
  const existing = products.find((p) => p.id === productId);
  if (!existing) {
    throw new Error("Loan product not found");
  }
  const updated: LoanProduct = {
    ...existing,
    ...payload,
    minAmount: payload.minAmount ?? existing.minAmount,
    maxAmount: payload.maxAmount ?? existing.maxAmount,
    repaymentFrequency: payload.repaymentFrequency ?? existing.repaymentFrequency,
    loanType: payload.loanType ?? existing.loanType,
    minGroupMembers: payload.minGroupMembers ?? existing.minGroupMembers,
    maxGroupMembers: payload.maxGroupMembers ?? existing.maxGroupMembers
  };
  if (updated.maxAmount < updated.minAmount) {
    throw new Error("Maximum amount must be at least the minimum");
  }

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_products")
      .update({
        name: updated.name,
        description: updated.description ?? null,
        interest_rate_percent: updated.interestRatePercent,
        term_months: updated.termMonths,
        repayment_frequency: updated.repaymentFrequency,
        min_amount: updated.minAmount,
        max_amount: updated.maxAmount,
        loan_type: updated.loanType,
        min_group_members: updated.minGroupMembers ?? null,
        max_group_members: updated.maxGroupMembers ?? null,
        status: updated.status,
        updated_at: new Date().toISOString()
      })
      .eq("tenant_id", tenantId)
      .eq("id", productId)
      .select("*")
      .single();
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        const mem = ensureMemory(tenantId);
        mem.products = mem.products.map((p) => (p.id === productId ? updated : p));
        return updated;
      }
      throw new Error(`Failed to update loan product: ${error.message}`);
    }
    return rowToProduct(data as Record<string, unknown>);
  }

  const mem = ensureMemory(tenantId);
  mem.products = mem.products.map((p) => (p.id === productId ? updated : p));
  return updated;
}

export async function listLoanApplications(
  tenantId: string,
  options?: { branchId?: string }
): Promise<LoanApplication[]> {
  const supabase = getSupabaseAdminClient();
  const branchId = options?.branchId?.trim() || undefined;
  let applications: LoanApplication[] = [];
  if (supabase) {
    let query = supabase
      .from("loan_applications")
      .select("*")
      .eq("tenant_id", tenantId);
    if (branchId) {
      query = query.eq("branch_id", branchId);
    }
    const { data, error } = await query.order("applied_at", { ascending: false });
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        applications = ensureMemory(tenantId).applications;
      } else {
        throw new Error(`Failed to list loan applications: ${error.message}`);
      }
    } else {
      applications = (data ?? []).map((row) => rowToApplication(row as Record<string, unknown>));
    }
  } else {
    applications = ensureMemory(tenantId).applications;
    if (branchId) {
      applications = applications.filter((a) => a.branchId === branchId);
    }
  }
  const products = await listLoanProducts(tenantId);
  return enrichApplications(tenantId, applications, products);
}

async function getApplicationById(tenantId: string, loanId: string): Promise<LoanApplication | undefined> {
  const applications = await listLoanApplications(tenantId);
  return applications.find((a) => a.id === loanId);
}

async function listScheduleForLoan(tenantId: string, loanId: string): Promise<LoanScheduleInstallment[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_repayment_schedule")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("loan_id", loanId)
      .order("installment_number", { ascending: true });
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        return ensureMemory(tenantId).schedule
          .filter((s) => s.loanId === loanId)
          .map((item) => {
            if (item.status === "paid") {
              return item;
            }
            return {
              ...item,
              status: scheduleStatusFromAmounts(item.amountDue, item.amountPaid, item.dueDate)
            };
          });
      }
      throw new Error(`Failed to load schedule: ${error.message}`);
    }
    return (data ?? []).map((row) => {
      const item = rowToSchedule(row as Record<string, unknown>);
      if (item.status === "paid") {
        return item;
      }
      return {
        ...item,
        status: scheduleStatusFromAmounts(item.amountDue, item.amountPaid, item.dueDate)
      };
    });
  }
  return ensureMemory(tenantId).schedule
    .filter((s) => s.loanId === loanId)
    .map((item) => {
      if (item.status === "paid") {
        return item;
      }
      return {
        ...item,
        status: scheduleStatusFromAmounts(item.amountDue, item.amountPaid, item.dueDate)
      };
    });
}

async function listRepaymentsForLoan(tenantId: string, loanId: string): Promise<LoanRepayment[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("loan_repayments")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("loan_id", loanId)
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        return ensureMemory(tenantId).repayments.filter((r) => r.loanId === loanId);
      }
      throw new Error(`Failed to load repayments: ${error.message}`);
    }
    return (data ?? []).map((row) => rowToRepayment(row as Record<string, unknown>));
  }
  return ensureMemory(tenantId).repayments.filter((r) => r.loanId === loanId);
}

export async function getLoanDetail(
  tenantId: string,
  loanId: string
): Promise<{
  application: LoanApplication;
  schedule: LoanScheduleInstallment[];
  repayments: LoanRepayment[];
  customer?: {
    fullName: string;
    email?: string;
    phone: string;
    location?: string;
    houseNumber?: string;
    idCardNumber?: string;
    accountNumber?: string;
    photoUrl?: string;
    idCardPhotoUrl?: string;
    nextOfKin?: {
      fullName: string;
      phone: string;
      location: string;
      houseNumber?: string;
    };
  };
}> {
  const application = await getApplicationById(tenantId, loanId);
  if (!application) {
    throw new Error("Loan not found");
  }
  const [schedule, repayments, customerRow] = await Promise.all([
    listScheduleForLoan(tenantId, loanId),
    listRepaymentsForLoan(tenantId, loanId),
    getCustomerById(tenantId, application.customerId)
  ]);
  const customer = customerRow
    ? {
        fullName: customerRow.fullName,
        email: customerRow.email,
        phone: customerRow.phone,
        location: customerRow.location,
        houseNumber: customerRow.houseNumber,
        idCardNumber: customerRow.idCardNumber,
        accountNumber: customerRow.accountNumber,
        photoUrl: customerRow.photoUrl,
        idCardPhotoUrl: customerRow.idCardPhotoUrl,
        nextOfKin: customerRow.nextOfKin
      }
    : undefined;
  return { application, schedule, repayments, customer };
}

export async function createLoanApplication(
  context: ActorContext,
  input: unknown
): Promise<LoanApplication> {
  const payload = createLoanApplicationSchema.parse(input);
  assertLoanBranchAccess(context, payload.branchId);
  let customerId = payload.customerId;
  let customerName: string | undefined;

  if (payload.newCustomer) {
    const borrower = await registerLoanBorrower(context.tenantId, context.userId, {
      ...payload.newCustomer,
      homeBranchId: payload.newCustomer.homeBranchId || payload.branchId
    });
    customerId = borrower.id;
    customerName = borrower.fullName;
  } else if (customerId) {
    const customer = await getCustomerById(context.tenantId, customerId);
    if (!customer || customer.status !== "active") {
      throw new Error("Customer not found or not active");
    }
    customerName = customer.fullName;
    if (payload.photoUrl || payload.idCardPhotoUrl) {
      await patchCustomerKycPhotos(context.tenantId, customerId, {
        photoUrl: payload.photoUrl,
        idCardPhotoUrl: payload.idCardPhotoUrl
      });
    }
  } else {
    throw new Error("Customer is required");
  }

  const products = await listLoanProducts(context.tenantId);
  const product = products.find((p) => p.id === payload.productId && p.status === "active");
  if (!product) {
    throw new Error("Active loan product not found");
  }
  if (payload.principalAmount < product.minAmount || payload.principalAmount > product.maxAmount) {
    throw new Error(
      `Amount must be between GHS ${formatAccountAmount(product.minAmount)} and GHS ${formatAccountAmount(product.maxAmount)}`
    );
  }

  const isGroupProduct = product.loanType === "group_solidarity";
  if (isGroupProduct && !payload.groupId) {
    throw new Error("Group is required for solidarity loan products");
  }
  if (!isGroupProduct && payload.groupId) {
    throw new Error("Group can only be set for solidarity loan products");
  }
  if (payload.newCustomer && isGroupProduct) {
    throw new Error("Group loans require an existing customer who is already a group member");
  }

  let groupName: string | undefined;
  if (isGroupProduct && payload.groupId) {
    const memApps = ensureMemory(context.tenantId).applications;
    const allApps =
      memApps.length > 0
        ? memApps
        : await (async () => {
            const supabase = getSupabaseAdminClient();
            if (!supabase) {
              return memApps;
            }
            const { data } = await supabase
              .from("loan_applications")
              .select("*")
              .eq("tenant_id", context.tenantId);
            return (data ?? []).map((row) => rowToApplication(row as Record<string, unknown>));
          })();
    const group = await validateGroupForLoanApplication(
      context.tenantId,
      payload.groupId,
      customerId,
      product,
      allApps
    );
    groupName = group.name;
  }

  const branchId = await resolveBranchId(context.tenantId, payload.branchId);
  if (!branchId) {
    throw new Error("Invalid branch");
  }

  const figures = computeLoanFigures(
    payload.principalAmount,
    product.interestRatePercent,
    product.termMonths,
    product.repaymentFrequency
  );

  let susuCreditSnapshot: LoanApplication["susuCreditSnapshot"];
  if (await isSusuLoanBridgeActive(context.tenantId)) {
    try {
      susuCreditSnapshot = await buildSusuCreditSnapshot(context.tenantId, customerId!);
    } catch {
      susuCreditSnapshot = undefined;
    }
  }

  const application: LoanApplication = loanApplicationSchema.parse({
    id: crypto.randomUUID(),
    tenantId: context.tenantId,
    customerId,
    customerName,
    productId: product.id,
    productName: product.name,
    loanType: product.loanType,
    groupId: payload.groupId,
    groupName,
    branchId,
    principalAmount: payload.principalAmount,
    interestRatePercent: product.interestRatePercent,
    termMonths: product.termMonths,
    repaymentFrequency: product.repaymentFrequency,
    installmentAmount: figures.installmentAmount,
    totalInterest: figures.totalInterest,
    totalRepayable: figures.totalRepayable,
    installmentsTotal: figures.installmentsTotal,
    installmentsPaid: 0,
    status: "pending_approval",
    outstandingPrincipal: 0,
    totalRepaid: 0,
    applicationNotes: payload.applicationNotes,
    loanPurpose: payload.loanPurpose,
    loanPurposeOther: payload.loanPurposeOther?.trim() || undefined,
    sourceOfIncome: payload.sourceOfIncome,
    sourceOfIncomeOther: payload.sourceOfIncomeOther?.trim() || undefined,
    occupation: payload.occupation.trim(),
    employerOrBusiness: payload.employerOrBusiness?.trim() || undefined,
    monthlyIncome: payload.monthlyIncome,
    monthlyExpenses: payload.monthlyExpenses,
    existingLoanBalance: payload.existingLoanBalance,
    yearsAtCurrentJob: payload.yearsAtCurrentJob,
    guarantor: payload.guarantor,
    susuCreditSnapshot,
    appliedAt: new Date().toISOString(),
    createdBy: context.userId
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const insertRow: Record<string, unknown> = {
      id: application.id,
      tenant_id: context.tenantId,
      customer_id: application.customerId,
      product_id: application.productId,
      branch_id: application.branchId,
      principal_amount: application.principalAmount,
      interest_rate_percent: application.interestRatePercent,
      term_months: application.termMonths,
      repayment_frequency: application.repaymentFrequency,
      installment_amount: application.installmentAmount,
      total_interest: application.totalInterest,
      total_repayable: application.totalRepayable,
      installments_total: application.installmentsTotal,
      installments_paid: 0,
      status: application.status,
      outstanding_principal: 0,
      total_repaid: 0,
      application_notes: application.applicationNotes ?? null,
      loan_purpose: application.loanPurpose ?? null,
      loan_purpose_other: application.loanPurposeOther ?? null,
      source_of_income: application.sourceOfIncome ?? null,
      source_of_income_other: application.sourceOfIncomeOther ?? null,
      occupation: application.occupation ?? null,
      employer_or_business: application.employerOrBusiness ?? null,
      monthly_income: application.monthlyIncome ?? null,
      monthly_expenses: application.monthlyExpenses ?? null,
      existing_loan_balance: application.existingLoanBalance ?? null,
      years_at_current_job: application.yearsAtCurrentJob ?? null,
      guarantor: application.guarantor ?? null,
      susu_credit_snapshot: application.susuCreditSnapshot ?? null,
      loan_type: application.loanType,
      group_id: application.groupId ?? null,
      created_by: context.userId
    };
    let { data, error } = await supabase.from("loan_applications").insert(insertRow).select("*").single();
    if (error && /susu_credit_snapshot/i.test(error.message)) {
      const { susu_credit_snapshot: _snap, ...withoutSnap } = insertRow;
      void _snap;
      const retry = await supabase.from("loan_applications").insert(withoutSnap).select("*").single();
      data = retry.data;
      error = retry.error;
    }
    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        ensureMemory(context.tenantId).applications.unshift(application);
        return application;
      }
      throw new Error(`Failed to create loan application: ${error.message}`);
    }
    const saved = rowToApplication(data as Record<string, unknown>);
    return {
      ...saved,
      customerName,
      productName: product.name,
      susuCreditSnapshot: saved.susuCreditSnapshot ?? susuCreditSnapshot
    };
  }

  ensureMemory(context.tenantId).applications.unshift(application);
  return application;
}

async function persistApplication(application: LoanApplication): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    const mem = ensureMemory(application.tenantId);
    mem.applications = mem.applications.map((a) => (a.id === application.id ? application : a));
    return;
  }
  const baseUpdate: Record<string, unknown> = {
    status: application.status,
    outstanding_principal: application.outstandingPrincipal,
    total_repaid: application.totalRepaid,
    installments_paid: application.installmentsPaid,
    next_due_date: application.nextDueDate ?? null,
    rejection_reason: application.rejectionReason ?? null,
    approved_at: application.approvedAt ?? null,
    approved_by: application.approvedBy ?? null,
    disbursed_at: application.disbursedAt ?? null,
    disbursed_by: application.disbursedBy ?? null,
    closed_at: application.closedAt ?? null,
    updated_at: new Date().toISOString()
  };
  const bridgeUpdate: Record<string, unknown> = {
    ...baseUpdate,
    collateral_lien_amount: application.collateralLienAmount ?? 0,
    disburse_to_susu: application.disburseToSusu ?? true,
    susu_disbursement_transaction_id: application.susuDisbursementTransactionId ?? null,
    auto_debit_fail_count: application.autoDebitFailCount ?? 0,
    auto_debit_last_failed_at: application.autoDebitLastFailedAt ?? null,
    auto_debit_recovery_stage: application.autoDebitRecoveryStage ?? null,
    par_escalated_at: application.parEscalatedAt ?? null
  };
  let { error } = await supabase
    .from("loan_applications")
    .update(bridgeUpdate)
    .eq("tenant_id", application.tenantId)
    .eq("id", application.id);
  if (
    error &&
    /collateral_lien|disburse_to_susu|susu_disbursement|auto_debit_|par_escalated/i.test(
      error.message
    )
  ) {
    const retry = await supabase
      .from("loan_applications")
      .update(baseUpdate)
      .eq("tenant_id", application.tenantId)
      .eq("id", application.id);
    error = retry.error;
  }
  if (error && !isMissingSupabaseResource(error.message)) {
    throw new Error(`Failed to update loan application: ${error.message}`);
  }
  if (error && isMissingSupabaseResource(error.message)) {
    const mem = ensureMemory(application.tenantId);
    mem.applications = mem.applications.map((a) => (a.id === application.id ? application : a));
  }
}

async function generateRepaymentSchedule(application: LoanApplication): Promise<LoanScheduleInstallment[]> {
  const count = application.installmentsTotal ?? 0;
  if (count <= 0) {
    return [];
  }
  const start = application.disbursedAt ? new Date(application.disbursedAt) : new Date();
  const dueDates = generateScheduleDueDates(start, count, application.repaymentFrequency);
  const installments: LoanScheduleInstallment[] = dueDates.map((dueDate, index) =>
    loanScheduleInstallmentSchema.parse({
      id: crypto.randomUUID(),
      tenantId: application.tenantId,
      loanId: application.id,
      installmentNumber: index + 1,
      dueDate,
      amountDue: application.installmentAmount ?? 0,
      amountPaid: 0,
      status: "pending"
    })
  );

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("loan_repayment_schedule").insert(
      installments.map((item) => ({
        id: item.id,
        tenant_id: item.tenantId,
        loan_id: item.loanId,
        installment_number: item.installmentNumber,
        due_date: item.dueDate,
        amount_due: item.amountDue,
        amount_paid: 0,
        status: "pending"
      }))
    );
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to create repayment schedule: ${error.message}`);
    }
  }
  ensureMemory(application.tenantId).schedule.push(...installments);
  return installments;
}

export async function approveLoanApplication(
  context: ActorContext,
  loanId: string
): Promise<LoanApplication> {
  const app = await getApplicationById(context.tenantId, loanId);
  if (!app) {
    throw new Error("Loan application not found");
  }
  assertLoanBranchAccess(context, app.branchId);
  if (app.status !== "pending_approval") {
    throw new Error("Only pending applications can be approved");
  }
  await assertLoanQualificationForMoneyPath(context, app);
  const updated: LoanApplication = {
    ...app,
    status: "approved",
    approvedAt: new Date().toISOString(),
    approvedBy: context.userId
  };
  await persistApplication(updated);
  return updated;
}

export async function rejectLoanApplication(
  context: ActorContext,
  loanId: string,
  input: unknown
): Promise<LoanApplication> {
  const payload = rejectLoanApplicationSchema.parse(input);
  const app = await getApplicationById(context.tenantId, loanId);
  if (!app) {
    throw new Error("Loan application not found");
  }
  assertLoanBranchAccess(context, app.branchId);
  if (app.status !== "pending_approval") {
    throw new Error("Only pending applications can be rejected");
  }
  const updated: LoanApplication = {
    ...app,
    status: "rejected",
    rejectionReason: payload.rejectionReason,
    approvedBy: context.userId,
    approvedAt: new Date().toISOString()
  };
  await persistApplication(updated);
  return updated;
}

export async function disburseLoan(context: ActorContext, loanId: string): Promise<LoanApplication> {
  const app = await getApplicationById(context.tenantId, loanId);
  if (!app) {
    throw new Error("Loan application not found");
  }
  assertLoanBranchAccess(context, app.branchId);
  if (app.status !== "approved") {
    throw new Error("Only approved loans can be disbursed");
  }
  await assertLoanQualificationForMoneyPath(context, app);

  const disbursedAt = new Date().toISOString();
  const schedule = await listScheduleForLoan(context.tenantId, loanId);
  let nextDueDate = app.nextDueDate;
  if (schedule.length === 0) {
    const pendingApp: LoanApplication = { ...app, disbursedAt };
    const created = await generateRepaymentSchedule(pendingApp);
    nextDueDate = created[0]?.dueDate;
  } else {
    nextDueDate = schedule.find((s) => s.status !== "paid")?.dueDate ?? schedule[0]?.dueDate;
  }

  let susuDisbursementTransactionId = app.susuDisbursementTransactionId;
  let collateralLienAmount = app.collateralLienAmount ?? 0;
  let disburseToSusu = app.disburseToSusu ?? true;

  if (await isSusuLoanBridgeActive(context.tenantId)) {
    try {
      const setup = await getLoanQualificationSetup(context.tenantId);
      disburseToSusu = app.disburseToSusu ?? setup.disburseToSusu;

      // Lock collateral from pre-credit Susu first so the race window cannot drain the lien base.
      if (setup.collateralPercent > 0) {
        const customer = await getCustomerById(context.tenantId, app.customerId);
        const balanceBefore = await computeCustomerBalance(context.tenantId, app.customerId);
        const lockedMin = customer?.lockedBalance ?? 0;
        const base = Math.max(0, balanceBefore - lockedMin);
        collateralLienAmount =
          Math.round(((base * setup.collateralPercent) / 100) * 100) / 100;
        if (collateralLienAmount > 0) {
          const otherOpen = await recomputeCustomerLoanCollateralLocked(
            context.tenantId,
            app.customerId,
            app.id
          );
          await setCustomerLoanCollateralLocked(
            context.tenantId,
            app.customerId,
            Math.round((otherOpen + collateralLienAmount) * 100) / 100
          );
        }
      }

      if (disburseToSusu && !susuDisbursementTransactionId) {
        susuDisbursementTransactionId = await postSusuCreditForLoanDisbursement({
          tenantId: context.tenantId,
          customerId: app.customerId,
          branchId: app.branchId,
          amount: app.principalAmount,
          loanId: app.id,
          recordedByUserId: context.userId
        });
      }
    } catch (error) {
      console.warn(
        "[loans] Susu disbursement / collateral skipped:",
        error instanceof Error ? error.message : error
      );
      throw error;
    }
  }

  const updated: LoanApplication = {
    ...app,
    status: "disbursed",
    outstandingPrincipal: app.totalRepayable || app.principalAmount,
    disbursedAt,
    disbursedBy: context.userId,
    nextDueDate,
    disburseToSusu,
    susuDisbursementTransactionId,
    collateralLienAmount: collateralLienAmount > 0 ? collateralLienAmount : undefined,
    autoDebitFailCount: 0,
    autoDebitRecoveryStage: undefined,
    autoDebitLastFailedAt: undefined,
    parEscalatedAt: undefined
  };
  await persistApplication(updated);

  if (await isSusuLoanBridgeActive(context.tenantId)) {
    try {
      const { getCustomerLoanInstallmentReserve } = await import("./loanReserveService.js");
      const { createAgentNotification, notifyTenantStaff } = await import("./notificationService.js");
      const reserve = await getCustomerLoanInstallmentReserve(context.tenantId, app.customerId);
      if (reserve > 0 || collateralLienAmount > 0 || susuDisbursementTransactionId) {
        const parts: string[] = [];
        if (susuDisbursementTransactionId) {
          parts.push(
            `GHS ${formatAccountAmount(app.principalAmount)} credited to Susu for branch-counter withdrawal`
          );
        }
        if (collateralLienAmount > 0) {
          parts.push(
            `GHS ${formatAccountAmount(collateralLienAmount)} locked as passbook collateral for the loan term`
          );
        }
        if (reserve > 0) {
          parts.push(
            `GHS ${formatAccountAmount(reserve)} reserved for the next installment (not withdrawable)`
          );
        }
        const body = parts.join(". ") + ".";
        await notifyTenantStaff({
          tenantId: context.tenantId,
          roles: ["admin", "coordinator", "accountant"],
          kind: "loan_repayment_reserved",
          title: "Loan disbursed to Susu account",
          body: `${app.customerName ?? "Borrower"}: ${body}`,
          customerId: app.customerId
        });
        const customer = await getCustomerById(context.tenantId, app.customerId);
        const agentId = customer?.assignedFieldAgentId;
        if (agentId) {
          await createAgentNotification({
            tenantId: context.tenantId,
            userId: agentId,
            customerId: app.customerId,
            kind: "loan_repayment_reserved",
            title: "Loan disbursed to Susu",
            body
          });
        }
      }
    } catch (error) {
      console.warn(
        "[loans] reserve notification skipped:",
        error instanceof Error ? error.message : error
      );
    }
  }

  return updated;
}

async function applyRepaymentToSchedule(
  tenantId: string,
  loanId: string,
  amount: number,
  settleAll = false
): Promise<{ installmentNumber?: number; schedule: LoanScheduleInstallment[] }> {
  let schedule = await listScheduleForLoan(tenantId, loanId);
  if (schedule.length === 0) {
    return { schedule };
  }

  const unpaid = schedule
    .filter((s) => s.status !== "paid")
    .sort((a, b) => a.installmentNumber - b.installmentNumber);

  if (unpaid.length === 0) {
    throw new Error("All installments are already paid");
  }

  let remaining = amount;
  let primaryInstallment: number | undefined;

  for (const item of unpaid) {
    if (remaining <= 0) {
      break;
    }
    const dueRemaining = Math.round((item.amountDue - item.amountPaid) * 100) / 100;
    if (dueRemaining <= 0) {
      continue;
    }
    const applied = Math.min(remaining, dueRemaining);
    const amountPaid = Math.round((item.amountPaid + applied) * 100) / 100;
    const status = scheduleStatusFromAmounts(item.amountDue, amountPaid, item.dueDate);
    const paidAt = status === "paid" ? new Date().toISOString() : item.paidAt;
    if (primaryInstallment == null) {
      primaryInstallment = item.installmentNumber;
    }

    const updatedItem: LoanScheduleInstallment = {
      ...item,
      amountPaid,
      status,
      paidAt
    };

    const supabase = getSupabaseAdminClient();
    if (supabase) {
      await supabase
        .from("loan_repayment_schedule")
        .update({
          amount_paid: amountPaid,
          status,
          paid_at: paidAt ?? null
        })
        .eq("id", item.id);
    }
    schedule = schedule.map((s) => (s.id === item.id ? updatedItem : s));
    ensureMemory(tenantId).schedule = ensureMemory(tenantId).schedule.map((s) =>
      s.id === item.id ? updatedItem : s
    );
    remaining = Math.round((remaining - applied) * 100) / 100;
  }

  if (remaining > 0.009 && !settleAll) {
    throw new Error(
      "Repayment exceeds the open installment balance. Pay in schedule order, use overdue bulk catch-up, or Settle all."
    );
  }

  return { installmentNumber: primaryInstallment, schedule };
}

export async function recordLoanRepayment(
  context: ActorContext,
  loanId: string,
  input: unknown
): Promise<{ application: LoanApplication; repayment: LoanRepayment; schedule: LoanScheduleInstallment[] }> {
  const payload = recordLoanRepaymentSchema.parse(input);
  const paymentSource = payload.paymentSource ?? "cash";
  const app = await getApplicationById(context.tenantId, loanId);
  if (!app) {
    throw new Error("Loan not found");
  }
  assertLoanBranchAccess(context, app.branchId);
  if (app.status !== "disbursed") {
    throw new Error("Repayments can only be recorded on disbursed loans");
  }

  let payAmount = payload.settleAll ? app.outstandingPrincipal : payload.amount;
  if (payAmount > app.outstandingPrincipal + 1e-9) {
    throw new Error(
      `Repayment exceeds outstanding balance (GHS ${formatAccountAmount(app.outstandingPrincipal)})`
    );
  }
  if (payAmount <= 0) {
    throw new Error("Repayment amount must be greater than zero");
  }

  if (paymentSource === "susu_account" && !(await isSusuLoanBridgeActive(context.tenantId))) {
    throw new Error(
      "Pay from Susu is unavailable. Enable the Susu↔Loans bridge in Company Profile (both products required)."
    );
  }

  const schedulePreview = await listScheduleForLoan(context.tenantId, loanId);
  if (schedulePreview.length > 0 && !payload.settleAll) {
    const unpaid = schedulePreview
      .filter((s) => s.status !== "paid")
      .sort((a, b) => a.installmentNumber - b.installmentNumber);
    const now = new Date();
    const isPastDue = (dueDate: string) => new Date(`${dueDate}T23:59:59`) < now;
    const overdueBulkTargets = unpaid.filter(
      (s) => s.status === "overdue" || (s.status === "partial" && isPastDue(s.dueDate))
    );
    const hasOverdue = overdueBulkTargets.length > 0;
    if (hasOverdue) {
      const bulkCap =
        Math.round(
          overdueBulkTargets.reduce(
            (sum, s) => sum + Math.max(0, s.amountDue - s.amountPaid),
            0
          ) * 100
        ) / 100;
      if (payAmount > bulkCap + 1e-9) {
        throw new Error(
          `Overdue bulk payment max is GHS ${bulkCap.toFixed(2)} across ${overdueBulkTargets.length} due installment(s). ` +
            "Use Settle all for full payoff."
        );
      }
    } else {
      const nextUnpaid = unpaid[0];
      if (nextUnpaid) {
        const dueRemaining =
          Math.round((nextUnpaid.amountDue - nextUnpaid.amountPaid) * 100) / 100;
        if (payAmount > dueRemaining + 1e-9) {
          throw new Error(
            `Installment #${nextUnpaid.installmentNumber} due is GHS ${formatAccountAmount(dueRemaining)}. ` +
              "Weekly/monthly installments must be paid in order — use Settle all for full payoff, or wait until installments are overdue for bulk catch-up."
          );
        }
      }
    }
  }
  const branchId = await resolveBranchId(context.tenantId, payload.branchId);
  if (!branchId) {
    throw new Error("Invalid branch");
  }
  assertLoanBranchAccess(context, branchId);

  const repaymentId = crypto.randomUUID();
  let susuTransactionId: string | undefined;
  const supabase = getSupabaseAdminClient();

  // Reserve the repayment row first so Susu debit is tied to a durable id (M2).
  const provisionalRepayment: LoanRepayment = {
    id: repaymentId,
    tenantId: context.tenantId,
    loanId,
    amount: payAmount,
    branchId,
    notes: payload.notes,
    paymentSource,
    recordedBy: context.userId,
    createdAt: new Date().toISOString()
  };

  if (supabase) {
    const insertRow: Record<string, unknown> = {
      id: provisionalRepayment.id,
      tenant_id: context.tenantId,
      loan_id: loanId,
      amount: provisionalRepayment.amount,
      branch_id: branchId,
      installment_number: null,
      notes: provisionalRepayment.notes ?? null,
      payment_source: paymentSource,
      susu_transaction_id: null,
      recorded_by: context.userId
    };
    let { error: repayError } = await supabase.from("loan_repayments").insert(insertRow);
    if (repayError && /payment_source|susu_transaction_id/i.test(repayError.message)) {
      const {
        payment_source: _ps,
        susu_transaction_id: _stx,
        ...legacyRow
      } = insertRow;
      void _ps;
      void _stx;
      const retry = await supabase.from("loan_repayments").insert(legacyRow);
      repayError = retry.error;
    }
    if (repayError && !isMissingSupabaseResource(repayError.message)) {
      throw new Error(`Failed to record repayment: ${repayError.message}`);
    }
  }

  try {
    if (paymentSource === "susu_account") {
      susuTransactionId = await postSusuDebitForLoanRepayment({
        tenantId: context.tenantId,
        customerId: app.customerId,
        branchId,
        amount: payAmount,
        repaymentId,
        loanId,
        recordedByUserId: context.userId
      });
    }

    const { installmentNumber, schedule } = await applyRepaymentToSchedule(
      context.tenantId,
      loanId,
      payAmount,
      Boolean(payload.settleAll)
    );

    const repayment: LoanRepayment = {
      ...provisionalRepayment,
      installmentNumber,
      susuTransactionId
    };

    const newOutstanding = Math.round((app.outstandingPrincipal - payAmount) * 100) / 100;
    const paidInstallments = schedule.filter((s) => s.status === "paid").length;
    const nextDueDate = schedule.find((s) => s.status !== "paid")?.dueDate;

    const closed = newOutstanding <= 0;
    const updated: LoanApplication = {
      ...app,
      outstandingPrincipal: newOutstanding,
      totalRepaid: Math.round((app.totalRepaid + payAmount) * 100) / 100,
      installmentsPaid: paidInstallments,
      nextDueDate,
      status: closed ? "closed" : "disbursed",
      closedAt: closed ? new Date().toISOString() : app.closedAt,
      autoDebitFailCount: paymentSource === "susu_account" ? 0 : app.autoDebitFailCount,
      autoDebitRecoveryStage:
        paymentSource === "susu_account" ? undefined : app.autoDebitRecoveryStage,
      autoDebitLastFailedAt:
        paymentSource === "susu_account" ? undefined : app.autoDebitLastFailedAt,
      collateralLienAmount: closed ? 0 : app.collateralLienAmount
    };

    if (closed && (app.collateralLienAmount ?? 0) > 0) {
      try {
        await recomputeCustomerLoanCollateralLocked(context.tenantId, app.customerId, app.id);
      } catch (error) {
        console.warn(
          "[loans] collateral unlock skipped:",
          error instanceof Error ? error.message : error
        );
      }
    }

    if (supabase) {
      await supabase
        .from("loan_repayments")
        .update({
          installment_number: installmentNumber ?? null,
          susu_transaction_id: susuTransactionId ?? null
        })
        .eq("tenant_id", context.tenantId)
        .eq("id", repaymentId);
    } else {
      ensureMemory(context.tenantId).repayments.unshift(repayment);
    }

    await persistApplication(updated);
    return { application: updated, repayment, schedule };
  } catch (error) {
    if (paymentSource === "susu_account" && susuTransactionId) {
      await reverseSusuDebitForLoanRepayment({
        tenantId: context.tenantId,
        customerId: app.customerId,
        branchId,
        amount: payAmount,
        repaymentId,
        loanId,
        recordedByUserId: context.userId
      });
    }
    if (supabase) {
      await supabase
        .from("loan_repayments")
        .delete()
        .eq("tenant_id", context.tenantId)
        .eq("id", repaymentId);
    }
    throw error;
  }
}

export type LoanBorrowerRow = {
  customerId: string;
  fullName: string;
  phone: string;
  accountNumber?: string;
  accountStatus: string;
  location?: string;
  loanCount: number;
  activeLoanCount: number;
  totalOutstanding: number;
  latestLoanId: string;
  latestLoanStatus: LoanApplication["status"];
  latestAppliedAt?: string;
};

/** Customers who have at least one loan application (not the full Susu customer book). */
export async function listLoanBorrowers(
  tenantId: string,
  options?: { branchId?: string }
): Promise<LoanBorrowerRow[]> {
  const applications = await listLoanApplications(tenantId, options);
  const byCustomer = new Map<
    string,
    {
      apps: LoanApplication[];
    }
  >();
  for (const app of applications) {
    const bucket = byCustomer.get(app.customerId) ?? { apps: [] };
    bucket.apps.push(app);
    byCustomer.set(app.customerId, bucket);
  }

  const rows: LoanBorrowerRow[] = [];
  for (const [customerId, { apps }] of byCustomer) {
    const sorted = [...apps].sort((a, b) =>
      String(b.appliedAt ?? "").localeCompare(String(a.appliedAt ?? ""))
    );
    const latest = sorted[0]!;
    const customer = await getCustomerById(tenantId, customerId);
    rows.push({
      customerId,
      fullName: customer?.fullName ?? latest.customerName ?? "Borrower",
      phone: customer?.phone ?? "",
      accountNumber: customer?.accountNumber,
      accountStatus: customer?.status ?? "active",
      location: customer?.location,
      loanCount: apps.length,
      activeLoanCount: apps.filter((a) => a.status === "disbursed" || a.status === "approved")
        .length,
      totalOutstanding: Math.round(
        apps
          .filter((a) => a.status === "disbursed")
          .reduce((sum, a) => sum + (a.outstandingPrincipal ?? 0), 0) * 100
      ) / 100,
      latestLoanId: latest.id,
      latestLoanStatus: latest.status,
      latestAppliedAt: latest.appliedAt
    });
  }

  return rows.sort((a, b) => a.fullName.localeCompare(b.fullName));
}

export async function getLoansBootstrap(
  tenantId: string,
  branchId?: string
): Promise<{
  products: LoanProduct[];
  applications: LoanApplication[];
  groups: Awaited<ReturnType<typeof listLoanGroups>>;
  summary: {
    pendingApproval: number;
    approved: number;
    disbursed: number;
    closed: number;
    totalOutstanding: number;
    totalRepaid: number;
    overdueInstallments: number;
  };
}> {
  const [products, applications, groups] = await Promise.all([
    listLoanProducts(tenantId),
    listLoanApplications(tenantId, { branchId }),
    listLoanGroups(tenantId)
  ]);

  let overdueInstallments = 0;
  const disbursedLoans = applications.filter((a) => a.status === "disbursed");
  for (const loan of disbursedLoans) {
    const schedule = await listScheduleForLoan(tenantId, loan.id);
    overdueInstallments += schedule.filter((s) => s.status === "overdue").length;
  }

  return {
    products,
    applications,
    groups,
    summary: {
      pendingApproval: applications.filter((a) => a.status === "pending_approval").length,
      approved: applications.filter((a) => a.status === "approved").length,
      disbursed: disbursedLoans.length,
      closed: applications.filter((a) => a.status === "closed").length,
      totalOutstanding: disbursedLoans.reduce((sum, a) => sum + a.outstandingPrincipal, 0),
      totalRepaid: applications.reduce((sum, a) => sum + a.totalRepaid, 0),
      overdueInstallments
    }
  };
}
