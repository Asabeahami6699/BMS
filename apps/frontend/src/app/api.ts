import type {
  AccountType,
  CustomerRegistrationInput,
  NextOfKinDetails,
  Permission,
  Role,
  SusuNavVisibilityRow,
  TenantAddon,
  TenantProductModule
} from "@bms/shared";
import { isNetworkError, toUserFacingError } from "../lib/networkError";

export type { AccountType, TenantProductModule };

export type AppRole =
  | "super_admin"
  | "admin"
  | "field_agent"
  | "coordinator"
  | "auditor"
  | "accountant"
  | "teller"
  | "customer_service";

export type TenantRecord = {
  id: string;
  name: string;
  subscriptionStatus: "active" | "inactive";
  subscribedModules: TenantProductModule[];
  subscribedAddons?: TenantAddon[];
  reportsAnalytics?: boolean;
  createdAt?: string;
};

export type CommissionPolicy = {
  tenantId: string;
  currency: string;
  enabled: boolean;
  fieldAgentCommissionPercent: number;
  coordinatorCommissionPercent: number;
  basis: "gross_collections" | "net_collections";
  bonusRules: Array<{
    threshold: number;
    amount: number;
  }>;
};

export type AccountNumberPolicy = {
  tenantId: string;
  prefix: string;
  totalLength: 12;
};

export type PayslipLine = {
  key: string;
  label: string;
  amount: number;
};

export type Payslip = {
  id: string;
  tenantId: string;
  userId: string;
  role: AppRole;
  periodId: string;
  lines: PayslipLine[];
  deductionLines: PayslipLine[];
  grossPay: number;
  totalDeductions: number;
  netPay: number;
  runAt?: string;
};

export type StaffPayrollSetupRow = {
  userId: string;
  email?: string;
  fullName?: string;
  role: AppRole;
  status: "active" | "inactive";
  baseSalary: number;
  commissionPercentOverride: number | null;
  monthlyBonus: number;
  ssnitRatePercent: number | null;
  ssnitFixedAmount: number;
  welfareDeduction: number;
  loanDeduction: number;
  effectiveCommissionPercent: number;
  commissionsApply: boolean;
  defaultCommissionPercent: number;
  collectionsThisPeriod: number;
  projectedCommission: number;
  projectedTierBonus: number;
  projectedGross: number;
  projectedDeductions: number;
  projectedNet: number;
};

export type RolePayrollDefault = {
  tenantId: string;
  role: AppRole;
  baseSalary: number;
  monthlyBonus: number;
  ssnitRatePercent: number | null;
  ssnitFixedAmount: number;
  welfareDeduction: number;
  loanDeduction: number;
};

export type StaffPayrollSetupResponse = {
  period: {
    id: string;
    label: string;
    startDate: string;
    endDate: string;
  };
  rows: StaffPayrollSetupRow[];
  roleDefaults: RolePayrollDefault[];
  policy: {
    enabled: boolean;
    currency: string;
    bonusRules: Array<{ threshold: number; amount: number }>;
  };
};

export type UserPayrollProfile = {
  tenantId: string;
  userId: string;
  baseSalary: number;
  commissionPercentOverride: number | null;
  monthlyBonus: number;
  ssnitRatePercent: number | null;
  ssnitFixedAmount: number;
  welfareDeduction: number;
  loanDeduction: number;
};

export type TenantPayslipsResponse = {
  periodId: string;
  payslips: Payslip[];
};

export type RoleDefinition = {
  roleKey: string;
  displayName: string;
  duties: string[];
};

export type RoleAssignment = {
  userId: string;
  roleKey: string;
};
export type UserRecord = {
  userId: string;
  email: string;
  fullName?: string;
  role: AppRole;
  scopeType: "head_office" | "branch";
  branchId?: string;
  tenantId: string;
  status: "active" | "inactive";
  createdBy: string;
  createdAt?: string;
};

export type Customer = {
  id: string;
  fullName: string;
  email?: string;
  phone: string;
  location?: string;
  houseNumber?: string;
  accountType?: AccountType;
  idCardNumber?: string;
  photoUrl?: string;
  idCardPhotoUrl?: string;
  savingsOpeningFeeCollected?: boolean;
  savingsOpeningFeeRecovered?: number;
  nextOfKin?: NextOfKinDetails;
  accountNumber?: string;
  rejectionReason?: string;
  homeBranchId: string;
  assignedFieldAgentId?: string;
  createdByFieldAgentId?: string;
  assignedFieldAgentName?: string;
  createdByFieldAgentName?: string;
  dailyContributionAmount: number;
  lockedBalance?: number;
  accountBalance?: number;
  withdrawableBalance?: number;
  routeId?: string;
  status: "pending_activation" | "active" | "rejected" | "suspended" | "closed";
};

export type FieldRoute = {
  id: string;
  tenantId: string;
  name: string;
  area: string;
  branchId: string;
  assignedFieldAgentId?: string;
  status: "active" | "inactive";
  memberCount?: number;
  branchName?: string;
  branchCode?: string;
  assignedFieldAgentName?: string;
  createdAt?: string;
};

export type RouteMember = {
  id: string;
  fullName: string;
  phone: string;
  accountNumber?: string;
  status: string;
  assignedFieldAgentId?: string;
};

export type CustomerRequestType = "balance" | "withdrawal";
export type WithdrawalFulfillmentMode = "next_day_cash" | "momo" | "agent_next_day";

export type BalanceDisclosure = {
  id: string;
  tenantId: string;
  customerId: string;
  fieldAgentId: string;
  customerName?: string;
  fieldAgentName?: string;
  requestType: CustomerRequestType;
  status: "pending" | "approved" | "rejected" | "expired";
  balanceAmount?: number;
  withdrawalAmount?: number;
  fulfillmentMode?: WithdrawalFulfillmentMode;
  requestedAt: string;
  approvedAt?: string;
  expiresAt?: string;
  requestReason?: string;
  rejectedReason?: string;
  momoNumber?: string;
  momoAccountName?: string;
  payoutReference?: string;
  transactionProofImage?: string;
  generatedReceiptImage?: string;
  paidAt?: string;
};

export type RequestCustomerApprovalInput =
  | { type: "balance"; reason: string }
  | {
      type: "withdrawal";
      reason: string;
      amount: number;
      fulfillmentMode?: WithdrawalFulfillmentMode;
      momoNumber?: string;
      momoAccountName?: string;
    };

export type ApproveCustomerRequestInput = {
  payoutReference?: string;
  transactionProofImage?: string;
  generatedReceiptImage?: string;
  visibleHours?: number;
};

export type AgentNotification = {
  id: string;
  kind:
    | "registration_approved"
    | "registration_rejected"
    | "registration_pending"
    | "balance_disclosure_approved"
    | "balance_disclosure_rejected"
    | "balance_request_pending"
    | "withdrawal_request_approved"
    | "withdrawal_request_rejected"
    | "withdrawal_request_pending"
    | "withdrawal_momo_sent"
    | "float_requested"
    | "float_allocated"
    | "float_closed_pending_settlement"
    | "workspace_activity";
  title: string;
  body: string;
  customerId?: string;
  imageUrl?: string;
  readAt?: string;
  createdAt: string;
};

export type AuditLogRecord = {
  id: string;
  tenantId: string;
  actorUserId?: string;
  actorRole?: string;
  method: string;
  path: string;
  action: string;
  statusCode: number;
  branchId?: string;
  ipAddress?: string;
  createdAt: string;
};

export type Transaction = {
  id: string;
  customerId: string;
  type: "daily_susu" | "deposit" | "withdrawal";
  amount: number;
  transactionBranchId: string;
  createdAt: string;
  notes?: string;
  recordedByUserId?: string;
};

export type BranchCounterStatementLine = Transaction & {
  customerName: string;
  customerAccountNumber?: string;
  recordedByName: string;
  recordedByRole: string;
  homeBranchId?: string;
  fieldAgentId?: string;
};

export type BranchCounterStatementSummary = {
  date: string;
  branchId: string;
  transactionCount: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalDailySusu: number;
  netAmount: number;
  byStaff: Array<{
    userId: string;
    name: string;
    role: string;
    count: number;
    totalAmount: number;
  }>;
};

export type BranchCounterStatement = {
  lines: BranchCounterStatementLine[];
  summary: BranchCounterStatementSummary;
};

export type FieldAgentTodayCollection = {
  customerId: string;
  amount: number;
  createdAt: string;
  entryCount?: number;
};

export type FieldAgentTodayCollections = {
  customerIds: string[];
  totalAmount: number;
  items: FieldAgentTodayCollection[];
  batchStatus?: "draft" | "pending_approval" | "posted" | "rejected";
  batchId?: string;
};

export type CalloverVarianceType = "match" | "shortage" | "overage" | "unresolved";

export type CalloverReportLine = {
  customerId: string;
  customerName: string;
  documentAmount: number;
  appAmount: number;
  reconciledAmount?: number;
  varianceType: CalloverVarianceType;
  notes?: string;
};

export type SubmitCalloverReportInput = {
  lines: CalloverReportLine[];
  summary: {
    totalDocument: number;
    totalApp: number;
    totalVariance: number;
    unresolvedCount: number;
  };
  agentNotes?: string;
};

export type FieldAgentDashboard = {
  profile: {
    userId: string;
    fullName: string;
    email: string;
    branchId?: string;
    tenantName?: string;
    role: string;
  };
  period: { id: string; label: string };
  accountsCreatedThisMonth: number;
  totalCollectedThisMonth: number;
  todayCollections: FieldAgentTodayCollections;
  commission: {
    enabled: boolean;
    percent: number;
    basis: string;
    projectedAmount: number;
  };
  payroll: {
    periodId: string;
    projectedNetPay: number;
    grossPay: number;
    lines: Array<{ key: string; label: string; amount: number }>;
    fromPayslip: boolean;
  };
  performance: {
    activeCustomers: number;
    collectedToday: number;
    pendingToday: number;
    collectionRateToday: number;
    monthCollectionTarget: number;
    monthProgressPercent: number;
  };
};

export type LedgerEntry = {
  id: string;
  transactionId: string;
  entryType: "credit" | "debit";
  amount: number;
  balanceAfter: number;
  transactionBranchId: string;
  createdAt: string;
  recordedByName?: string;
  fieldAgentName?: string;
  performedByName?: string;
  transactionType?: string;
};

export type SummaryReport = {
  totalTransactions: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalDailySusu: number;
};

export type AgentReport = {
  fieldAgentId: string;
  totalCollections: number;
  dailySusuCount: number;
  depositCount: number;
  withdrawalCount: number;
};

export type BranchReport = {
  branchId: string;
  totalAmount: number;
  transactionCount: number;
  depositAmount: number;
  withdrawalAmount: number;
  dailySusuAmount: number;
};
export type Branch = {
  id: string;
  code: string;
  name: string;
  status: "active" | "inactive";
  createdAt?: string;
};

function normalizeApiBaseUrl(url: string): string {
  return url.replace(/\/+$/, "").replace(/\/api$/, "");
}

export const API_BASE_URL = normalizeApiBaseUrl(
  import.meta.env.VITE_API_URL ?? "http://localhost:4000"
);
const AUTH_STORAGE_KEY = "bms.auth.session";

const runtimeContext = {
  tenantId: "tenant-demo",
  branchId: "branch-a"
};

export type AuthMe = {
  userId: string;
  tenantId: string;
  role: AppRole;
  scopeType: "head_office" | "branch";
  branchId?: string;
  permissions: Permission[];
  email?: string;
  fullName?: string;
  tenantName?: string;
  subscribedModules?: TenantProductModule[];
  subscribedAddons?: TenantAddon[];
  reportsAnalytics?: boolean;
  susuNavVisibility?: SusuNavVisibilityRow[];
};

type AuthSession = {
  accessToken: string;
  user: AuthMe;
};

let authSession: AuthSession | null = loadStoredSession();

function loadStoredSession(): AuthSession | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

function persistSession(session: AuthSession | null): void {
  authSession = session;
  if (!session) {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    return;
  }
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
  runtimeContext.tenantId = session.user.tenantId;
  runtimeContext.branchId = session.user.branchId ?? runtimeContext.branchId;
}

export function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json"
  };
  if (authSession?.accessToken) {
    headers.Authorization = `Bearer ${authSession.accessToken}`;
  }
  return headers;
}

export function getAuthSession(): AuthSession | null {
  return authSession;
}

export function clearAuthSession(): void {
  persistSession(null);
}

function formatApiError(
  body: {
    error?: string;
    details?: {
      fieldErrors?: Record<string, string[]>;
      formErrors?: string[];
    };
  },
  status: number
): string {
  if (body.error && body.error !== "Invalid request body") {
    return body.error;
  }
  const fieldErrors = body.details?.fieldErrors ?? {};
  const parts = Object.entries(fieldErrors).flatMap(([field, messages]) =>
    messages.map((message) => `${field}: ${message}`)
  );
  const formErrors = body.details?.formErrors ?? [];
  const combined = [...formErrors, ...parts];
  if (combined.length > 0) {
    return combined.join("; ");
  }
  return body.error ?? `Request failed (${status})`;
}

export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        details?: {
          fieldErrors?: Record<string, string[]>;
          formErrors?: string[];
        };
      };
      if (response.status === 413) {
        throw new Error(body.error ?? "Photo or request data is too large. Try a smaller image.");
      }
      throw new Error(formatApiError(body, response.status));
    }
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && !isNetworkError(error)) {
      throw error;
    }
    throw new Error(toUserFacingError(error, "Request failed"));
  }
}

export async function login(email: string, password: string): Promise<AuthSession> {
  try {
    const payload = await fetchJson<AuthSession>(`${API_BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    persistSession(payload);
    return payload;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Login failed";
    if (message.toLowerCase().includes("invalid email or password")) {
      throw new Error("Invalid email or password.");
    }
    throw new Error(message);
  }
}

export async function logout(): Promise<void> {
  if (authSession?.accessToken) {
    await fetch(`${API_BASE_URL}/api/v1/auth/logout`, {
      method: "POST",
      headers: authHeaders()
    }).catch(() => undefined);
  }
  clearAuthSession();
}

export function getTenantId(): string {
  return runtimeContext.tenantId;
}

export function getRuntimeBranchId(): string {
  return runtimeContext.branchId;
}

export function setRuntimeBranchId(branchId: string): void {
  runtimeContext.branchId = branchId;
}

export async function getAuthMe(): Promise<AuthMe> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/api/v1/auth/me`, {
      headers: authHeaders()
    });
  } catch (error) {
    throw error;
  }
  if (response.status === 401) {
    clearAuthSession();
    throw new Error("Session expired");
  }
  if (!response.ok) {
    throw new Error("Failed to load auth context");
  }
  const me = (await response.json()) as AuthMe;
  if (authSession) {
    persistSession({ ...authSession, user: me });
  }
  return me;
}

export async function syncRuntimeContext(): Promise<AuthMe> {
  return getAuthMe();
}

export async function changeMyPassword(currentPassword: string, newPassword: string): Promise<void> {
  await fetchJson(`${API_BASE_URL}/api/v1/auth/change-password`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ currentPassword, newPassword })
  });
}

export async function listBranches(): Promise<Branch[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/branches`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load branches");
  }
  return response.json() as Promise<Branch[]>;
}

export async function createBranch(payload: { code: string; name: string; id?: string }): Promise<Branch> {
  const response = await fetch(`${API_BASE_URL}/api/v1/branches`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to create branch");
  }
  return response.json() as Promise<Branch>;
}

export async function updateBranch(
  branchId: string,
  payload: { code?: string; name?: string; status?: "active" | "inactive" }
): Promise<Branch> {
  const response = await fetch(`${API_BASE_URL}/api/v1/branches/${branchId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to update branch");
  }
  return response.json() as Promise<Branch>;
}

export async function deleteBranch(branchId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/branches/${branchId}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to delete branch");
  }
}

export async function getCommissionPolicy(): Promise<CommissionPolicy> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tenant/commission-policy`, {
    headers: authHeaders()
  });

  if (!response.ok) {
    throw new Error("Failed to load commission policy");
  }

  return response.json() as Promise<CommissionPolicy>;
}

export async function updateCommissionPolicy(body: CommissionPolicy): Promise<CommissionPolicy> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tenant/commission-policy`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error("Only admin can update commission policy.");
  }

  return response.json() as Promise<CommissionPolicy>;
}

export async function getAccountNumberPolicy(): Promise<AccountNumberPolicy> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tenant/account-number-policy`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load account number policy");
  }
  return response.json() as Promise<AccountNumberPolicy>;
}

export async function updateAccountNumberPolicy(body: {
  prefix: string;
}): Promise<AccountNumberPolicy> {
  const response = await fetch(`${API_BASE_URL}/api/v1/tenant/account-number-policy`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Failed to save account number prefix");
  }
  return response.json() as Promise<AccountNumberPolicy>;
}

export async function getFieldAgentDashboard(): Promise<FieldAgentDashboard> {
  return fetchJson<FieldAgentDashboard>(`${API_BASE_URL}/api/v1/field-agents/me/dashboard`, {
    headers: authHeaders()
  });
}

export async function getFieldAgentTodayCollections(): Promise<FieldAgentTodayCollections> {
  return fetchJson<FieldAgentTodayCollections>(
    `${API_BASE_URL}/api/v1/field-agents/me/collections/today`,
    { headers: authHeaders() }
  );
}

export async function addCollectionBatchLine(payload: {
  customerId: string;
  amount: number;
  transactionBranchId: string;
  notes?: string;
  clientLineId?: string;
}): Promise<FieldAgentTodayCollections> {
  return fetchJson<FieldAgentTodayCollections>(
    `${API_BASE_URL}/api/v1/field-agents/me/collection-batches/lines`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }
  );
}

export async function submitCollectionBatchForApproval(
  payload: SubmitCalloverReportInput
): Promise<{ batchId: string; status: string; calloverReportId: string }> {
  return fetchJson<{ batchId: string; status: string; calloverReportId: string }>(
    `${API_BASE_URL}/api/v1/field-agents/me/collection-batches/submit-for-approval`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }
  );
}

export type CollectionBatchLine = {
  id: string;
  customerId: string;
  amount: number;
  notes?: string;
  clientLineId?: string;
  transactionId?: string;
  createdAt: string;
};

export type PendingCollectionBatch = {
  id: string;
  tenantId: string;
  fieldAgentId: string;
  businessDate: string;
  status: "draft" | "pending_approval" | "posted" | "rejected";
  totalAmount: number;
  lineCount: number;
  calloverReportId?: string;
  agentNotes?: string;
  submittedAt?: string;
  postedAt?: string;
  postedBy?: string;
  lines: CollectionBatchLine[];
  fieldAgentName: string;
  fieldAgentEmail?: string;
  branchId?: string;
};

export async function listPendingCollectionBatches(params?: {
  businessDate?: string;
  fieldAgentId?: string;
  branchId?: string;
}): Promise<PendingCollectionBatch[]> {
  const query = new URLSearchParams();
  if (params?.businessDate) {
    query.set("businessDate", params.businessDate);
  }
  if (params?.fieldAgentId) {
    query.set("fieldAgentId", params.fieldAgentId);
  }
  if (params?.branchId) {
    query.set("branchId", params.branchId);
  }
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return fetchJson<PendingCollectionBatch[]>(
    `${API_BASE_URL}/api/v1/collection-batches/pending${suffix}`,
    { headers: authHeaders() }
  );
}

export async function getCollectionBatch(batchId: string): Promise<PendingCollectionBatch> {
  return fetchJson<PendingCollectionBatch>(`${API_BASE_URL}/api/v1/collection-batches/${batchId}`, {
    headers: authHeaders()
  });
}

export async function postCollectionBatch(batchId: string): Promise<PendingCollectionBatch> {
  return fetchJson<PendingCollectionBatch>(
    `${API_BASE_URL}/api/v1/collection-batches/${batchId}/post`,
    {
      method: "POST",
      headers: authHeaders()
    }
  );
}

export async function postAllCollectionBatches(body?: {
  businessDate?: string;
  fieldAgentId?: string;
  branchId?: string;
}): Promise<{ posted: number; batchIds: string[] }> {
  return fetchJson<{ posted: number; batchIds: string[] }>(
    `${API_BASE_URL}/api/v1/collection-batches/post-all`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(body ?? {})
    }
  );
}

export async function submitCalloverReport(
  payload: SubmitCalloverReportInput
): Promise<{ id: string; status: string }> {
  return fetchJson<{ id: string; status: string }>(
    `${API_BASE_URL}/api/v1/field-agents/me/callover/report`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }
  );
}

export async function listAgentBalanceDisclosures(): Promise<BalanceDisclosure[]> {
  return fetchJson<BalanceDisclosure[]>(
    `${API_BASE_URL}/api/v1/field-agents/me/balance-disclosures`,
    { headers: authHeaders() }
  );
}

export async function requestCustomerBalance(
  customerId: string,
  reason: string
): Promise<BalanceDisclosure> {
  return requestCustomerApproval(customerId, { type: "balance", reason });
}

export async function requestCustomerApproval(
  customerId: string,
  payload: RequestCustomerApprovalInput
): Promise<BalanceDisclosure> {
  return fetchJson<BalanceDisclosure>(
    `${API_BASE_URL}/api/v1/field-agents/me/customers/${customerId}/customer-request`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }
  );
}

export async function listPendingBalanceDisclosures(): Promise<BalanceDisclosure[]> {
  return fetchJson<BalanceDisclosure[]>(
    `${API_BASE_URL}/api/v1/customers/balance-disclosures/pending`,
    { headers: authHeaders() }
  );
}

export async function approveBalanceDisclosure(
  disclosureId: string,
  body?: ApproveCustomerRequestInput
): Promise<BalanceDisclosure> {
  return fetchJson<BalanceDisclosure>(
    `${API_BASE_URL}/api/v1/customers/balance-disclosures/${disclosureId}/approve`,
    {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(body ?? {})
    }
  );
}

export async function rejectBalanceDisclosure(
  disclosureId: string,
  reason?: string
): Promise<BalanceDisclosure> {
  return fetchJson<BalanceDisclosure>(
    `${API_BASE_URL}/api/v1/customers/balance-disclosures/${disclosureId}/reject`,
    {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify({ reason })
    }
  );
}

export async function getMyPayslips(): Promise<Payslip[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/payroll/payslips/me`, {
    headers: authHeaders()
  });

  if (!response.ok) {
    throw new Error("Failed to load payslips");
  }

  return response.json() as Promise<Payslip[]>;
}

export type PayrollBootstrapResponse = StaffPayrollSetupResponse & {
  payslips: Payslip[];
  myPayslips: Payslip[];
};

export async function getPayrollBootstrap(): Promise<PayrollBootstrapResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/payroll/bootstrap`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load payroll");
  }
  return response.json() as Promise<PayrollBootstrapResponse>;
}

export async function getStaffPayrollSetup(): Promise<StaffPayrollSetupResponse> {
  const response = await fetch(`${API_BASE_URL}/api/v1/payroll/staff-setup`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load staff payroll setup");
  }
  return response.json() as Promise<StaffPayrollSetupResponse>;
}

export async function updateRolePayrollDefault(
  role: string,
  body: {
    baseSalary?: number;
    monthlyBonus?: number;
    ssnitRatePercent?: number | null;
    ssnitFixedAmount?: number;
    welfareDeduction?: number;
    loanDeduction?: number;
  }
): Promise<RolePayrollDefault> {
  const response = await fetch(`${API_BASE_URL}/api/v1/payroll/role-defaults/${role}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Failed to save role payroll template");
  }
  return response.json() as Promise<RolePayrollDefault>;
}

export async function updateUserPayrollProfile(
  userId: string,
  body: {
    baseSalary?: number;
    commissionPercentOverride?: number | null;
    monthlyBonus?: number;
    ssnitRatePercent?: number | null;
    ssnitFixedAmount?: number;
    welfareDeduction?: number;
    loanDeduction?: number;
    customPayroll?: boolean;
  }
): Promise<UserPayrollProfile> {
  const response = await fetch(`${API_BASE_URL}/api/v1/payroll/profiles/${userId}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Failed to save payroll profile");
  }
  return response.json() as Promise<UserPayrollProfile>;
}

export async function runPayrollForPeriod(): Promise<Payslip[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/payroll/run`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ useStaffSetup: true })
  });
  if (!response.ok) {
    const err = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Failed to run payroll");
  }
  return response.json() as Promise<Payslip[]>;
}

export async function getTenantPayslips(periodId?: string): Promise<TenantPayslipsResponse> {
  const query = periodId ? `?periodId=${encodeURIComponent(periodId)}` : "";
  const response = await fetch(`${API_BASE_URL}/api/v1/payroll/payslips${query}`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load payslips");
  }
  return response.json() as Promise<TenantPayslipsResponse>;
}

export type BuiltinRolePermissionView = {
  role: string;
  defaultDuties: Permission[];
  effectiveDuties: Permission[];
  isCustomized: boolean;
  updatedAt?: string;
  updatedBy?: string;
};

export async function getBuiltinRolePermissions(): Promise<BuiltinRolePermissionView[]> {
  return fetchJson<BuiltinRolePermissionView[]>(`${API_BASE_URL}/api/v1/admin/roles/builtin`, {
    headers: authHeaders()
  });
}

export async function saveBuiltinRolePermissions(
  role: string,
  duties: Permission[]
): Promise<BuiltinRolePermissionView> {
  return fetchJson<BuiltinRolePermissionView>(`${API_BASE_URL}/api/v1/admin/roles/builtin/${role}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ duties })
  });
}

export async function resetBuiltinRolePermissions(role: string): Promise<BuiltinRolePermissionView> {
  return fetchJson<BuiltinRolePermissionView>(`${API_BASE_URL}/api/v1/admin/roles/builtin/${role}`, {
    method: "DELETE",
    headers: authHeaders()
  });
}

export type SusuNavVisibilityConfigItem = {
  navPath: string;
  label: string;
  description: string;
  roles: Role[];
  anyPermissions: Permission[];
  defaultRoles: Role[];
  defaultAnyPermissions: Permission[];
  isCustomized: boolean;
};

export async function getSusuNavVisibilityConfig(): Promise<SusuNavVisibilityConfigItem[]> {
  return fetchJson<SusuNavVisibilityConfigItem[]>(`${API_BASE_URL}/api/v1/admin/roles/susu-nav`, {
    headers: authHeaders()
  });
}

export async function saveSusuNavVisibilityConfig(
  items: Array<{ navPath: string; roles: Role[]; anyPermissions: Permission[] }>
): Promise<SusuNavVisibilityConfigItem[]> {
  return fetchJson<SusuNavVisibilityConfigItem[]>(`${API_BASE_URL}/api/v1/admin/roles/susu-nav`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ items })
  });
}

export async function resetSusuNavVisibilityConfig(): Promise<SusuNavVisibilityConfigItem[]> {
  return fetchJson<SusuNavVisibilityConfigItem[]>(`${API_BASE_URL}/api/v1/admin/roles/susu-nav`, {
    method: "DELETE",
    headers: authHeaders()
  });
}

export async function getRoles(): Promise<RoleDefinition[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/roles`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load roles");
  }
  return response.json() as Promise<RoleDefinition[]>;
}

export async function createRole(payload: RoleDefinition): Promise<RoleDefinition> {
  return fetchJson<RoleDefinition>(`${API_BASE_URL}/api/v1/admin/roles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function assignRole(payload: RoleAssignment): Promise<RoleAssignment> {
  return fetchJson<RoleAssignment>(`${API_BASE_URL}/api/v1/admin/roles/assign`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function getRoleAssignments(): Promise<RoleAssignment[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/roles/assignments`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load role assignments.");
  }
  return response.json() as Promise<RoleAssignment[]>;
}

export async function createUser(payload: {
  userId?: string;
  email: string;
  password: string;
  role: AppRole;
  scopeType: "head_office" | "branch";
  branchId?: string;
  fullName?: string;
}): Promise<UserRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Failed to create user.");
  }
  return response.json() as Promise<UserRecord>;
}

export type FieldAgentOption = {
  userId: string;
  email: string;
  fullName?: string;
  branchId?: string;
  status: "active" | "inactive";
};

export type FieldAgentRosterRow = FieldAgentOption & {
  displayName: string;
  branchLabel: string;
  activeCustomers: number;
  pendingRegistrations: number;
  pendingRequests: number;
  totalCollections: number;
  transactionCount: number;
  dailySusuCount: number;
  depositCount: number;
  withdrawalCount: number;
};

export async function listFieldAgents(): Promise<FieldAgentOption[]> {
  return fetchJson<FieldAgentOption[]>(`${API_BASE_URL}/api/v1/users/field-agents`, {
    headers: authHeaders()
  });
}

export type CoordinatorRosterRow = {
  userId: string;
  email: string;
  fullName?: string;
  displayName: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
  branchLabel: string;
  status: "active" | "inactive";
  pendingRegistrations: number;
  pendingRequests: number;
  approvalsProcessed: number;
  rejectionsProcessed: number;
  activeCustomersInScope: number;
  fieldAgentsInBranch: number;
};

export async function listCoordinatorRoster(): Promise<CoordinatorRosterRow[]> {
  return fetchJson<CoordinatorRosterRow[]>(`${API_BASE_URL}/api/v1/users/coordinators/roster`, {
    headers: authHeaders()
  });
}

export async function listFieldRoutes(): Promise<FieldRoute[]> {
  return fetchJson<FieldRoute[]>(`${API_BASE_URL}/api/v1/routes`, { headers: authHeaders() });
}

export async function createFieldRoute(payload: {
  name: string;
  area: string;
  branchId: string;
  assignedFieldAgentId?: string | null;
  status?: "active" | "inactive";
}): Promise<FieldRoute> {
  return fetchJson<FieldRoute>(`${API_BASE_URL}/api/v1/routes`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function updateFieldRoute(
  routeId: string,
  payload: {
    name?: string;
    area?: string;
    branchId?: string;
    assignedFieldAgentId?: string | null;
    status?: "active" | "inactive";
    syncAgentToMembers?: boolean;
  }
): Promise<FieldRoute> {
  return fetchJson<FieldRoute>(`${API_BASE_URL}/api/v1/routes/${routeId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function deleteFieldRoute(routeId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/routes/${routeId}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to delete route");
  }
}

export async function listRouteMembers(routeId: string): Promise<RouteMember[]> {
  return fetchJson<RouteMember[]>(`${API_BASE_URL}/api/v1/routes/${routeId}/members`, {
    headers: authHeaders()
  });
}

export async function setRouteMembers(
  routeId: string,
  customerIds: string[]
): Promise<{ memberCount: number }> {
  return fetchJson<{ memberCount: number }>(`${API_BASE_URL}/api/v1/routes/${routeId}/members`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({ customerIds })
  });
}

export async function listUsers(): Promise<UserRecord[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to list users.");
  }
  const rows = (await response.json()) as UserRecord[];
  return rows.map((row) => ({
    ...row,
    status: row.status ?? "active"
  }));
}

export async function updateUser(
  userId: string,
  payload: {
    email?: string;
    fullName?: string;
    role?: AppRole;
    scopeType?: "head_office" | "branch";
    branchId?: string | null;
    status?: "active" | "inactive";
  }
): Promise<UserRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to update user");
  }
  return response.json() as Promise<UserRecord>;
}

export async function resetUserPassword(userId: string, password: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/${userId}/reset-password`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ password })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to reset password");
  }
}

export async function deleteUser(userId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/${userId}`, {
    method: "DELETE",
    headers: authHeaders()
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to delete user");
  }
}

export async function exportUsersCsv(): Promise<string> {
  const response = await fetch(`${API_BASE_URL}/api/v1/users/export.csv`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to export users CSV.");
  }
  return response.text();
}

export async function listCustomers(): Promise<Customer[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/customers`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load customers");
  }
  return response.json() as Promise<Customer[]>;
}

export type CustomerBootstrapResponse = {
  customers: Customer[];
  branches: Branch[];
};

export async function getCustomerBootstrap(): Promise<CustomerBootstrapResponse> {
  return fetchJson<CustomerBootstrapResponse>(`${API_BASE_URL}/api/v1/customers/bootstrap`, {
    headers: authHeaders()
  });
}

export type CoordinatorBootstrapResponse = {
  customers: Customer[];
  pendingRegistrations: Customer[];
  pendingRequests: BalanceDisclosure[];
  summary: SummaryReport;
  agents: AgentReport[];
  branchReports: BranchReport[];
  branches: Branch[];
};

export async function getCoordinatorBootstrap(branchId?: string): Promise<CoordinatorBootstrapResponse> {
  const query = branchId?.trim() ? `?branchId=${encodeURIComponent(branchId)}` : "";
  return fetchJson<CoordinatorBootstrapResponse>(
    `${API_BASE_URL}/api/v1/reports/coordinator-bootstrap${query}`,
    { headers: authHeaders() }
  );
}

export type AgentsBootstrapResponse = {
  agents: FieldAgentOption[];
  customers: Customer[];
  reports: AgentReport[];
  pending: BalanceDisclosure[];
  branches: Branch[];
};

export async function getAgentsBootstrap(branchId?: string): Promise<AgentsBootstrapResponse> {
  const query = branchId?.trim() ? `?branchId=${encodeURIComponent(branchId)}` : "";
  return fetchJson<AgentsBootstrapResponse>(
    `${API_BASE_URL}/api/v1/users/agents-bootstrap${query}`,
    { headers: authHeaders() }
  );
}

export type CoordinatorsBootstrapResponse = {
  roster: CoordinatorRosterRow[];
  branches: Branch[];
};

export async function getCoordinatorsBootstrap(): Promise<CoordinatorsBootstrapResponse> {
  return fetchJson<CoordinatorsBootstrapResponse>(
    `${API_BASE_URL}/api/v1/users/coordinators/bootstrap`,
    { headers: authHeaders() }
  );
}

export type RoutesBootstrapResponse = {
  routes: FieldRoute[];
  branches: Branch[];
};

export async function getRoutesBootstrap(): Promise<RoutesBootstrapResponse> {
  return fetchJson<RoutesBootstrapResponse>(`${API_BASE_URL}/api/v1/routes/bootstrap`, {
    headers: authHeaders()
  });
}

export type WithdrawalsBootstrapResponse = {
  withdrawals: BalanceDisclosure[];
  branches: Branch[];
};

export async function getWithdrawalsBootstrap(branchId?: string): Promise<WithdrawalsBootstrapResponse> {
  const query = branchId?.trim() ? `?branchId=${encodeURIComponent(branchId)}` : "";
  return fetchJson<WithdrawalsBootstrapResponse>(
    `${API_BASE_URL}/api/v1/reports/withdrawals-bootstrap${query}`,
    { headers: authHeaders() }
  );
}

export type GroupSavingsBootstrapResponse = {
  members: Customer[];
  branches: Branch[];
  totals: {
    totalMembers: number;
    activeMembers: number;
    pendingMembers: number;
    totalDailyPlan: number;
  };
};

export async function getGroupSavingsBootstrap(
  branchId?: string
): Promise<GroupSavingsBootstrapResponse> {
  const query = branchId?.trim() ? `?branchId=${encodeURIComponent(branchId)}` : "";
  return fetchJson<GroupSavingsBootstrapResponse>(
    `${API_BASE_URL}/api/v1/reports/group-savings-bootstrap${query}`,
    { headers: authHeaders() }
  );
}

export type PerformanceBootstrapResponse = {
  summary: SummaryReport;
  agents: AgentReport[];
  branchReports: BranchReport[];
  branches: Branch[];
  agentNames: Record<string, string>;
};

export async function getPerformanceBootstrap(
  branchId?: string
): Promise<PerformanceBootstrapResponse> {
  const query = branchId?.trim() ? `?branchId=${encodeURIComponent(branchId)}` : "";
  return fetchJson<PerformanceBootstrapResponse>(
    `${API_BASE_URL}/api/v1/reports/performance-bootstrap${query}`,
    { headers: authHeaders() }
  );
}

export type DailyTrendPoint = {
  date: string;
  deposits: number;
  withdrawals: number;
  dailySusu: number;
  transactionCount: number;
  net: number;
};

export type CustomerAccountMix = {
  susu: number;
  savings: number;
  group: number;
  meba_daakye: number;
  pending: number;
  totalActive: number;
};

export type ReportsAnalyticsBootstrapResponse = {
  summary: SummaryReport;
  agents: AgentReport[];
  branchReports: BranchReport[];
  branches: Branch[];
  agentNames: Record<string, string>;
  dailyTrend: DailyTrendPoint[];
  accountMix: CustomerAccountMix;
  pending: {
    registrations: number;
    agentRequests: number;
    withdrawals: number;
    balanceInquiries: number;
  };
  withdrawals: {
    pending: number;
    approved: number;
    rejected: number;
    pendingAmount: number;
  };
};

export async function getReportsAnalyticsBootstrap(
  branchId?: string
): Promise<ReportsAnalyticsBootstrapResponse> {
  const query = branchId?.trim() ? `?branchId=${encodeURIComponent(branchId)}` : "";
  return fetchJson<ReportsAnalyticsBootstrapResponse>(
    `${API_BASE_URL}/api/v1/reports/analytics-bootstrap${query}`,
    { headers: authHeaders() }
  );
}

export async function createCustomer(payload: {
  fullName: string;
  phone: string;
  homeBranchId: string;
  assignedFieldAgentId: string;
  dailyContributionAmount: number;
}): Promise<Customer> {
  const response = await fetch(`${API_BASE_URL}/api/v1/customers`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Failed to create customer");
  }
  return response.json() as Promise<Customer>;
}

export async function listTransactions(): Promise<Transaction[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/transactions`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load transactions");
  }
  return response.json() as Promise<Transaction[]>;
}

export type BranchFloatSession = {
  id: string;
  tenantId: string;
  branchId: string;
  cashierUserId: string;
  businessDate: string;
  status: "requested" | "approved" | "open" | "closed" | "settled" | "rejected";
  openingFloat: number;
  expectedClosing: number | null;
  actualClosing: number | null;
  variance: number | null;
  totalDeposits: number;
  totalWithdrawals: number;
  totalDailySusu: number;
  transactionCount: number;
  requestedAt: string;
  requestedNote?: string;
  allocatedBy?: string;
  allocatedAt?: string;
  closedAt?: string;
  settledBy?: string;
  settledAt?: string;
  varianceNote?: string;
};

export type BranchFloatSummary = {
  expectedCash: number;
  canTransact: boolean;
  statusLabel: string;
} | null;

export type BranchCounterBootstrapResponse = {
  customers: Customer[];
  branches: Branch[];
  statement: BranchCounterStatement | null;
  floatSession: BranchFloatSession | null;
  floatSummary: BranchFloatSummary;
  pendingFloatRequests: BranchFloatSession[];
};

export async function requestBranchFloat(payload: {
  branchId: string;
  requestedAmount: number;
  note?: string;
}): Promise<BranchFloatSession> {
  const res = await fetchJson<{ session: BranchFloatSession }>(
    `${API_BASE_URL}/api/v1/transactions/branch-float/request`,
    { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) }
  );
  return res.session;
}

export async function allocateBranchFloat(
  sessionId: string,
  openingFloat: number
): Promise<BranchFloatSession> {
  const res = await fetchJson<{ session: BranchFloatSession }>(
    `${API_BASE_URL}/api/v1/transactions/branch-float/${sessionId}/allocate`,
    { method: "POST", headers: authHeaders(), body: JSON.stringify({ openingFloat }) }
  );
  return res.session;
}

export async function closeBranchFloat(
  sessionId: string,
  payload: { actualClosing: number; varianceNote?: string }
): Promise<BranchFloatSession> {
  const res = await fetchJson<{ session: BranchFloatSession }>(
    `${API_BASE_URL}/api/v1/transactions/branch-float/${sessionId}/close`,
    { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) }
  );
  return res.session;
}

export async function listPendingBranchFloats(): Promise<BranchFloatSession[]> {
  const res = await fetchJson<{ sessions: BranchFloatSession[] }>(
    `${API_BASE_URL}/api/v1/transactions/branch-float/pending`,
    { headers: authHeaders() }
  );
  return res.sessions;
}

export async function listBranchFloatSessions(options?: {
  date?: string;
  status?: BranchFloatSession["status"];
}): Promise<BranchFloatSession[]> {
  const params = new URLSearchParams();
  if (options?.date) {
    params.set("date", options.date);
  }
  if (options?.status) {
    params.set("status", options.status);
  }
  const query = params.toString();
  const res = await fetchJson<{ sessions: BranchFloatSession[] }>(
    `${API_BASE_URL}/api/v1/transactions/branch-float/sessions${query ? `?${query}` : ""}`,
    { headers: authHeaders() }
  );
  return res.sessions;
}

export async function pushBranchFloat(payload: {
  branchId: string;
  cashierUserId: string;
  openingFloat: number;
  businessDate?: string;
}): Promise<BranchFloatSession> {
  const res = await fetchJson<{ session: BranchFloatSession }>(
    `${API_BASE_URL}/api/v1/transactions/branch-float/push`,
    { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) }
  );
  return res.session;
}

export async function settleBranchFloat(sessionId: string): Promise<BranchFloatSession> {
  const res = await fetchJson<{ session: BranchFloatSession }>(
    `${API_BASE_URL}/api/v1/transactions/branch-float/${sessionId}/settle`,
    { method: "POST", headers: authHeaders(), body: JSON.stringify({}) }
  );
  return res.session;
}

export async function getBranchCounterBootstrap(
  branchId: string,
  date: string
): Promise<BranchCounterBootstrapResponse> {
  const params = new URLSearchParams();
  if (branchId) params.set("branchId", branchId);
  if (date) params.set("date", date);
  const query = params.toString();
  return fetchJson<BranchCounterBootstrapResponse>(
    `${API_BASE_URL}/api/v1/transactions/branch-counter-bootstrap${query ? `?${query}` : ""}`,
    { headers: authHeaders() }
  );
}

export async function getBranchCounterStatement(
  branchId: string,
  date: string
): Promise<BranchCounterStatement> {
  const params = new URLSearchParams({ branchId, date });
  return fetchJson<BranchCounterStatement>(
    `${API_BASE_URL}/api/v1/transactions/branch-counter-statement?${params}`,
    { headers: authHeaders() }
  );
}

export async function createTransaction(payload: {
  customerId: string;
  type: "daily_susu" | "deposit" | "withdrawal";
  amount: number;
  transactionBranchId: string;
  notes?: string;
}): Promise<Transaction> {
  const idempotencyKey = crypto.randomUUID();
  return fetchJson<Transaction>(`${API_BASE_URL}/api/v1/transactions`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Idempotency-Key": idempotencyKey
    },
    body: JSON.stringify(payload)
  });
}

export async function getCustomerLedger(customerId: string): Promise<LedgerEntry[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/ledger/customers/${customerId}`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load ledger");
  }
  return response.json() as Promise<LedgerEntry[]>;
}

export async function getSummaryReport(branchId?: string): Promise<SummaryReport> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
  const response = await fetch(`${API_BASE_URL}/api/v1/reports/summary${query}`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load summary report");
  }
  return response.json() as Promise<SummaryReport>;
}

export async function getAgentReport(branchId?: string): Promise<AgentReport[]> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
  const response = await fetch(`${API_BASE_URL}/api/v1/reports/agents${query}`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load agent report");
  }
  return response.json() as Promise<AgentReport[]>;
}

export async function getBranchReport(branchId?: string): Promise<BranchReport[]> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
  const response = await fetch(`${API_BASE_URL}/api/v1/reports/branches${query}`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load branch report");
  }
  return response.json() as Promise<BranchReport[]>;
}

export async function exportReportsCsv(branchId?: string): Promise<string> {
  const query = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
  const response = await fetch(`${API_BASE_URL}/api/v1/reports/export.csv${query}`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to export reports CSV.");
  }
  return response.text();
}

export async function listPlatformTenants(): Promise<TenantRecord[]> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/tenants`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load companies");
  }
  return response.json() as Promise<TenantRecord[]>;
}

export async function createPlatformTenant(payload: {
  id: string;
  name: string;
  subscriptionStatus: "active" | "inactive";
  subscribedModules: TenantProductModule[];
  subscribedAddons?: TenantAddon[];
}): Promise<TenantRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/tenants`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to register company");
  }
  return response.json() as Promise<TenantRecord>;
}

export async function updateTenantSubscription(
  tenantId: string,
  subscriptionStatus: "active" | "inactive"
): Promise<TenantRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/tenants/${tenantId}/subscription`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ subscriptionStatus })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to update subscription");
  }
  return response.json() as Promise<TenantRecord>;
}

export async function updateTenantModules(
  tenantId: string,
  subscribedModules: TenantProductModule[]
): Promise<TenantRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/tenants/${tenantId}/modules`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ subscribedModules })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to update product modules");
  }
  return response.json() as Promise<TenantRecord>;
}

export async function updateTenantAddons(
  tenantId: string,
  subscribedAddons: TenantAddon[]
): Promise<TenantRecord> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/tenants/${tenantId}/addons`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ subscribedAddons })
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to update add-ons");
  }
  return response.json() as Promise<TenantRecord>;
}

export async function submitCustomerRegistration(
  payload: CustomerRegistrationInput
): Promise<Customer> {
  return fetchJson<Customer>(`${API_BASE_URL}/api/v1/customers/registrations`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function searchCustomers(q: string): Promise<Customer[]> {
  const query = encodeURIComponent(q);
  return fetchJson<Customer[]>(`${API_BASE_URL}/api/v1/customers/search?q=${query}`, {
    headers: authHeaders()
  });
}

export async function listAgentNotifications(): Promise<AgentNotification[]> {
  return fetchJson<AgentNotification[]>(`${API_BASE_URL}/api/v1/customers/notifications/me`, {
    headers: authHeaders()
  });
}

export async function listAuditLogs(options?: {
  limit?: number;
  offset?: number;
}): Promise<AuditLogRecord[]> {
  const params = new URLSearchParams();
  if (options?.limit != null) {
    params.set("limit", String(options.limit));
  }
  if (options?.offset != null) {
    params.set("offset", String(options.offset));
  }
  const q = params.toString();
  return fetchJson<AuditLogRecord[]>(
    `${API_BASE_URL}/api/v1/audit-logs${q ? `?${q}` : ""}`,
    { headers: authHeaders() }
  );
}

export async function markAgentNotificationRead(notificationId: string): Promise<void> {
  await fetchJson(`${API_BASE_URL}/api/v1/customers/notifications/${notificationId}/read`, {
    method: "PATCH",
    headers: authHeaders()
  });
}

export async function approveCustomer(customerId: string): Promise<Customer> {
  return fetchJson<Customer>(`${API_BASE_URL}/api/v1/customers/${customerId}/approve`, {
    method: "PATCH",
    headers: authHeaders()
  });
}

export async function rejectCustomer(customerId: string, reason?: string): Promise<Customer> {
  return fetchJson<Customer>(`${API_BASE_URL}/api/v1/customers/${customerId}/reject`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ reason })
  });
}

export async function assignCustomerFieldAgent(
  customerId: string,
  assignedFieldAgentId: string | null
): Promise<Customer> {
  return fetchJson<Customer>(`${API_BASE_URL}/api/v1/customers/${customerId}/assignment`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ assignedFieldAgentId })
  });
}

export async function syncOfflineBatch(
  items: Array<
    | { type: "customer_registration"; clientId: string; payload: CustomerRegistrationInput }
    | {
        type: "daily_collection";
        clientId: string;
        payload: {
          customerId: string;
          amount: number;
          transactionBranchId: string;
          notes?: string;
          type?: "daily_susu";
        };
      }
  >
): Promise<{ results: Array<{ clientId: string; ok: boolean; error?: string; resourceId?: string }> }> {
  return fetchJson(`${API_BASE_URL}/api/v1/sync/batch`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ items })
  });
}

export async function createTenantAdmin(
  tenantId: string,
  payload: { email: string; password: string; fullName: string }
): Promise<AuthMe> {
  const response = await fetch(`${API_BASE_URL}/api/v1/platform/tenants/${tenantId}/admins`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to create company admin");
  }
  return response.json() as Promise<AuthMe>;
}
