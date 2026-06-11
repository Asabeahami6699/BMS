import type {
  AccountType,
  CustomerRegistrationInput,
  LoanApplication,
  LoanBorrowerRegistration,
  LoanGuarantor,
  LoanGroup,
  LoanGroupMember,
  LoanGroupMemberRole,
  LoanIncomeSource,
  LoanProduct,
  LoanPurpose,
  LoanRepayment,
  LoanScheduleInstallment,
  LoanType,
  NextOfKinDetails,
  Permission,
  Role,
  SusuNavVisibilityRow,
  TenantAddon,
  TenantProductModule,
  TreasuryBootstrap,
  CreateCashMovementInput
} from "@bms/shared";
import { isNetworkError, toUserFacingError, withNetworkRetry } from "../lib/networkError";
import { SESSION_UNAUTHORIZED_EVENT } from "../auth/sessionIdleConfig";

export type { AccountType, TenantProductModule };

export type AppRole =
  | "super_admin"
  | "admin"
  | "field_agent"
  | "coordinator"
  | "auditor"
  | "accountant"
  | "teller"
  | "back_officer"
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
  role: string;
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
  role: string;
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
  role: string;
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
  roleKind?: "job_title" | "extra_duties";
  productScope?: import("@bms/shared").CustomRoleProductScope;
  duties: string[];
};

export type TenantJobTitleView = {
  roleKey: string;
  displayName: string;
  productScope: import("@bms/shared").CustomRoleProductScope;
  effectiveDuties: Permission[];
  updatedAt?: string;
};

export type RoleAssignment = {
  userId: string;
  roleKey: string;
};
export type UserRecord = {
  userId: string;
  email: string;
  fullName?: string;
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
  tellerType?: 1 | 2 | 3 | 4;
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
  status:
    | "pending"
    | "cs_approved"
    | "bank_executed"
    | "completed"
    | "approved"
    | "rejected"
    | "expired";
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
  workflowData?: Record<string, unknown>;
  payoutReference?: string;
  transactionProofImage?: string;
  generatedReceiptImage?: string;
  visibleHours?: number;
  bankProductId?: string;
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
    | "workspace_activity"
    | "collection_batch_pending"
    | "collection_batch_posted"
    | "deposit_pending_bank"
    | "deposit_pending_accountant"
    | "deposit_completed"
    | "back_office_ecash_requested"
    | "back_office_ecash_approved"
    | "withdrawal_cs_approved"
    | "withdrawal_ready_for_teller";
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
const BRANCH_CONTEXT_STORAGE_KEY = "bms.branchContext";

/** Query value sent to the API when viewing all branches (head office only). */
export const ALL_BRANCHES_SCOPE = "all";

function loadStoredBranchContext(): string {
  try {
    const stored = localStorage.getItem(BRANCH_CONTEXT_STORAGE_KEY);
    if (stored) {
      return stored;
    }
  } catch {
    /* ignore */
  }
  return ALL_BRANCHES_SCOPE;
}

const runtimeContext = {
  tenantId: "tenant-demo",
  branchId: loadStoredBranchContext()
};

export const BRANCH_CONTEXT_CHANGED_EVENT = "bms:branch-context-changed";

export type AuthMe = {
  userId: string;
  tenantId: string;
  role: string;
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

/** Stable compare key so auth state updates skip when /auth/me payload is unchanged. */
export function authMeSignature(me: AuthMe | null | undefined): string {
  if (!me) {
    return "";
  }
  return JSON.stringify({
    userId: me.userId,
    tenantId: me.tenantId,
    role: me.role,
    scopeType: me.scopeType,
    branchId: me.branchId ?? "",
    permissions: me.permissions,
    subscribedModules: me.subscribedModules ?? [],
    subscribedAddons: me.subscribedAddons ?? [],
    reportsAnalytics: me.reportsAnalytics ?? true,
    fullName: me.fullName ?? "",
    email: me.email ?? "",
    tenantName: me.tenantName ?? "",
    susuNavVisibility: me.susuNavVisibility ?? null
  });
}

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
  if (session.user.scopeType === "branch" && session.user.branchId) {
    runtimeContext.branchId = session.user.branchId;
    try {
      localStorage.setItem(BRANCH_CONTEXT_STORAGE_KEY, session.user.branchId);
    } catch {
      /* ignore */
    }
  }
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

function notifySessionUnauthorized(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(SESSION_UNAUTHORIZED_EVENT));
  }
}

function handleUnauthorizedResponse(): void {
  if (authSession?.accessToken) {
    clearAuthSession();
    notifySessionUnauthorized();
  }
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
  return withNetworkRetry(async () => {
    try {
      const response = await fetch(withBranchScope(url), init);
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          details?: {
            fieldErrors?: Record<string, string[]>;
            formErrors?: string[];
          };
        };
        if (response.status === 401) {
          handleUnauthorizedResponse();
        }
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
  });
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

export async function refreshAuthSession(): Promise<boolean> {
  if (!authSession?.accessToken) {
    return false;
  }
  try {
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/refresh`, {
      method: "POST",
      headers: authHeaders()
    });
    if (response.status === 401) {
      handleUnauthorizedResponse();
      return false;
    }
    return response.ok;
  } catch {
    return Boolean(authSession?.accessToken);
  }
}

export function getTenantId(): string {
  return runtimeContext.tenantId;
}

export function getRuntimeBranchId(): string {
  return runtimeContext.branchId;
}

/** Active branch filter for API calls (undefined = all branches). */
export function getActiveBranchFilter(): string | undefined {
  const value = getRuntimeBranchId();
  if (!value || value === ALL_BRANCHES_SCOPE) {
    return undefined;
  }
  return value;
}

export function isAllBranchesScope(branchId?: string | null): boolean {
  return !branchId || branchId === ALL_BRANCHES_SCOPE;
}

function withBranchScope(url: string): string {
  if (!url.startsWith(API_BASE_URL)) {
    return url;
  }
  const path = url.slice(API_BASE_URL.length);
  if (
    path.startsWith("/api/v1/auth") ||
    path.startsWith("/api/v1/platform") ||
    path.startsWith("/api/v1/branches") ||
    path.startsWith("/health")
  ) {
    return url;
  }

  const parsed = new URL(url);
  if (parsed.searchParams.has("branchId")) {
    return url;
  }

  const scope = getRuntimeBranchId();
  if (scope) {
    parsed.searchParams.set("branchId", scope === ALL_BRANCHES_SCOPE ? ALL_BRANCHES_SCOPE : scope);
  }
  return parsed.toString();
}

export function setRuntimeBranchId(branchId: string): void {
  runtimeContext.branchId = branchId;
  try {
    localStorage.setItem(BRANCH_CONTEXT_STORAGE_KEY, branchId);
  } catch {
    /* ignore */
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(BRANCH_CONTEXT_CHANGED_EVENT, { detail: branchId }));
  }
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
    handleUnauthorizedResponse();
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

export async function getTenantJobTitles(): Promise<TenantJobTitleView[]> {
  return fetchJson<TenantJobTitleView[]>(`${API_BASE_URL}/api/v1/admin/roles/job-titles`, {
    headers: authHeaders()
  });
}

export async function createTenantJobTitle(payload: {
  roleKey: string;
  displayName: string;
  productScope?: import("@bms/shared").CustomRoleProductScope;
  duties: Permission[];
}): Promise<TenantJobTitleView> {
  return fetchJson<TenantJobTitleView>(`${API_BASE_URL}/api/v1/admin/roles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payload, roleKind: "job_title" })
  });
}

export async function updateTenantJobTitle(
  roleKey: string,
  payload: {
    displayName?: string;
    productScope?: import("@bms/shared").CustomRoleProductScope;
    duties?: Permission[];
  }
): Promise<TenantJobTitleView> {
  return fetchJson<TenantJobTitleView>(`${API_BASE_URL}/api/v1/admin/roles/job-title/${encodeURIComponent(roleKey)}`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function deleteTenantJobTitle(roleKey: string): Promise<void> {
  const response = await fetch(
    `${API_BASE_URL}/api/v1/admin/roles/job-title/${encodeURIComponent(roleKey)}`,
    {
      method: "DELETE",
      headers: authHeaders()
    }
  );
  if (!response.ok) {
    throw new Error("Failed to delete job title.");
  }
}

export async function createRole(payload: RoleDefinition): Promise<RoleDefinition> {
  return fetchJson<RoleDefinition>(`${API_BASE_URL}/api/v1/admin/roles`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ ...payload, roleKind: payload.roleKind ?? "extra_duties" })
  });
}

export async function assignRole(payload: RoleAssignment): Promise<RoleAssignment> {
  return fetchJson<RoleAssignment>(`${API_BASE_URL}/api/v1/admin/roles/assign`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function unassignRole(payload: RoleAssignment): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/v1/admin/roles/assign`, {
    method: "DELETE",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Failed to remove custom role assignment.");
  }
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
  role: string;
  scopeType: "head_office" | "branch";
  branchId?: string;
  tellerType?: 1 | 2 | 3 | 4 | null;
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
    role?: string;
    scopeType?: "head_office" | "branch";
    branchId?: string | null;
    tellerType?: 1 | 2 | 3 | 4 | null;
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
  floatBalance: number;
  openingFloat: number;
  totalDeposits: number;
  totalWithdrawals: number;
  totalDailySusu: number;
  remainingOpeningFloat: number;
  lowFloatThreshold: number;
  isLowFloat: boolean;
  canTransact: boolean;
  statusLabel: string;
} | null;

export type BranchCounterBootstrapResponse = {
  customers: Customer[];
  branches: Branch[];
  bankProducts: import("@bms/shared").TenantBankProduct[];
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
  bankProductId?: string;
  workflowData?: Record<string, unknown>;
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

export type LoansBootstrap = {
  products: LoanProduct[];
  applications: LoanApplication[];
  groups: LoanGroup[];
  summary: {
    pendingApproval: number;
    approved: number;
    disbursed: number;
    closed: number;
    totalOutstanding: number;
    totalRepaid: number;
    overdueInstallments: number;
  };
};

export type LoanDetail = {
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
    nextOfKin?: NextOfKinDetails;
  };
};

export async function getLoansBootstrap(): Promise<LoansBootstrap> {
  return fetchJson<LoansBootstrap>(`${API_BASE_URL}/api/v1/loans/bootstrap`, {
    headers: authHeaders()
  });
}

export async function listLoanProducts(): Promise<LoanProduct[]> {
  const payload = await fetchJson<{ products: LoanProduct[] }>(`${API_BASE_URL}/api/v1/loans/products`, {
    headers: authHeaders()
  });
  return payload.products;
}

export async function createLoanProduct(payload: {
  name: string;
  description?: string;
  interestRatePercent: number;
  termMonths: number;
  repaymentFrequency?: "weekly" | "monthly";
  minAmount: number;
  maxAmount: number;
  loanType?: LoanType;
  minGroupMembers?: number;
  maxGroupMembers?: number;
  status?: "active" | "inactive";
}): Promise<LoanProduct> {
  const body = await fetchJson<{ product: LoanProduct }>(`${API_BASE_URL}/api/v1/loans/products`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  return body.product;
}

export async function updateLoanProduct(
  productId: string,
  payload: Partial<{
    name: string;
    description: string;
    interestRatePercent: number;
    termMonths: number;
    repaymentFrequency?: "weekly" | "monthly";
    minAmount: number;
    maxAmount: number;
    loanType?: LoanType;
    minGroupMembers?: number;
    maxGroupMembers?: number;
    status: "active" | "inactive";
  }>
): Promise<LoanProduct> {
  const body = await fetchJson<{ product: LoanProduct }>(
    `${API_BASE_URL}/api/v1/loans/products/${productId}`,
    {
      method: "PATCH",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }
  );
  return body.product;
}

export async function listLoanApplications(): Promise<LoanApplication[]> {
  const payload = await fetchJson<{ applications: LoanApplication[] }>(
    `${API_BASE_URL}/api/v1/loans/applications`,
    { headers: authHeaders() }
  );
  return payload.applications;
}

export async function getLoanDetail(loanId: string): Promise<LoanDetail> {
  return fetchJson<LoanDetail>(`${API_BASE_URL}/api/v1/loans/applications/${loanId}`, {
    headers: authHeaders()
  });
}

export async function createLoanApplication(payload: {
  customerId?: string;
  newCustomer?: LoanBorrowerRegistration;
  productId: string;
  branchId: string;
  principalAmount: number;
  applicationNotes?: string;
  loanPurpose: LoanPurpose;
  loanPurposeOther?: string;
  sourceOfIncome: LoanIncomeSource;
  sourceOfIncomeOther?: string;
  occupation: string;
  employerOrBusiness?: string;
  monthlyIncome: number;
  monthlyExpenses?: number;
  existingLoanBalance?: number;
  yearsAtCurrentJob?: number;
  guarantor: LoanGuarantor;
  photoUrl?: string;
  idCardPhotoUrl?: string;
  groupId?: string;
}): Promise<LoanApplication> {
  const body = await fetchJson<{ application: LoanApplication }>(
    `${API_BASE_URL}/api/v1/loans/applications`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }
  );
  return body.application;
}

export async function approveLoanApplication(loanId: string): Promise<LoanApplication> {
  const body = await fetchJson<{ application: LoanApplication }>(
    `${API_BASE_URL}/api/v1/loans/applications/${loanId}/approve`,
    { method: "POST", headers: authHeaders() }
  );
  return body.application;
}

export async function rejectLoanApplication(
  loanId: string,
  rejectionReason: string
): Promise<LoanApplication> {
  const body = await fetchJson<{ application: LoanApplication }>(
    `${API_BASE_URL}/api/v1/loans/applications/${loanId}/reject`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({ rejectionReason })
    }
  );
  return body.application;
}

export async function disburseLoan(loanId: string): Promise<LoanApplication> {
  const body = await fetchJson<{ application: LoanApplication }>(
    `${API_BASE_URL}/api/v1/loans/applications/${loanId}/disburse`,
    { method: "POST", headers: authHeaders() }
  );
  return body.application;
}

export async function recordLoanRepayment(
  loanId: string,
  payload: { amount: number; branchId: string; notes?: string; settleAll?: boolean }
): Promise<{ application: LoanApplication; repayment: LoanRepayment; schedule: LoanScheduleInstallment[] }> {
  return fetchJson<{ application: LoanApplication; repayment: LoanRepayment; schedule: LoanScheduleInstallment[] }>(
    `${API_BASE_URL}/api/v1/loans/applications/${loanId}/repayments`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }
  );
}

export async function listLoanGroups(): Promise<LoanGroup[]> {
  const payload = await fetchJson<{ groups: LoanGroup[] }>(`${API_BASE_URL}/api/v1/loans/groups`, {
    headers: authHeaders()
  });
  return payload.groups;
}

export async function getLoanGroup(groupId: string): Promise<LoanGroup> {
  const payload = await fetchJson<{ group: LoanGroup }>(`${API_BASE_URL}/api/v1/loans/groups/${groupId}`, {
    headers: authHeaders()
  });
  return payload.group;
}

export async function createLoanGroup(payload: {
  name: string;
  branchId: string;
  description?: string;
  meetingDay?: string;
  minMembers?: number;
  maxMembers?: number;
  assignedFieldAgentId?: string;
}): Promise<LoanGroup> {
  const body = await fetchJson<{ group: LoanGroup }>(`${API_BASE_URL}/api/v1/loans/groups`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  return body.group;
}

export async function updateLoanGroup(
  groupId: string,
  payload: Partial<{
    name: string;
    branchId: string;
    description: string;
    meetingDay: string;
    minMembers: number;
    maxMembers: number;
    assignedFieldAgentId: string;
    status: "active" | "inactive";
  }>
): Promise<LoanGroup> {
  const body = await fetchJson<{ group: LoanGroup }>(`${API_BASE_URL}/api/v1/loans/groups/${groupId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
  return body.group;
}

export async function addLoanGroupMember(
  groupId: string,
  payload: { customerId: string; role?: LoanGroupMemberRole }
): Promise<LoanGroupMember> {
  const body = await fetchJson<{ member: LoanGroupMember }>(
    `${API_BASE_URL}/api/v1/loans/groups/${groupId}/members`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }
  );
  return body.member;
}

export async function removeLoanGroupMember(groupId: string, memberId: string): Promise<void> {
  await fetch(`${API_BASE_URL}/api/v1/loans/groups/${groupId}/members/${memberId}`, {
    method: "DELETE",
    headers: authHeaders()
  });
}

export type TreasuryAllBranchesBootstrap = {
  scope: "all_branches";
  branches: Array<{
    branchId: string;
    branchName: string;
    bootstrap: TreasuryBootstrap;
  }>;
};

export type TreasuryBootstrapResponse = TreasuryBootstrap | TreasuryAllBranchesBootstrap;

export function isTreasuryAllBranchesBootstrap(
  value: TreasuryBootstrapResponse
): value is TreasuryAllBranchesBootstrap {
  return (
    typeof value === "object" &&
    value !== null &&
    "scope" in value &&
    (value as TreasuryAllBranchesBootstrap).scope === "all_branches"
  );
}

export async function getTreasuryBootstrap(branchId?: string): Promise<TreasuryBootstrapResponse> {
  const params = new URLSearchParams();
  if (branchId?.trim()) {
    params.set("branchId", branchId);
  }
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return fetchJson<TreasuryBootstrapResponse>(`${API_BASE_URL}/api/v1/treasury/bootstrap${suffix}`, {
    headers: authHeaders()
  });
}

export async function postCashMovement(payload: CreateCashMovementInput): Promise<TreasuryBootstrap> {
  return fetchJson<TreasuryBootstrap>(`${API_BASE_URL}/api/v1/treasury/movements`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function getAgencyBootstrap(branchId?: string): Promise<import("@bms/shared").AgencyBootstrap> {
  const params = branchId ? `?branchId=${encodeURIComponent(branchId)}` : "";
  return fetchJson(`${API_BASE_URL}/api/v1/agency/bootstrap${params}`, { headers: authHeaders() });
}

export async function getTellerAgencyDeposits(options?: {
  branchId?: string;
  date?: string;
}): Promise<import("@bms/shared").TellerAgencyDeposits> {
  const params = new URLSearchParams();
  if (options?.branchId) params.set("branchId", options.branchId);
  if (options?.date) params.set("date", options.date);
  const qs = params.toString();
  return fetchJson(`${API_BASE_URL}/api/v1/agency/teller/deposits${qs ? `?${qs}` : ""}`, {
    headers: authHeaders()
  });
}

export async function getAccountantDashboard(options?: {
  branchId?: string;
}): Promise<import("@bms/shared").AccountantDashboard> {
  const params = new URLSearchParams();
  if (options?.branchId) params.set("branchId", options.branchId);
  const qs = params.toString();
  return fetchJson(`${API_BASE_URL}/api/v1/agency/accountant/dashboard${qs ? `?${qs}` : ""}`, {
    headers: authHeaders()
  });
}

export async function getAccountantTrialBalance(options?: {
  branchId?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<
  import("@bms/shared").TreasuryBootstrap | { branches: Array<{ branchId: string; branchName: string; branchCode?: string; bootstrap: import("@bms/shared").TreasuryBootstrap }> }
> {
  const params = new URLSearchParams();
  if (options?.branchId) params.set("branchId", options.branchId);
  if (options?.dateFrom) params.set("dateFrom", options.dateFrom);
  if (options?.dateTo) params.set("dateTo", options.dateTo);
  const qs = params.toString();
  return fetchJson(`${API_BASE_URL}/api/v1/agency/accountant/trial-balance${qs ? `?${qs}` : ""}`, {
    headers: authHeaders()
  });
}

export async function getAuditorDashboard(options?: {
  branchId?: string;
}): Promise<import("@bms/shared").AuditorDashboard> {
  const params = new URLSearchParams();
  if (options?.branchId) params.set("branchId", options.branchId);
  const qs = params.toString();
  return fetchJson(`${API_BASE_URL}/api/v1/agency/auditor/dashboard${qs ? `?${qs}` : ""}`, {
    headers: authHeaders()
  });
}

export async function listHrLeaveRequests(): Promise<import("@bms/shared").HrLeaveRequest[]> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/leave`, { headers: authHeaders() });
}

export async function createHrLeaveRequest(payload: {
  userId: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  notes?: string;
}): Promise<import("@bms/shared").HrLeaveRequest> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/leave`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function updateHrLeaveStatus(
  requestId: string,
  status: "approved" | "rejected",
  options?: { rejectedReason?: string }
): Promise<import("@bms/shared").HrLeaveRequest> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/leave/${requestId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ status, rejectedReason: options?.rejectedReason })
  });
}

export async function listHrAttendance(options?: {
  businessDate?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<import("@bms/shared").HrAttendanceRecord[]> {
  const params = new URLSearchParams();
  if (options?.businessDate) params.set("date", options.businessDate);
  if (options?.dateFrom) params.set("dateFrom", options.dateFrom);
  if (options?.dateTo) params.set("dateTo", options.dateTo);
  const qs = params.toString();
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/attendance${qs ? `?${qs}` : ""}`, {
    headers: authHeaders()
  });
}

export async function upsertHrAttendance(payload: {
  userId: string;
  branchId?: string;
  businessDate: string;
  status: "present" | "absent" | "late" | "leave";
  checkIn?: string;
  checkOut?: string;
  checkInPhotoUrl?: string;
  checkOutPhotoUrl?: string;
  notes?: string;
}): Promise<import("@bms/shared").HrAttendanceRecord> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/attendance`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function listHrTraining(): Promise<import("@bms/shared").HrTrainingRecord[]> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/training`, { headers: authHeaders() });
}

export async function createHrTraining(payload: {
  userId: string;
  trainingTitle: string;
  completedOn?: string;
  expiresOn?: string;
  status?: "due" | "completed" | "expired";
  notes?: string;
}): Promise<import("@bms/shared").HrTrainingRecord> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/training`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function listHrStaffLoans(): Promise<import("@bms/shared").HrStaffLoan[]> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/staff-loans`, { headers: authHeaders() });
}

export async function updateHrStaffLoanStatus(
  loanId: string,
  status: "approved" | "declined",
  options?: { monthlyDeduction?: number }
): Promise<import("@bms/shared").HrStaffLoan> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/staff-loans/${loanId}`, {
    method: "PATCH",
    headers: authHeaders(),
    body: JSON.stringify({ status, monthlyDeduction: options?.monthlyDeduction })
  });
}

export async function getHrPolicies(): Promise<import("@bms/shared").HrPolicies> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/policies`, { headers: authHeaders() });
}

export async function updateHrPolicies(
  payload: import("@bms/shared").HrPolicies
): Promise<import("@bms/shared").HrPolicies> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/hr/policies`, {
    method: "PUT",
    headers: authHeaders(),
    body: JSON.stringify({
      lateCheckInTime: payload.lateCheckInTime,
      defaultAnnualLeaveDays: payload.defaultAnnualLeaveDays,
      roleLeaveEntitlements: payload.roleLeaveEntitlements.map((row) => ({
        roleKey: row.roleKey,
        annualLeaveDays: row.annualLeaveDays
      }))
    })
  });
}

export async function getOpsSummary(): Promise<import("@bms/shared").UniversalOpsSummary> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/summary`, { headers: authHeaders() });
}

export async function getMyAttendanceToday(): Promise<import("@bms/shared").HrAttendanceRecord | null> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/attendance/today`, { headers: authHeaders() });
}

export async function listMyAttendanceHistory(): Promise<import("@bms/shared").HrAttendanceRecord[]> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/attendance/history`, { headers: authHeaders() });
}

export async function checkInAttendance(payload?: {
  photoUrl?: string;
  branchId?: string;
}): Promise<import("@bms/shared").HrAttendanceRecord> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/attendance/check-in`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload ?? {})
  });
}

export async function checkOutAttendance(payload?: {
  photoUrl?: string;
}): Promise<import("@bms/shared").HrAttendanceRecord> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/attendance/check-out`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload ?? {})
  });
}

export async function listMyLeaveRequests(): Promise<import("@bms/shared").HrLeaveRequest[]> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/leave`, { headers: authHeaders() });
}

export async function getMyLeaveSummary(): Promise<import("@bms/shared").HrLeaveSummary> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/leave/summary`, { headers: authHeaders() });
}

export async function submitMyLeaveRequest(payload: {
  leaveType: string;
  startDate: string;
  endDate: string;
  notes?: string;
}): Promise<import("@bms/shared").HrLeaveRequest> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/leave`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function listMyStaffLoans(): Promise<import("@bms/shared").HrStaffLoan[]> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/staff-loans`, { headers: authHeaders() });
}

export async function applyStaffLoan(payload: {
  amount: number;
  purpose: string;
  termMonths: number;
  notes?: string;
}): Promise<import("@bms/shared").HrStaffLoan> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/staff-loans`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function listOpsAnnouncements(): Promise<import("@bms/shared").CompanyAnnouncement[]> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/announcements`, { headers: authHeaders() });
}

export async function acknowledgeOpsAnnouncement(announcementId: string): Promise<void> {
  await fetchJson(`${API_BASE_URL}/api/v1/operations/announcements/${announcementId}/ack`, {
    method: "POST",
    headers: authHeaders()
  });
}

export async function createOpsAnnouncement(payload: {
  title: string;
  body: string;
  category: string;
  pinned?: boolean;
}): Promise<import("@bms/shared").CompanyAnnouncement> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/announcements`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function listOpsDocuments(): Promise<import("@bms/shared").CompanyDocument[]> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/documents`, { headers: authHeaders() });
}

export async function uploadOpsDocument(payload: {
  title: string;
  category: string;
  fileUrl?: string;
  version?: string;
}): Promise<import("@bms/shared").CompanyDocument> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/documents`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function listMyIncidents(): Promise<import("@bms/shared").IncidentReport[]> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/incidents`, { headers: authHeaders() });
}

export async function reportIncident(payload: {
  incidentType: string;
  description: string;
}): Promise<import("@bms/shared").IncidentReport> {
  return fetchJson(`${API_BASE_URL}/api/v1/operations/incidents`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(payload)
  });
}

export async function getBackOfficeBootstrap(options?: {
  branchId?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<import("@bms/shared").BackOfficeBootstrap> {
  const params = new URLSearchParams();
  if (options?.branchId) params.set("branchId", options.branchId);
  if (options?.date) params.set("date", options.date);
  if (options?.dateFrom) params.set("dateFrom", options.dateFrom);
  if (options?.dateTo) params.set("dateTo", options.dateTo);
  const qs = params.toString();
  return fetchJson(`${API_BASE_URL}/api/v1/agency/back-office/bootstrap${qs ? `?${qs}` : ""}`, {
    headers: authHeaders()
  });
}

export async function openBackOfficeDay(
  payload: import("@bms/shared").OpenBackOfficeDayInput
): Promise<import("@bms/shared").BackOfficeBootstrap> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/back-office/open-day`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function executeBackOfficeDepositDone(
  transactionId: string,
  executionBankProductId: string
): Promise<import("@bms/shared").BackOfficeBootstrap> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/back-office/deposits/${transactionId}/done`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ executionBankProductId })
  });
}

export async function approveBackOfficeAccountantDeposit(
  transactionId: string
): Promise<import("@bms/shared").BackOfficeBootstrap> {
  return fetchJson(
    `${API_BASE_URL}/api/v1/agency/back-office/deposits/${transactionId}/accountant-approve`,
    { method: "POST", headers: authHeaders() }
  );
}

export async function createBackOfficeAgentTransfer(payload: {
  branchId: string;
  businessDate: string;
  fromBankProductId: string;
  toBankProductId: string;
  amount: number;
  notes?: string;
}): Promise<import("@bms/shared").BackOfficeBootstrap> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/back-office/agent-transfers`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function createBackOfficeEcashRequest(payload: {
  branchId: string;
  bankProductId?: string;
  amount: number;
  notes?: string;
}): Promise<import("@bms/shared").BackOfficeBootstrap> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/back-office/ecash-requests`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function approveBackOfficeEcashRequest(
  requestId: string,
  approve = true
): Promise<import("@bms/shared").BackOfficeBootstrap> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/back-office/ecash-requests/${requestId}/approve`, {
    method: "POST",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify({ approve })
  });
}

export async function updateBackOfficeAccountEntries(payload: {
  bankProductId: string;
  manualTotalEntries: number;
}): Promise<import("@bms/shared").BackOfficeBootstrap> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/back-office/account-entries`, {
    method: "PATCH",
    headers: { ...authHeaders(), "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
}

export async function executeAgencyBankDeposit(transactionId: string): Promise<Transaction> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/deposits/${transactionId}/execute-bank`, {
    method: "POST",
    headers: authHeaders()
  });
}

export async function executeAgencyBankWithdrawal(
  disclosureId: string,
  bankProductId?: string
): Promise<BalanceDisclosure> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/withdrawals/${disclosureId}/execute-bank`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(bankProductId ? { bankProductId } : {})
  });
}

export async function tellerPayAgencyWithdrawal(disclosureId: string): Promise<BalanceDisclosure> {
  return fetchJson(`${API_BASE_URL}/api/v1/agency/withdrawals/${disclosureId}/pay-cash`, {
    method: "POST",
    headers: authHeaders()
  });
}

export async function initiateAgencyWithdrawal(
  payload: import("@bms/shared").InitiateAgencyWithdrawalInput
): Promise<BalanceDisclosure> {
  const body = await fetchJson<{ disclosure: BalanceDisclosure }>(
    `${API_BASE_URL}/api/v1/agency/withdrawals/initiate`,
    {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify(payload)
    }
  );
  return body.disclosure;
}

export async function getAgencyWalkInCustomer(branchId: string): Promise<Customer> {
  const params = new URLSearchParams({ branchId });
  const body = await fetchJson<{ customer: Customer }>(
    `${API_BASE_URL}/api/v1/agency/walk-in-customer?${params}`,
    { headers: authHeaders() }
  );
  return body.customer;
}

export async function getTellerReconciliationBootstrap(options?: {
  branchId?: string;
  date?: string;
  tellerUserId?: string;
  transactionType?: string;
  bankProductId?: string;
}): Promise<import("@bms/shared").TellerReconciliationBootstrap> {
  const params = new URLSearchParams();
  if (options?.branchId) params.set("branchId", options.branchId);
  if (options?.date) params.set("date", options.date);
  if (options?.tellerUserId) params.set("tellerUserId", options.tellerUserId);
  if (options?.transactionType) params.set("transactionType", options.transactionType);
  if (options?.bankProductId) params.set("bankProductId", options.bankProductId);
  const query = params.toString();
  return fetchJson<import("@bms/shared").TellerReconciliationBootstrap>(
    `${API_BASE_URL}/api/v1/agency/teller-reconciliation${query ? `?${query}` : ""}`,
    { headers: authHeaders() }
  );
}

export async function listTellerTillJournalEntries(options: {
  branchId: string;
  date?: string;
  tellerUserId?: string;
}): Promise<import("@bms/shared").TellerTillJournalEntry[]> {
  const params = new URLSearchParams({ branchId: options.branchId });
  if (options.date) params.set("date", options.date);
  if (options.tellerUserId) params.set("tellerUserId", options.tellerUserId);
  const body = await fetchJson<{ entries: import("@bms/shared").TellerTillJournalEntry[] }>(
    `${API_BASE_URL}/api/v1/agency/till-journal?${params}`,
    { headers: authHeaders() }
  );
  return body.entries;
}

export async function createTellerTillJournalEntry(payload: {
  branchId: string;
  businessDate: string;
  entryType: import("@bms/shared").TellerTillEntryType;
  amount: number;
  notes?: string;
}): Promise<import("@bms/shared").TellerTillJournalEntry> {
  const body = await fetchJson<{ entry: import("@bms/shared").TellerTillJournalEntry }>(
    `${API_BASE_URL}/api/v1/agency/till-journal`,
    { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) }
  );
  return body.entry;
}

export async function lookupPartnerBankAccount(
  accountNumber: string
): Promise<import("@bms/shared").PartnerBankAccount | null> {
  const query = encodeURIComponent(accountNumber.trim());
  const body = await fetchJson<{ account: import("@bms/shared").PartnerBankAccount | null }>(
    `${API_BASE_URL}/api/v1/agency/partner-accounts/lookup?accountNumber=${query}`,
    { headers: authHeaders() }
  );
  return body.account;
}

export async function listPartnerBankAccounts(options?: {
  customerId?: string;
}): Promise<import("@bms/shared").PartnerBankAccount[]> {
  const params = new URLSearchParams();
  if (options?.customerId) {
    params.set("customerId", options.customerId);
  }
  const query = params.toString();
  const body = await fetchJson<{ accounts: import("@bms/shared").PartnerBankAccount[] }>(
    `${API_BASE_URL}/api/v1/agency/partner-accounts${query ? `?${query}` : ""}`,
    { headers: authHeaders() }
  );
  return body.accounts;
}

export async function createPartnerBankAccount(payload: {
  customerId: string;
  bankProductId: string;
  accountNumber: string;
  accountName: string;
  branchId?: string;
  externalReference?: string;
  workflowData?: Record<string, unknown>;
}): Promise<import("@bms/shared").PartnerBankAccount> {
  const body = await fetchJson<{ account: import("@bms/shared").PartnerBankAccount }>(
    `${API_BASE_URL}/api/v1/agency/partner-accounts`,
    { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) }
  );
  return body.account;
}

export async function listBankProducts(options?: {
  direction?: "deposit" | "withdrawal" | "account_opening";
  activeOnly?: boolean;
  branchId?: string;
}): Promise<import("@bms/shared").TenantBankProduct[]> {
  const params = new URLSearchParams();
  if (options?.direction) {
    params.set("direction", options.direction);
  }
  if (options?.activeOnly) {
    params.set("activeOnly", "true");
  }
  if (options?.branchId) {
    params.set("branchId", options.branchId);
  }
  const query = params.toString();
  const payload = await fetchJson<{ products: import("@bms/shared").TenantBankProduct[] }>(
    `${API_BASE_URL}/api/v1/banking/products${query ? `?${query}` : ""}`,
    { headers: authHeaders() }
  );
  return payload.products;
}

export async function createBankProduct(payload: {
  name: string;
  code?: string;
  direction: import("@bms/shared").BankProductCreateDirection;
  bankLabel: string;
  branchId?: string | null;
  isActive?: boolean;
  sortOrder?: number;
  workflowFields?: import("@bms/shared").BankProductWorkflowField[];
  isCompanyBankAccount?: boolean;
  executionLimitAmount?: number | null;
}): Promise<import("@bms/shared").TenantBankProduct[]> {
  const body = await fetchJson<{ products: import("@bms/shared").TenantBankProduct[] }>(
    `${API_BASE_URL}/api/v1/banking/products`,
    { method: "POST", headers: authHeaders(), body: JSON.stringify(payload) }
  );
  return body.products;
}

export async function updateBankProduct(
  productId: string,
  payload: Partial<{
    name: string;
    code: string;
    direction: "deposit" | "withdrawal" | "account_opening";
    bankLabel: string;
    branchId: string | null;
    isActive: boolean;
    sortOrder: number;
    workflowFields: import("@bms/shared").BankProductWorkflowField[];
    isCompanyBankAccount: boolean;
    executionLimitAmount: number | null;
  }>
): Promise<import("@bms/shared").TenantBankProduct> {
  const body = await fetchJson<{ product: import("@bms/shared").TenantBankProduct }>(
    `${API_BASE_URL}/api/v1/banking/products/${productId}`,
    { method: "PATCH", headers: authHeaders(), body: JSON.stringify(payload) }
  );
  return body.product;
}
