import {
  assignCustomerFieldAgentSchema,
  createCustomerInputSchema,
  customerRegistrationInputSchema,
  customerSchema,
  CUSTOMER_DORMANT_AFTER_MONTHS,
  CUSTOMER_INACTIVE_AFTER_MONTHS,
  registrationFormIssue,
  registrationPayloadForSetup,
  loanBorrowerRegistrationSchema,
  rejectCustomerSchema,
  scheduleNextCardDailySusuSchema,
  updateCustomerStatusSchema,
  upgradeCustomerKycSchema,
  type AdminManagedCustomerStatus,
  type Customer,
  type CustomerRegistrationInput,
  type KycIntroducerDetails,
  type NextOfKinDetails
} from "@bms/shared";
import { listTenantFieldAgents } from "./authService.js";

import { randomUUID } from "node:crypto";

import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";

import { listBranches } from "./branchService.js";

import { createAgentNotification, notifyTenantStaff } from "./notificationService.js";
import { fetchUserNameMap } from "./userNameResolver.js";
import { computeCustomerBalance } from "./ledgerService.js";
import { generateCustomerAccountNumber } from "./accountNumberPolicyService.js";
import { applySavingsInitialDepositOnApproval } from "./savingsInitialDepositService.js";
import { getRegistrationFormSetup } from "./registrationFormService.js";
import { listFieldRoutes } from "./routeService.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidUuid(id: string): boolean {
  return UUID_RE.test(id);
}

async function resolveHomeBranchId(
  tenantId: string,
  agentBranchId: string | undefined,
  payloadBranchId?: string
): Promise<string> {
  const candidates = [payloadBranchId, agentBranchId].filter(
    (id): id is string => typeof id === "string" && id.length > 0
  );

  for (const id of candidates) {
    if (isValidUuid(id)) {
      return id;
    }
  }

  const branches = await listBranches(tenantId);
  const active = branches.filter((b) => b.status === "active");
  const pool = active.length > 0 ? active : branches;

  for (const id of candidates) {
    const match = pool.find((b) => b.id === id);
    if (match) {
      return match.id;
    }
  }

  if (pool.length > 0) {
    return pool[0].id;
  }

  throw new Error("No branch found for this company. Ask an admin to create a branch first.");
}



const customerStore = new Map<string, Customer[]>();
/** In-memory fallback for scheduled next-card daily Susu rate if migration 097 is not yet applied. */
const pendingDailyContributionFallback = new Map<
  string,
  { amount: number; setAt: string }
>();

function pendingDailyKey(tenantId: string, customerId: string): string {
  return `${tenantId}:${customerId}`;
}

function isMissingPendingDailyColumn(message: string): boolean {
  return /pending_daily_contribution/i.test(message);
}

function isMissingIdCardTypeColumn(message: string): boolean {
  return /id_card_type|kyc_tier|nationality|kyc_introducer_|kyc_upgraded_at/i.test(message);
}

/** In-memory fallback for customer ID card type & Simplified KYC fields if migration 102 is not yet applied. */
const kycMetadataFallback = new Map<
  string,
  {
    idCardType?: Customer["idCardType"];
    kycTier?: Customer["kycTier"];
    nationality?: string;
    kycIntroducer?: KycIntroducerDetails;
    kycUpgradedAt?: string;
  }
>();

function mapKycIntroducerFromRow(row: Record<string, unknown>): KycIntroducerDetails | undefined {
  if (
    row.kyc_introducer_name &&
    row.kyc_introducer_phone &&
    row.kyc_introducer_relationship &&
    row.kyc_introducer_ghana_card
  ) {
    return {
      fullName: String(row.kyc_introducer_name),
      phone: String(row.kyc_introducer_phone),
      relationship: String(row.kyc_introducer_relationship),
      ghanaCardNumber: String(row.kyc_introducer_ghana_card)
    };
  }
  return undefined;
}

const SIMPLIFIED_KYC_COLUMNS = [
  "id_card_type",
  "kyc_tier",
  "nationality",
  "kyc_introducer_name",
  "kyc_introducer_phone",
  "kyc_introducer_relationship",
  "kyc_introducer_ghana_card",
  "kyc_upgraded_at"
] as const;

function stripKycColumns(row: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...row };
  for (const col of SIMPLIFIED_KYC_COLUMNS) {
    delete copy[col];
  }
  return copy;
}



function getTenantCustomers(tenantId: string): Customer[] {

  return customerStore.get(tenantId) ?? [];

}



function setTenantCustomers(tenantId: string, customers: Customer[]): void {

  customerStore.set(tenantId, customers);

}



function mapNextOfKinFromRow(row: Record<string, unknown>): NextOfKinDetails | undefined {
  if (row.next_of_kin_name) {
    return {
      fullName: String(row.next_of_kin_name),
      phone: String(row.next_of_kin_phone ?? ""),
      location: String(row.next_of_kin_location ?? ""),
      houseNumber: row.next_of_kin_house_number ? String(row.next_of_kin_house_number) : undefined
    };
  }
  if (row.next_of_kin && typeof row.next_of_kin === "string") {
    return {
      fullName: row.next_of_kin,
      phone: "",
      location: ""
    };
  }
  return undefined;
}

function kinSummary(kin: NextOfKinDetails | undefined): string | null {
  if (!kin) {
    return null;
  }
  const parts = [kin.fullName, kin.phone, kin.location, kin.houseNumber].filter(Boolean);
  return parts.join(" · ");
}

async function enrichCustomersWithAgentNames(tenantId: string, customers: Customer[]): Promise<Customer[]> {
  const ids = customers.flatMap((c) =>
    [c.createdByFieldAgentId, c.assignedFieldAgentId].filter((id): id is string => Boolean(id))
  );
  const nameMap = await fetchUserNameMap(tenantId, ids);
  return customers.map((customer) => ({
    ...customer,
    createdByFieldAgentName: nameMap.get(customer.createdByFieldAgentId),
    assignedFieldAgentName: customer.assignedFieldAgentId
      ? nameMap.get(customer.assignedFieldAgentId)
      : undefined
  }));
}

async function enrichCustomerWithAgentNames(tenantId: string, customer: Customer): Promise<Customer> {
  const [enriched] = await enrichCustomersWithAgentNames(tenantId, [customer]);
  return enriched;
}

function mapCustomerRow(row: Record<string, unknown>): Customer {
  const fb = kycMetadataFallback.get(pendingDailyKey(String(row.tenant_id), String(row.id)));
  const resolvedIdCardType =
    row.id_card_type != null ? String(row.id_card_type) : fb?.idCardType;
  const resolvedKycTier =
    row.kyc_tier != null
      ? String(row.kyc_tier)
      : (fb?.kycTier ?? (resolvedIdCardType === "no_id_simplified_kyc" ? "simplified" : "full"));

  return customerSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    fullName: String(row.full_name),
    email: row.email ? String(row.email) : undefined,
    phone: String(row.phone),
    location: row.location ? String(row.location) : undefined,
    houseNumber: row.house_number ? String(row.house_number) : undefined,
    dateOfBirth: row.date_of_birth ? String(row.date_of_birth).slice(0, 10) : undefined,
    occupation: row.occupation ? String(row.occupation) : undefined,
    accountType: row.account_type ?? undefined,
    idCardType: resolvedIdCardType,
    idCardNumber: row.id_card_number ? String(row.id_card_number) : undefined,
    kycTier: resolvedKycTier,
    nationality: row.nationality != null ? String(row.nationality) : fb?.nationality,
    kycIntroducer: mapKycIntroducerFromRow(row) ?? fb?.kycIntroducer,
    kycUpgradedAt: row.kyc_upgraded_at != null ? String(row.kyc_upgraded_at) : fb?.kycUpgradedAt,
    photoUrl: row.photo_url ? String(row.photo_url) : undefined,
    idCardPhotoUrl: row.id_card_photo_url ? String(row.id_card_photo_url) : undefined,
    ...(row.savings_opening_fee_collected != null
      ? { savingsOpeningFeeCollected: row.savings_opening_fee_collected === true }
      : {}),
    ...(row.savings_opening_fee_recovered != null
      ? { savingsOpeningFeeRecovered: Number(row.savings_opening_fee_recovered) }
      : {}),
    nextOfKin: mapNextOfKinFromRow(row),
    accountNumber: row.account_number ? String(row.account_number) : undefined,

    rejectionReason: row.rejection_reason ? String(row.rejection_reason) : undefined,

    homeBranchId: String(row.home_branch_id),

    assignedFieldAgentId: row.assigned_field_agent_id
      ? String(row.assigned_field_agent_id)
      : undefined,

    createdByFieldAgentId: String(row.created_by_field_agent_id),

    dailyContributionAmount: Number(row.daily_contribution_amount ?? 0),

    pendingDailyContributionAmount:
      row.pending_daily_contribution_amount != null
        ? Number(row.pending_daily_contribution_amount)
        : (pendingDailyContributionFallback.get(
            pendingDailyKey(String(row.tenant_id), String(row.id))
          )?.amount ?? undefined),
    pendingDailyContributionSetAt:
      row.pending_daily_contribution_set_at != null
        ? String(row.pending_daily_contribution_set_at)
        : (pendingDailyContributionFallback.get(
            pendingDailyKey(String(row.tenant_id), String(row.id))
          )?.setAt ?? undefined),

    lockedBalance:
      row.locked_balance != null ? Number(row.locked_balance) : undefined,

    loanCollateralLocked:
      row.loan_collateral_locked != null ? Number(row.loan_collateral_locked) : undefined,

    loanQualifiedAt: row.loan_qualified_at != null ? String(row.loan_qualified_at) : undefined,
    loanQualificationBadge:
      row.loan_qualification_badge != null ? String(row.loan_qualification_badge) : undefined,

    routeId: row.route_id ? String(row.route_id) : undefined,

    status: row.status

  });

}



function insertRowFromCustomer(
  customer: Customer,
  options?: { offlineClientId?: string }
): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: customer.id,
    tenant_id: customer.tenantId,
    full_name: customer.fullName,
    email: customer.email || null,
    phone: customer.phone,
    location: customer.location ?? null,
    house_number: customer.houseNumber ?? null,
    date_of_birth: customer.dateOfBirth ?? null,
    occupation: customer.occupation ?? null,
    account_type: customer.accountType ?? null,
    id_card_type: customer.idCardType ?? null,
    id_card_number: customer.idCardNumber ?? null,
    kyc_tier: customer.kycTier ?? "full",
    nationality: customer.nationality ?? null,
    kyc_introducer_name: customer.kycIntroducer?.fullName ?? null,
    kyc_introducer_phone: customer.kycIntroducer?.phone ?? null,
    kyc_introducer_relationship: customer.kycIntroducer?.relationship ?? null,
    kyc_introducer_ghana_card: customer.kycIntroducer?.ghanaCardNumber ?? null,
    kyc_upgraded_at: customer.kycUpgradedAt ?? null,
    photo_url: customer.photoUrl ?? null,
    id_card_photo_url: customer.idCardPhotoUrl ?? null,
    savings_opening_fee_collected: customer.savingsOpeningFeeCollected ?? false,
    savings_opening_fee_recovered: customer.savingsOpeningFeeRecovered ?? 0,
    next_of_kin_name: customer.nextOfKin?.fullName ?? null,
    next_of_kin_phone: customer.nextOfKin?.phone ?? null,
    next_of_kin_location: customer.nextOfKin?.location ?? null,
    next_of_kin_house_number: customer.nextOfKin?.houseNumber ?? null,
    next_of_kin: kinSummary(customer.nextOfKin),
    account_number: customer.accountNumber ?? null,
    rejection_reason: customer.rejectionReason ?? null,
    home_branch_id: customer.homeBranchId,
    assigned_field_agent_id: customer.assignedFieldAgentId ?? null,
    created_by_field_agent_id: customer.createdByFieldAgentId,
    daily_contribution_amount: customer.dailyContributionAmount,
    status: customer.status
  };
  if (options?.offlineClientId) {
    row.offline_client_id = options.offlineClientId;
  }
  return row;
}



export async function getCustomerWithdrawableBalance(
  tenantId: string,
  customerId: string,
  options?: { /** When true, next installment reserve may be used (loan repayment debit). */ allowLoanReserve?: boolean }
): Promise<number> {
  const customer = await getCustomerById(tenantId, customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }
  const total = await computeCustomerBalance(tenantId, customerId);
  const locked = customer.lockedBalance ?? 0;
  const collateral = customer.loanCollateralLocked ?? 0;
  let loanReserve = 0;
  if (!options?.allowLoanReserve) {
    try {
      const { getCustomerLoanInstallmentReserve } = await import("./loanReserveService.js");
      loanReserve = await getCustomerLoanInstallmentReserve(tenantId, customerId);
    } catch {
      loanReserve = 0;
    }
  }
  return Math.max(0, total - locked - collateral - loanReserve);
}

export async function createCustomer(

  tenantId: string,

  createdByFieldAgentId: string,

  input: unknown

): Promise<Customer> {

  const payload = createCustomerInputSchema.parse(input);
  const homeBranchId = await resolveHomeBranchId(tenantId, undefined, payload.homeBranchId);

  const nextCustomer: Customer = customerSchema.parse({

    id: randomUUID(),

    tenantId,

    fullName: payload.fullName,

    phone: payload.phone,

    homeBranchId,

    assignedFieldAgentId: payload.assignedFieldAgentId,

    createdByFieldAgentId,

    dailyContributionAmount: payload.dailyContributionAmount,

    status: "active"

  });



  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const insertPayload = insertRowFromCustomer(nextCustomer);
    let { error } = await supabase.from("customers").insert(insertPayload);
    if (error && isMissingIdCardTypeColumn(error.message)) {
      const retry = await supabase.from("customers").insert(stripKycColumns(insertPayload));
      error = retry.error;
    }

    if (error) {

      throw new Error(`Failed to create customer: ${error.message}`);

    }

  } else {

    const customers = getTenantCustomers(tenantId);

    setTenantCustomers(tenantId, [...customers, nextCustomer]);

  }



  return enrichCustomerWithAgentNames(tenantId, nextCustomer);

}

export async function registerLoanBorrower(
  tenantId: string,
  createdByUserId: string,
  input: unknown
): Promise<Customer> {
  const payload = loanBorrowerRegistrationSchema.parse(input);
  const homeBranchId = await resolveHomeBranchId(tenantId, undefined, payload.homeBranchId);
  if (!homeBranchId) {
    throw new Error("Invalid branch");
  }

  const nextCustomer: Customer = customerSchema.parse({
    id: randomUUID(),
    tenantId,
    fullName: payload.fullName,
    email: payload.email,
    phone: payload.phone,
    location: payload.location,
    houseNumber: payload.houseNumber,
    accountType: "savings",
    idCardNumber: payload.idCardNumber,
    photoUrl: payload.photoUrl,
    idCardPhotoUrl: payload.idCardPhotoUrl,
    savingsOpeningFeeCollected: false,
    savingsOpeningFeeRecovered: 0,
    nextOfKin: payload.nextOfKin,
    homeBranchId,
    assignedFieldAgentId: payload.assignedFieldAgentId ?? createdByUserId,
    createdByFieldAgentId: createdByUserId,
    dailyContributionAmount: 0,
    status: "active"
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const accountNumber = await generateCustomerAccountNumber(tenantId);
    nextCustomer.accountNumber = accountNumber;
    const insertPayload = insertRowFromCustomer(nextCustomer);
    let { error } = await supabase.from("customers").insert(insertPayload);
    if (error && isMissingIdCardTypeColumn(error.message)) {
      const retry = await supabase.from("customers").insert(stripKycColumns(insertPayload));
      error = retry.error;
    }
    if (error) {
      throw new Error(`Failed to register borrower: ${error.message}`);
    }
  } else {
    const customers = getTenantCustomers(tenantId);
    setTenantCustomers(tenantId, [...customers, nextCustomer]);
  }

  return enrichCustomerWithAgentNames(tenantId, nextCustomer);
}

export async function submitCustomerRegistration(

  tenantId: string,

  agentUserId: string,

  agentBranchId: string | undefined,

  input: unknown,

  options?: { offlineClientId?: string }

): Promise<Customer> {

  const payload = customerRegistrationInputSchema.parse(input) as CustomerRegistrationInput;
  const offlineClientId = options?.offlineClientId?.trim() || undefined;
  const formSetup = await getRegistrationFormSetup(tenantId);
  const formIssue = registrationFormIssue(payload, formSetup);
  if (formIssue) {
    throw new Error(formIssue);
  }
  if (payload.accountType === "savings" && formSetup.savingsOpeningFeeGhs > 0) {
    if (
      formSetup.savingsOpeningFeeHandling === "cash_now" &&
      payload.savingsOpeningFeeCollected !== true
    ) {
      throw new Error(
        `This company requires the GHS ${formSetup.savingsOpeningFeeGhs.toFixed(2)} savings opening fee to be collected in cash at registration.`
      );
    }
    if (
      formSetup.savingsOpeningFeeHandling === "deduct_later" &&
      payload.savingsOpeningFeeCollected !== false
    ) {
      throw new Error(
        `This company is configured to defer the GHS ${formSetup.savingsOpeningFeeGhs.toFixed(2)} savings opening fee to first deposit(s).`
      );
    }
  }
  const normalized = registrationPayloadForSetup(payload, formSetup);
  const homeBranchId = await resolveHomeBranchId(
    tenantId,
    agentBranchId,
    payload.homeBranchId
  );

  const supabase = getSupabaseAdminClient();

  if (supabase && offlineClientId) {
    const { data: existing, error: existingError } = await supabase
      .from("customers")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("offline_client_id", offlineClientId)
      .maybeSingle();
    if (existingError && !/offline_client_id/i.test(existingError.message)) {
      throw new Error(`Failed to check offline registration: ${existingError.message}`);
    }
    if (existing) {
      return enrichCustomerWithAgentNames(tenantId, mapCustomerRow(existing));
    }
  } else if (!supabase && offlineClientId) {
    const existing = getTenantCustomers(tenantId).find(
      (c) => (c as Customer & { offlineClientId?: string }).offlineClientId === offlineClientId
    );
    if (existing) {
      return enrichCustomerWithAgentNames(tenantId, existing);
    }
  }

  const nextCustomer: Customer = customerSchema.parse({

    id: randomUUID(),

    tenantId,

    fullName: payload.fullName,

    email: normalized.email || undefined,

    phone: payload.phone,

    location: payload.location,
    houseNumber: normalized.houseNumber,
    dateOfBirth: normalized.dateOfBirth,
    occupation: normalized.occupation,
    accountType: payload.accountType,
    idCardType: (normalized.idCardType as Customer["idCardType"]) ?? undefined,
    idCardNumber: normalized.idCardNumber,
    kycTier: normalized.idCardType === "no_id_simplified_kyc" ? "simplified" : "full",
    nationality: normalized.nationality,
    kycIntroducer: normalized.kycIntroducer
      ? {
          fullName: normalized.kycIntroducer.fullName,
          phone: normalized.kycIntroducer.phone,
          relationship: normalized.kycIntroducer.relationship,
          ghanaCardNumber: normalized.kycIntroducer.ghanaCardNumber
        }
      : undefined,
    photoUrl: normalized.photoUrl,
    idCardPhotoUrl: normalized.idCardPhotoUrl,
    savingsOpeningFeeCollected:
      payload.accountType === "savings" ? Boolean(payload.savingsOpeningFeeCollected) : false,
    savingsOpeningFeeRecovered: 0,
    nextOfKin:
      normalized.nextOfKin?.fullName && normalized.nextOfKin.phone && normalized.nextOfKin.location
        ? {
            fullName: normalized.nextOfKin.fullName,
            phone: normalized.nextOfKin.phone,
            location: normalized.nextOfKin.location,
            houseNumber: normalized.nextOfKin.houseNumber
          }
        : undefined,
    homeBranchId,

    assignedFieldAgentId: payload.assignedFieldAgentId ?? agentUserId,

    createdByFieldAgentId: agentUserId,

    dailyContributionAmount: normalized.dailyContributionAmount ?? 0,

    status: "pending_activation"

  });

  if (supabase) {
    const insertPayload = insertRowFromCustomer(nextCustomer, { offlineClientId });
    let { error } = await supabase.from("customers").insert(insertPayload);

    if (error && isMissingIdCardTypeColumn(error.message)) {
      const retry = await supabase.from("customers").insert(stripKycColumns(insertPayload));
      error = retry.error;
      if (!error) {
        kycMetadataFallback.set(pendingDailyKey(tenantId, nextCustomer.id), {
          idCardType: nextCustomer.idCardType,
          kycTier: nextCustomer.kycTier,
          nationality: nextCustomer.nationality,
          kycIntroducer: nextCustomer.kycIntroducer,
          kycUpgradedAt: nextCustomer.kycUpgradedAt
        });
      }
    }

    if (error) {
      if (offlineClientId && /offline_client_id|duplicate|unique/i.test(error.message)) {
        const { data: raced } = await supabase
          .from("customers")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("offline_client_id", offlineClientId)
          .maybeSingle();
        if (raced) {
          return enrichCustomerWithAgentNames(tenantId, mapCustomerRow(raced));
        }
      }
      throw new Error(`Failed to submit registration: ${error.message}`);

    }

  } else {

    const customers = getTenantCustomers(tenantId);
    const stored = offlineClientId
      ? ({ ...nextCustomer, offlineClientId } as Customer & { offlineClientId: string })
      : nextCustomer;
    setTenantCustomers(tenantId, [...customers, stored]);

  }

  try {
    await notifyTenantStaff({
      tenantId,
      roles: ["admin", "coordinator"],
      kind: "registration_pending",
      customerId: nextCustomer.id,
      title: "New registration pending",
      body: `${nextCustomer.fullName} (${nextCustomer.phone}) is awaiting coordinator approval.`
    });
  } catch {
    // Non-blocking
  }

  return enrichCustomerWithAgentNames(tenantId, nextCustomer);

}



export async function approveCustomerRegistration(

  tenantId: string,

  customerId: string,

  approvedByUserId: string

): Promise<Customer> {

  const existing = await getCustomerById(tenantId, customerId);

  if (!existing) {

    throw new Error("Customer not found");

  }

  if (existing.status !== "pending_activation") {

    throw new Error("Only pending registrations can be approved");

  }



  const accountNumber = await generateCustomerAccountNumber(tenantId);

  const supabase = getSupabaseAdminClient();

  if (supabase) {

    const { data, error } = await supabase

      .from("customers")

      .update({

        status: "active",

        account_number: accountNumber,

        rejection_reason: null,

        last_qualifying_activity_at: new Date().toISOString()

      })

      .eq("tenant_id", tenantId)

      .eq("id", customerId)

      .select("*")

      .single();

    if (error || !data) {

      throw new Error(`Failed to approve customer: ${error?.message ?? "unknown"}`);

    }

    const approved = mapCustomerRow(data as Record<string, unknown>);

    await applySavingsInitialDepositOnApproval(tenantId, approved, approvedByUserId);

    const withDeposit = (await getCustomerById(tenantId, customerId)) ?? approved;

    await createAgentNotification({

      tenantId,

      userId: withDeposit.createdByFieldAgentId,

      customerId: withDeposit.id,

      kind: "registration_approved",

      title: "Registration approved",

      body:
        withDeposit.accountType === "savings"
          ? `${withDeposit.fullName} is active. Account ${accountNumber}. GHS ${withDeposit.lockedBalance ?? 0} initial deposit credited (not withdrawable).`
          : `${withDeposit.fullName} is active. Account number: ${accountNumber}`

    });

    return enrichCustomerWithAgentNames(tenantId, withDeposit);

  }



  const customers = getTenantCustomers(tenantId);

  const target = customers.find((c) => c.id === customerId);

  if (!target) {

    throw new Error("Customer not found");

  }

  target.status = "active";

  target.accountNumber = accountNumber;

  setTenantCustomers(tenantId, customers);

  await applySavingsInitialDepositOnApproval(tenantId, target, approvedByUserId);

  await createAgentNotification({

    tenantId,

    userId: target.createdByFieldAgentId,

    customerId: target.id,

    kind: "registration_approved",

    title: "Registration approved",

    body:
      target.accountType === "savings"
        ? `${target.fullName} is active. Account ${accountNumber}. GHS ${target.lockedBalance ?? 0} initial deposit credited (not withdrawable).`
        : `${target.fullName} is active. Account number: ${accountNumber}`

  });

  return enrichCustomerWithAgentNames(tenantId, target);

}



export async function rejectCustomerRegistration(

  tenantId: string,

  customerId: string,

  raw: unknown

): Promise<Customer> {

  const parsed = rejectCustomerSchema.safeParse(raw);

  const reason = parsed.success ? parsed.data.reason : undefined;

  const existing = await getCustomerById(tenantId, customerId);

  if (!existing) {

    throw new Error("Customer not found");

  }

  if (existing.status !== "pending_activation") {

    throw new Error("Only pending registrations can be rejected");

  }



  const supabase = getSupabaseAdminClient();

  if (supabase) {

    const { data, error } = await supabase

      .from("customers")

      .update({ status: "rejected", rejection_reason: reason ?? "Rejected by coordinator" })

      .eq("tenant_id", tenantId)

      .eq("id", customerId)

      .select("*")

      .single();

    if (error || !data) {

      throw new Error(`Failed to reject customer: ${error?.message ?? "unknown"}`);

    }

    const rejected = mapCustomerRow(data as Record<string, unknown>);

    await createAgentNotification({

      tenantId,

      userId: rejected.createdByFieldAgentId,

      customerId: rejected.id,

      kind: "registration_rejected",

      title: "Registration rejected",

      body: `${rejected.fullName} was not approved.${reason ? ` Reason: ${reason}` : ""}`

    });

    return enrichCustomerWithAgentNames(tenantId, rejected);

  }



  const customers = getTenantCustomers(tenantId);

  const target = customers.find((c) => c.id === customerId);

  if (!target) {

    throw new Error("Customer not found");

  }

  target.status = "rejected";

  target.rejectionReason = reason ?? "Rejected by coordinator";

  setTenantCustomers(tenantId, customers);

  await createAgentNotification({

    tenantId,

    userId: target.createdByFieldAgentId,

    customerId: target.id,

    kind: "registration_rejected",

    title: "Registration rejected",

    body: `${target.fullName} was not approved.${reason ? ` Reason: ${reason}` : ""}`

  });

  return enrichCustomerWithAgentNames(tenantId, target);

}



async function enrichCustomersWithAccountBalances(
  tenantId: string,
  customers: Customer[]
): Promise<Customer[]> {
  const active = customers.filter((c) => c.status === "active");
  if (active.length === 0) {
    return customers;
  }

  const totals = new Map<string, number>();
  const supabase = getSupabaseAdminClient();

  if (supabase) {
    const activeIds = active.map((c) => c.id);
    if (activeIds.length === 0) {
      return customers;
    }
    const { data, error } = await supabase
      .from("ledger_entries")
      .select("customer_id, entry_type, amount")
      .eq("tenant_id", tenantId)
      .in("customer_id", activeIds);

    if (error) {
      if (isMissingSupabaseResource(error.message)) {
        return customers;
      }
      throw new Error(`Failed to load customer balances: ${error.message}`);
    }

    for (const row of data ?? []) {
      const customerId = String(row.customer_id);
      const amount = Number(row.amount);
      const delta = row.entry_type === "credit" ? amount : -amount;
      totals.set(customerId, (totals.get(customerId) ?? 0) + delta);
    }
  } else {
    for (const customer of active) {
      totals.set(customer.id, await computeCustomerBalance(tenantId, customer.id));
    }
  }

  const withBalances = await Promise.all(
    customers.map(async (customer) => {
      if (customer.status !== "active") {
        return customer;
      }
      const accountBalance = totals.get(customer.id) ?? 0;
      const locked = customer.lockedBalance ?? 0;
      const collateral = customer.loanCollateralLocked ?? 0;
      let loanReserveAmount = 0;
      try {
        const { getCustomerLoanInstallmentReserve } = await import("./loanReserveService.js");
        loanReserveAmount = await getCustomerLoanInstallmentReserve(tenantId, customer.id);
      } catch {
        loanReserveAmount = 0;
      }
      return customerSchema.parse({
        ...customer,
        accountBalance,
        loanCollateralLocked: collateral > 0 ? collateral : undefined,
        loanReserveAmount: loanReserveAmount > 0 ? loanReserveAmount : undefined,
        loanQualificationSuggestedMaxGhs: undefined,
        withdrawableBalance: Math.max(
          0,
          accountBalance - locked - collateral - loanReserveAmount
        )
      });
    })
  );
  return withBalances;
}

/** List columns without heavy photo payloads — used by desks and live refresh. */
const LIGHT_CUSTOMER_COLUMNS = [
  "id",
  "tenant_id",
  "full_name",
  "email",
  "phone",
  "location",
  "house_number",
  "date_of_birth",
  "occupation",
  "account_type",
  "id_card_type",
  "id_card_number",
  "kyc_tier",
  "nationality",
  "kyc_introducer_name",
  "kyc_introducer_phone",
  "kyc_introducer_relationship",
  "kyc_introducer_ghana_card",
  "kyc_upgraded_at",
  "savings_opening_fee_collected",
  "savings_opening_fee_recovered",
  "next_of_kin_name",
  "next_of_kin_phone",
  "next_of_kin_location",
  "next_of_kin_house_number",
  "account_number",
  "rejection_reason",
  "home_branch_id",
  "assigned_field_agent_id",
  "created_by_field_agent_id",
  "daily_contribution_amount",
  "pending_daily_contribution_amount",
  "pending_daily_contribution_set_at",
  "locked_balance",
  "loan_collateral_locked",
  "loan_qualified_at",
  "loan_qualification_badge",
  "route_id",
  "status",
  "created_at"
].join(",");

export async function listCustomers(
  tenantId: string,
  options?: { agentId?: string; status?: string; light?: boolean; branchId?: string }
): Promise<Customer[]> {
  const supabase = getSupabaseAdminClient();
  const branchId = options?.branchId?.trim() || undefined;

  if (!supabase) {
    let rows = getTenantCustomers(tenantId);

    if (options?.agentId) {
      rows = rows.filter(
        (c) => c.createdByFieldAgentId === options.agentId || c.assignedFieldAgentId === options.agentId
      );
    }

    if (branchId) {
      rows = rows.filter((c) => c.homeBranchId === branchId);
    }

    if (options?.status) {
      rows = rows.filter((c) => c.status === options.status);
    }

    const withoutPhotos = options?.light
      ? rows.map((row) => ({
          ...row,
          photoUrl: undefined,
          idCardPhotoUrl: undefined
        }))
      : rows;

    const named = await enrichCustomersWithAgentNames(tenantId, withoutPhotos);
    if (options?.light || options?.agentId) {
      return named;
    }
    return enrichCustomersWithAccountBalances(tenantId, named);
  }

  const runCustomerListQuery = async (selectCols: string) => {
    let q = supabase
      .from("customers")
      .select(selectCols)
      .eq("tenant_id", tenantId);

    if (options?.agentId) {
      q = q.or(
        `created_by_field_agent_id.eq.${options.agentId},assigned_field_agent_id.eq.${options.agentId}`
      );
    }

    if (branchId) {
      q = q.eq("home_branch_id", branchId);
    }

    if (options?.status) {
      q = q.eq("status", options.status);
    }

    return q.order("created_at", { ascending: false });
  };

  let { data, error } = await runCustomerListQuery(options?.light ? LIGHT_CUSTOMER_COLUMNS : "*");

  if (
    error &&
    options?.light &&
    (isMissingPendingDailyColumn(error.message) || isMissingIdCardTypeColumn(error.message))
  ) {
    const kycCols = new Set<string>(SIMPLIFIED_KYC_COLUMNS);
    const fallbackCols = LIGHT_CUSTOMER_COLUMNS.split(",")
      .filter((col) => !col.startsWith("pending_daily_contribution_") && !kycCols.has(col))
      .join(",");
    const retry = await runCustomerListQuery(fallbackCols);
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    throw new Error(`Failed to list customers: ${error.message}`);
  }



  const customers = (data ?? []).map((row) =>
    mapCustomerRow(row as unknown as Record<string, unknown>)
  );
  const named = await enrichCustomersWithAgentNames(tenantId, customers);
  if (options?.light || options?.agentId) {
    return named;
  }
  return enrichCustomersWithAccountBalances(tenantId, named);

}



export async function searchActiveCustomers(

  tenantId: string,

  queryText: string,

  agentId?: string

): Promise<Customer[]> {

  const q = queryText.trim().toLowerCase();

  if (!q) {

    return [];

  }

  const all = await listCustomers(tenantId, { agentId, status: "active" });

  return all.filter(

    (c) =>

      c.fullName.toLowerCase().includes(q) ||

      (c.accountNumber?.toLowerCase().includes(q) ?? false) ||

      c.phone.includes(q)

  );

}



export async function getCustomerById(tenantId: string, customerId: string): Promise<Customer | undefined> {

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    const found = getTenantCustomers(tenantId).find((customer) => customer.id === customerId);
    if (!found) {
      return undefined;
    }
    const [withBalances] = await enrichCustomersWithAccountBalances(tenantId, [found]);
    return withBalances ?? found;
  }



  const { data, error } = await supabase

    .from("customers")

    .select("*")

    .eq("tenant_id", tenantId)

    .eq("id", customerId)

    .maybeSingle();



  if (error) {

    throw new Error(`Failed to fetch customer: ${error.message}`);

  }



  if (!data) {

    return undefined;

  }



  const named = await enrichCustomerWithAgentNames(
    tenantId,
    mapCustomerRow(data as Record<string, unknown>)
  );
  const [withBalances] = await enrichCustomersWithAccountBalances(tenantId, [named]);
  return withBalances ?? named;

}

export async function patchCustomerKycPhotos(
  tenantId: string,
  customerId: string,
  photos: { photoUrl?: string; idCardPhotoUrl?: string }
): Promise<Customer> {
  const customer = await getCustomerById(tenantId, customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }
  const updated = customerSchema.parse({
    ...customer,
    photoUrl: photos.photoUrl ?? customer.photoUrl,
    idCardPhotoUrl: photos.idCardPhotoUrl ?? customer.idCardPhotoUrl
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customers")
      .update({
        photo_url: updated.photoUrl ?? null,
        id_card_photo_url: updated.idCardPhotoUrl ?? null
      })
      .eq("tenant_id", tenantId)
      .eq("id", customerId);
    if (error) {
      throw new Error(`Failed to update customer photos: ${error.message}`);
    }
  } else {
    const customers = getTenantCustomers(tenantId);
    const idx = customers.findIndex((c) => c.id === customerId);
    if (idx < 0) {
      throw new Error("Customer not found");
    }
    customers[idx] = updated;
    setTenantCustomers(tenantId, customers);
  }

  return enrichCustomerWithAgentNames(tenantId, updated);
}

async function resolveAssignmentRouteId(
  tenantId: string,
  customer: Customer,
  assignedFieldAgentId: string | null,
  explicitRouteId: string | null | undefined
): Promise<string | null> {
  if (explicitRouteId !== undefined) {
    if (explicitRouteId === null) {
      return null;
    }
    const routes = await listFieldRoutes(tenantId);
    const route = routes.find((r) => r.id === explicitRouteId);
    if (!route) {
      throw new Error("Target route not found");
    }
    if (route.branchId !== customer.homeBranchId) {
      throw new Error("Route branch must match the customer's home branch");
    }
    if (route.status !== "active") {
      throw new Error("Target route is inactive");
    }
    if (
      assignedFieldAgentId &&
      route.assignedFieldAgentId &&
      route.assignedFieldAgentId !== assignedFieldAgentId
    ) {
      throw new Error("Target route is assigned to a different field agent");
    }
    return explicitRouteId;
  }

  if (!assignedFieldAgentId) {
    return null;
  }

  const routes = await listFieldRoutes(tenantId);
  const matches = routes.filter(
    (r) =>
      r.status === "active" &&
      r.branchId === customer.homeBranchId &&
      r.assignedFieldAgentId === assignedFieldAgentId
  );
  if (matches.length === 1) {
    return matches[0]!.id;
  }
  if (matches.length === 0) {
    return null;
  }
  // Ambiguous: keep current route only if the new agent owns it; otherwise clear.
  if (customer.routeId && matches.some((r) => r.id === customer.routeId)) {
    return customer.routeId;
  }
  return null;
}

export async function assignCustomerFieldAgent(
  tenantId: string,
  customerId: string,
  input: unknown
): Promise<Customer> {
  const { assignedFieldAgentId, routeId: explicitRouteId } =
    assignCustomerFieldAgentSchema.parse(input);

  const customer = await getCustomerById(tenantId, customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }

  if (assignedFieldAgentId) {
    const agents = await listTenantFieldAgents(tenantId);
    const target = agents.find(
      (agent) => agent.userId === assignedFieldAgentId && agent.status === "active"
    );
    if (!target) {
      throw new Error("Target field agent not found or is inactive");
    }
  }

  const nextRouteId = await resolveAssignmentRouteId(
    tenantId,
    customer,
    assignedFieldAgentId,
    explicitRouteId
  );

  const updated = customerSchema.parse({
    ...customer,
    assignedFieldAgentId: assignedFieldAgentId ?? undefined,
    routeId: nextRouteId ?? undefined
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customers")
      .update({
        assigned_field_agent_id: assignedFieldAgentId,
        route_id: nextRouteId
      })
      .eq("tenant_id", tenantId)
      .eq("id", customerId);

    if (error) {
      throw new Error(`Failed to update customer assignment: ${error.message}`);
    }
  } else {
    const customers = getTenantCustomers(tenantId);
    const idx = customers.findIndex((c) => c.id === customerId);
    if (idx < 0) {
      throw new Error("Customer not found");
    }
    customers[idx] = updated;
    setTenantCustomers(tenantId, customers);
  }

  return enrichCustomerWithAgentNames(tenantId, updated);
}

async function clearCustomerFinancialHistory(tenantId: string, customerId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }

  // Capture affected collection batch IDs before deleting this customer's lines so parent
  // batch totals stay accurate (and empty draft/pending headers do not linger as ghost batches).
  const { data: affectedLineRows } = await supabase
    .from("field_agent_collection_batch_lines")
    .select("batch_id")
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
  const affectedBatchIds = Array.from(
    new Set((affectedLineRows ?? []).map((r) => String(r.batch_id)).filter(Boolean))
  );

  // Delete child rows that hold FK references to customer_transactions(id) first.
  const { error: batchLinesError } = await supabase
    .from("field_agent_collection_batch_lines")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
  if (batchLinesError && !isMissingSupabaseResource(batchLinesError.message)) {
    throw new Error(`Failed to clear call-over batch lines: ${batchLinesError.message}`);
  }

  // Recompute remaining totals on each affected batch; remove empty unposted batch headers.
  for (const batchId of affectedBatchIds) {
    const { data: remainingLines } = await supabase
      .from("field_agent_collection_batch_lines")
      .select("amount")
      .eq("batch_id", batchId);
    const remainingCount = remainingLines?.length ?? 0;
    if (remainingCount === 0) {
      await supabase
        .from("field_agent_collection_batches")
        .delete()
        .eq("tenant_id", tenantId)
        .eq("id", batchId)
        .in("status", ["draft", "pending_approval", "rejected"]);
    } else {
      const remainingTotal =
        Math.round(
          (remainingLines ?? []).reduce((sum, row) => sum + Number(row.amount ?? 0), 0) * 100
        ) / 100;
      await supabase
        .from("field_agent_collection_batches")
        .update({
          total_amount: remainingTotal,
          line_count: remainingCount,
          updated_at: new Date().toISOString()
        })
        .eq("tenant_id", tenantId)
        .eq("id", batchId);
    }
  }

  const { error: disclosuresError } = await supabase
    .from("customer_balance_disclosures")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
  if (disclosuresError && !isMissingSupabaseResource(disclosuresError.message)) {
    throw new Error(`Failed to clear balance/withdrawal disclosures: ${disclosuresError.message}`);
  }

  const { error: ledgerError } = await supabase
    .from("ledger_entries")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
  if (ledgerError) {
    throw new Error(`Failed to clear ledger: ${ledgerError.message}`);
  }

  // Break self-referencing reversal FKs before deleting customer_transactions.
  const { error: unlinkReversalsError } = await supabase
    .from("customer_transactions")
    .update({ reverses_transaction_id: null })
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .not("reverses_transaction_id", "is", null);
  if (unlinkReversalsError && !isMissingSupabaseResource(unlinkReversalsError.message)) {
    throw new Error(`Failed to unlink reversed transactions: ${unlinkReversalsError.message}`);
  }

  const { error: txError } = await supabase
    .from("customer_transactions")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
  if (txError) {
    throw new Error(`Failed to clear transactions: ${txError.message}`);
  }

  // Also clear Susu cycle history so a reset customer starts cleanly on Card #1.
  const { error: unlinkCyclesError } = await supabase
    .from("susu_customer_cycles")
    .update({ rolled_from_cycle_id: null })
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId)
    .not("rolled_from_cycle_id", "is", null);
  if (unlinkCyclesError && !isMissingSupabaseResource(unlinkCyclesError.message)) {
    throw new Error(`Failed to unlink Susu cycles: ${unlinkCyclesError.message}`);
  }

  const { error: cyclesError } = await supabase
    .from("susu_customer_cycles")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
  if (cyclesError && !isMissingSupabaseResource(cyclesError.message)) {
    throw new Error(`Failed to clear Susu cycles: ${cyclesError.message}`);
  }
}

const QUALIFYING_TX_TYPES = new Set(["daily_susu", "deposit", "withdrawal"]);

/** Record last qualifying financial activity for inactivity automation. */
export async function touchCustomerQualifyingActivity(
  tenantId: string,
  customerId: string,
  at: Date = new Date()
): Promise<void> {
  const iso = at.toISOString();
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customers")
      .update({ last_qualifying_activity_at: iso })
      .eq("tenant_id", tenantId)
      .eq("id", customerId);
    if (error && !isMissingSupabaseResource(error.message)) {
      console.warn("[customers] failed to touch last activity:", error.message);
    }
    return;
  }
  // In-memory store keeps status only; inactivity job reads transactions there.
}

export async function updateCustomerStatus(
  tenantId: string,
  customerId: string,
  input: unknown
): Promise<Customer> {
  const payload = updateCustomerStatusSchema.parse(input);
  const existing = await getCustomerById(tenantId, customerId);
  if (!existing) {
    throw new Error("Customer not found");
  }
  if (
    existing.status === "pending_activation" ||
    existing.status === "rejected"
  ) {
    throw new Error("Use approve/reject for registration status. Status management applies to activated accounts.");
  }

  const nextStatus: AdminManagedCustomerStatus = payload.status;
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const patch: Record<string, unknown> = { status: nextStatus };
    if (nextStatus === "active") {
      patch.last_qualifying_activity_at = new Date().toISOString();
      patch.rejection_reason = null;
    } else if (payload.reason) {
      patch.rejection_reason = payload.reason;
    }
    const { data, error } = await supabase
      .from("customers")
      .update(patch)
      .eq("tenant_id", tenantId)
      .eq("id", customerId)
      .select("*")
      .single();
    if (error || !data) {
      throw new Error(`Failed to update customer status: ${error?.message ?? "unknown"}`);
    }
    return mapCustomerRow(data as Record<string, unknown>);
  }

  const customers = getTenantCustomers(tenantId);
  const idx = customers.findIndex((c) => c.id === customerId);
  if (idx < 0) {
    throw new Error("Customer not found");
  }
  customers[idx] = { ...customers[idx]!, status: nextStatus };
  setTenantCustomers(tenantId, customers);
  return customers[idx]!;
}

function monthsAgoIso(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.toISOString();
}

/**
 * Apply 12-month INACTIVE / 24-month DORMANT rules from last qualifying activity.
 * Does not override closed, rejected, pending, or suspended accounts.
 * 24-month dormant overrides inactive.
 */
export async function applyCustomerInactivityRules(): Promise<{
  markedInactive: number;
  markedDormant: number;
}> {
  const dormantCutoff = monthsAgoIso(CUSTOMER_DORMANT_AFTER_MONTHS);
  const inactiveCutoff = monthsAgoIso(CUSTOMER_INACTIVE_AFTER_MONTHS);
  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    return { markedInactive: 0, markedDormant: 0 };
  }

  let markedDormant = 0;
  let markedInactive = 0;

  const { data: dormantRows, error: dormantError } = await supabase
    .from("customers")
    .update({ status: "dormant" })
    .in("status", ["active", "inactive"])
    .lt("last_qualifying_activity_at", dormantCutoff)
    .not("last_qualifying_activity_at", "is", null)
    .select("id");

  if (dormantError) {
    if (!isMissingSupabaseResource(dormantError.message)) {
      console.warn("[customers] dormant rule failed:", dormantError.message);
    }
  } else {
    markedDormant = dormantRows?.length ?? 0;
  }

  const { data: inactiveRows, error: inactiveError } = await supabase
    .from("customers")
    .update({ status: "inactive" })
    .eq("status", "active")
    .lt("last_qualifying_activity_at", inactiveCutoff)
    .gte("last_qualifying_activity_at", dormantCutoff)
    .not("last_qualifying_activity_at", "is", null)
    .select("id");

  if (inactiveError) {
    if (!isMissingSupabaseResource(inactiveError.message)) {
      console.warn("[customers] inactive rule failed:", inactiveError.message);
    }
  } else {
    markedInactive = inactiveRows?.length ?? 0;
  }

  return { markedInactive, markedDormant };
}

/** Wipe balances/ledger for trial reuse while keeping the customer profile. */
export async function resetCustomerAccount(tenantId: string, customerId: string): Promise<Customer> {
  const existing = await getCustomerById(tenantId, customerId);
  if (!existing) {
    throw new Error("Customer not found");
  }

  await clearCustomerFinancialHistory(tenantId, customerId);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customers")
      .update({
        locked_balance: 0,
        savings_opening_fee_collected: false,
        savings_opening_fee_recovered: 0,
        last_qualifying_activity_at: new Date().toISOString()
      })
      .eq("tenant_id", tenantId)
      .eq("id", customerId);
    if (error) {
      throw new Error(`Failed to reset customer: ${error.message}`);
    }
  } else {
    const customers = getTenantCustomers(tenantId);
    const idx = customers.findIndex((c) => c.id === customerId);
    if (idx >= 0) {
      customers[idx] = {
        ...customers[idx]!,
        lockedBalance: 0,
        savingsOpeningFeeCollected: false,
        savingsOpeningFeeRecovered: 0
      };
      setTenantCustomers(tenantId, customers);
    }
  }

  const refreshed = await getCustomerById(tenantId, customerId);
  if (!refreshed) {
    throw new Error("Customer not found after reset");
  }
  return refreshed;
}

/** Permanently delete a customer and related financial history (trial cleanup). */
export async function deleteCustomer(tenantId: string, customerId: string): Promise<void> {
  const existing = await getCustomerById(tenantId, customerId);
  if (!existing) {
    throw new Error("Customer not found");
  }

  await clearCustomerFinancialHistory(tenantId, customerId);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customers")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("id", customerId);
    if (error) {
      throw new Error(`Failed to delete customer: ${error.message}`);
    }
    return;
  }

  setTenantCustomers(
    tenantId,
    getTenantCustomers(tenantId).filter((c) => c.id !== customerId)
  );
}

export async function getPendingDailyContribution(
  tenantId: string,
  customerId: string
): Promise<number | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("customers")
      .select("pending_daily_contribution_amount")
      .eq("tenant_id", tenantId)
      .eq("id", customerId)
      .maybeSingle();
    if (!error) {
      const amount = Number(data?.pending_daily_contribution_amount ?? 0);
      return amount > 0 ? Math.round(amount * 100) / 100 : null;
    }
    if (!isMissingPendingDailyColumn(error.message)) {
      throw new Error(`Failed to load scheduled daily Susu rate: ${error.message}`);
    }
  }
  const fallback = pendingDailyContributionFallback.get(pendingDailyKey(tenantId, customerId));
  if (fallback && fallback.amount > 0) {
    return Math.round(fallback.amount * 100) / 100;
  }
  const mem = getTenantCustomers(tenantId).find((c) => c.id === customerId);
  if (mem?.pendingDailyContributionAmount && mem.pendingDailyContributionAmount > 0) {
    return Math.round(mem.pendingDailyContributionAmount * 100) / 100;
  }
  return null;
}

export async function promotePendingDailyContributionToActive(
  tenantId: string,
  customerId: string,
  nextAmount: number
): Promise<void> {
  const rounded = Math.round(Math.max(0, nextAmount) * 100) / 100;
  if (rounded <= 0) {
    return;
  }
  pendingDailyContributionFallback.delete(pendingDailyKey(tenantId, customerId));
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customers")
      .update({
        daily_contribution_amount: rounded,
        pending_daily_contribution_amount: null,
        pending_daily_contribution_set_at: null,
        pending_daily_contribution_set_by: null
      })
      .eq("tenant_id", tenantId)
      .eq("id", customerId);
    if (error && isMissingPendingDailyColumn(error.message)) {
      await supabase
        .from("customers")
        .update({ daily_contribution_amount: rounded })
        .eq("tenant_id", tenantId)
        .eq("id", customerId);
    } else if (error) {
      throw new Error(`Failed to activate next-card daily Susu rate: ${error.message}`);
    }
    return;
  }

  const customers = getTenantCustomers(tenantId);
  const idx = customers.findIndex((c) => c.id === customerId);
  if (idx >= 0) {
    customers[idx] = {
      ...customers[idx]!,
      dailyContributionAmount: rounded,
      pendingDailyContributionAmount: undefined,
      pendingDailyContributionSetAt: undefined
    };
    setTenantCustomers(tenantId, customers);
  }
}

export type ScheduleNextCardDailySusuResult = {
  customer: Customer;
  appliedImmediately: boolean;
  cancelled: boolean;
  effectiveCardNumber: number;
};

/**
 * Office-side daily Susu rate change.
 * - If the customer's current Susu card already has contributions recorded, schedules the new
 *   amount on `pending_daily_contribution_amount` so it starts automatically on the next new card
 *   without causing conflicts on the current card.
 * - If the current card has no contributions yet (or the previous card already matured/closed),
 *   applies the new amount immediately so the upcoming card starts with it.
 */
export async function scheduleNextCardDailySusu(
  tenantId: string,
  customerId: string,
  actorUserId: string,
  input: unknown
): Promise<ScheduleNextCardDailySusuResult> {
  const payload = scheduleNextCardDailySusuSchema.parse(input);
  const existing = await getCustomerById(tenantId, customerId);
  if (!existing) {
    throw new Error("Customer not found");
  }
  if (existing.accountType !== "susu") {
    throw new Error("Daily Susu rate changes only apply to Susu accounts");
  }
  if (existing.status !== "active") {
    throw new Error("Customer account must be active to change the daily Susu amount");
  }

  const {
    getCustomerSusuCycleSummary,
    lockCurrentOpenCycleRateIfNeeded,
    updateEmptyOpenCycleDailyRate
  } = await import("./susuCycleCommissionService.js");
  const summary = await getCustomerSusuCycleSummary(tenantId, customerId);
  const cards = summary.passbook.cards;
  const activeCard =
    cards.find((c) => c.cycleNumber === summary.passbook.activeCardNumber) ??
    cards[cards.length - 1] ??
    null;

  const hasContributionsOnOpenCard = Boolean(
    activeCard && activeCard.status === "open" && activeCard.grossContributions > 0.005
  );
  const currentCardNumber = activeCard?.cycleNumber ?? 1;
  const nextCardNumber =
    activeCard && (activeCard.status === "matured" || activeCard.status === "closed" || hasContributionsOnOpenCard)
      ? currentCardNumber + 1
      : currentCardNumber;

  const supabase = getSupabaseAdminClient();
  const clearPendingInStore = async () => {
    pendingDailyContributionFallback.delete(pendingDailyKey(tenantId, customerId));
    if (supabase) {
      const { error } = await supabase
        .from("customers")
        .update({
          pending_daily_contribution_amount: null,
          pending_daily_contribution_set_at: null,
          pending_daily_contribution_set_by: null
        })
        .eq("tenant_id", tenantId)
        .eq("id", customerId);
      if (error && !isMissingPendingDailyColumn(error.message)) {
        throw new Error(`Failed to clear scheduled daily Susu change: ${error.message}`);
      }
      return;
    }
    const customers = getTenantCustomers(tenantId);
    const idx = customers.findIndex((c) => c.id === customerId);
    if (idx >= 0) {
      customers[idx] = {
        ...customers[idx]!,
        pendingDailyContributionAmount: undefined,
        pendingDailyContributionSetAt: undefined
      };
      setTenantCustomers(tenantId, customers);
    }
  };

  if (payload.dailyContributionAmount === null) {
    await clearPendingInStore();
    const updated = (await getCustomerById(tenantId, customerId)) ?? existing;
    return {
      customer: updated,
      appliedImmediately: false,
      cancelled: true,
      effectiveCardNumber: nextCardNumber
    };
  }

  const nextAmount = Math.round(payload.dailyContributionAmount * 100) / 100;
  if (Math.abs(nextAmount - existing.dailyContributionAmount) < 0.005) {
    await clearPendingInStore();
    const updated = (await getCustomerById(tenantId, customerId)) ?? existing;
    return {
      customer: updated,
      appliedImmediately: false,
      cancelled: true,
      effectiveCardNumber: nextCardNumber
    };
  }

  if (hasContributionsOnOpenCard) {
    // Lock the current in-progress card's rate on a persisted cycle row if none exists yet
    // so historical Page #1 boxes never shift once the next card promotes the new rate.
    await lockCurrentOpenCycleRateIfNeeded({
      context: { userId: actorUserId, tenantId, role: "admin" },
      customerId,
      branchId: existing.homeBranchId,
      dailyContributionAmount: existing.dailyContributionAmount,
      activeCard: activeCard!
    });

    const now = new Date().toISOString();
    if (supabase) {
      const { error } = await supabase
        .from("customers")
        .update({
          pending_daily_contribution_amount: nextAmount,
          pending_daily_contribution_set_at: now,
          pending_daily_contribution_set_by: actorUserId
        })
        .eq("tenant_id", tenantId)
        .eq("id", customerId);
      if (error) {
        if (isMissingPendingDailyColumn(error.message)) {
          pendingDailyContributionFallback.set(pendingDailyKey(tenantId, customerId), {
            amount: nextAmount,
            setAt: now
          });
        } else {
          throw new Error(`Failed to schedule next-card daily Susu rate: ${error.message}`);
        }
      }
    } else {
      pendingDailyContributionFallback.set(pendingDailyKey(tenantId, customerId), {
        amount: nextAmount,
        setAt: now
      });
      const customers = getTenantCustomers(tenantId);
      const idx = customers.findIndex((c) => c.id === customerId);
      if (idx >= 0) {
        customers[idx] = {
          ...customers[idx]!,
          pendingDailyContributionAmount: nextAmount,
          pendingDailyContributionSetAt: now
        };
        setTenantCustomers(tenantId, customers);
      }
    }

    const updated = (await getCustomerById(tenantId, customerId)) ?? {
      ...existing,
      pendingDailyContributionAmount: nextAmount,
      pendingDailyContributionSetAt: now
    };
    return {
      customer: updated,
      appliedImmediately: false,
      cancelled: false,
      effectiveCardNumber: currentCardNumber + 1
    };
  }

  // No collections recorded on the active card yet (or previous card is already completed/closed):
  // apply immediately so the upcoming card opens at the new amount with zero conflict.
  await promotePendingDailyContributionToActive(tenantId, customerId, nextAmount);
  await updateEmptyOpenCycleDailyRate(tenantId, customerId, nextAmount);
  const updated = (await getCustomerById(tenantId, customerId)) ?? {
    ...existing,
    dailyContributionAmount: nextAmount,
    pendingDailyContributionAmount: undefined,
    pendingDailyContributionSetAt: undefined
  };
  return {
    customer: updated,
    appliedImmediately: true,
    cancelled: false,
    effectiveCardNumber: nextCardNumber
  };
}

/** Upgrade a Tier 1 Simplified KYC customer to Full KYC once they provide a valid national/foreign ID. */
export async function upgradeCustomerToFullKyc(
  tenantId: string,
  customerId: string,
  input: unknown
): Promise<Customer> {
  const payload = upgradeCustomerKycSchema.parse(input);
  const existing = await getCustomerById(tenantId, customerId);
  if (!existing) {
    throw new Error("Customer not found");
  }

  const now = new Date().toISOString();
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const updatePatch: Record<string, unknown> = {
      id_card_type: payload.idCardType,
      id_card_number: payload.idCardNumber.trim(),
      kyc_tier: "full",
      kyc_upgraded_at: now,
      ...(payload.idCardPhotoUrl ? { id_card_photo_url: payload.idCardPhotoUrl } : {})
    };
    let { error } = await supabase
      .from("customers")
      .update(updatePatch)
      .eq("tenant_id", tenantId)
      .eq("id", customerId);

    if (error && isMissingIdCardTypeColumn(error.message)) {
      const minimalPatch: Record<string, unknown> = {
        id_card_number: payload.idCardNumber.trim(),
        ...(payload.idCardPhotoUrl ? { id_card_photo_url: payload.idCardPhotoUrl } : {})
      };
      const retry = await supabase
        .from("customers")
        .update(minimalPatch)
        .eq("tenant_id", tenantId)
        .eq("id", customerId);
      error = retry.error;
      if (!error) {
        kycMetadataFallback.set(pendingDailyKey(tenantId, customerId), {
          idCardType: payload.idCardType,
          kycTier: "full",
          nationality: existing.nationality,
          kycIntroducer: existing.kycIntroducer,
          kycUpgradedAt: now
        });
      }
    }
    if (error) {
      throw new Error(`Failed to upgrade customer KYC: ${error.message}`);
    }
  } else {
    const customers = getTenantCustomers(tenantId);
    const idx = customers.findIndex((c) => c.id === customerId);
    if (idx >= 0) {
      customers[idx] = {
        ...customers[idx]!,
        idCardType: payload.idCardType,
        idCardNumber: payload.idCardNumber.trim(),
        kycTier: "full",
        kycUpgradedAt: now,
        ...(payload.idCardPhotoUrl ? { idCardPhotoUrl: payload.idCardPhotoUrl } : {})
      };
      setTenantCustomers(tenantId, customers);
    }
  }

  const updated = (await getCustomerById(tenantId, customerId)) ?? {
    ...existing,
    idCardType: payload.idCardType,
    idCardNumber: payload.idCardNumber.trim(),
    kycTier: "full" as const,
    kycUpgradedAt: now,
    ...(payload.idCardPhotoUrl ? { idCardPhotoUrl: payload.idCardPhotoUrl } : {})
  };
  return updated;
}

export { QUALIFYING_TX_TYPES };


