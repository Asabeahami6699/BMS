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
  updateCustomerStatusSchema,
  type AdminManagedCustomerStatus,
  type Customer,
  type CustomerRegistrationInput,
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
    idCardNumber: row.id_card_number ? String(row.id_card_number) : undefined,
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

    lockedBalance:
      row.locked_balance != null ? Number(row.locked_balance) : undefined,

    routeId: row.route_id ? String(row.route_id) : undefined,

    status: row.status

  });

}



function insertRowFromCustomer(customer: Customer): Record<string, unknown> {

  return {

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
    id_card_number: customer.idCardNumber ?? null,
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
  let loanReserve = 0;
  if (!options?.allowLoanReserve) {
    try {
      const { getCustomerLoanInstallmentReserve } = await import("./loanReserveService.js");
      loanReserve = await getCustomerLoanInstallmentReserve(tenantId, customerId);
    } catch {
      loanReserve = 0;
    }
  }
  return Math.max(0, total - locked - loanReserve);
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

    const { error } = await supabase.from("customers").insert(insertRowFromCustomer(nextCustomer));

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
    const { error } = await supabase.from("customers").insert(insertRowFromCustomer(nextCustomer));
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

  input: unknown

): Promise<Customer> {

  const payload = customerRegistrationInputSchema.parse(input) as CustomerRegistrationInput;
  const formSetup = await getRegistrationFormSetup(tenantId);
  const formIssue = registrationFormIssue(payload, formSetup);
  if (formIssue) {
    throw new Error(formIssue);
  }
  const normalized = registrationPayloadForSetup(payload, formSetup);
  const homeBranchId = await resolveHomeBranchId(
    tenantId,
    agentBranchId,
    payload.homeBranchId
  );

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
    idCardNumber: normalized.idCardNumber,
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



  const supabase = getSupabaseAdminClient();

  if (supabase) {

    const { error } = await supabase.from("customers").insert(insertRowFromCustomer(nextCustomer));

    if (error) {

      throw new Error(`Failed to submit registration: ${error.message}`);

    }

  } else {

    const customers = getTenantCustomers(tenantId);

    setTenantCustomers(tenantId, [...customers, nextCustomer]);

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
        loanReserveAmount: loanReserveAmount > 0 ? loanReserveAmount : undefined,
        withdrawableBalance: Math.max(0, accountBalance - locked - loanReserveAmount)
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
  "id_card_number",
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
  "locked_balance",
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

  let query = supabase
    .from("customers")
    .select(options?.light ? LIGHT_CUSTOMER_COLUMNS : "*")
    .eq("tenant_id", tenantId);

  if (options?.agentId) {

    query = query.or(

      `created_by_field_agent_id.eq.${options.agentId},assigned_field_agent_id.eq.${options.agentId}`

    );

  }

  if (branchId) {
    query = query.eq("home_branch_id", branchId);
  }

  if (options?.status) {

    query = query.eq("status", options.status);

  }

  const { data, error } = await query.order("created_at", { ascending: false });

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

export async function assignCustomerFieldAgent(
  tenantId: string,
  customerId: string,
  input: unknown
): Promise<Customer> {
  const { assignedFieldAgentId } = assignCustomerFieldAgentSchema.parse(input);

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

  const updated = customerSchema.parse({
    ...customer,
    assignedFieldAgentId: assignedFieldAgentId ?? undefined
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("customers")
      .update({ assigned_field_agent_id: assignedFieldAgentId })
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

  const { error: ledgerError } = await supabase
    .from("ledger_entries")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
  if (ledgerError) {
    throw new Error(`Failed to clear ledger: ${ledgerError.message}`);
  }

  const { error: txError } = await supabase
    .from("customer_transactions")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
  if (txError) {
    throw new Error(`Failed to clear transactions: ${txError.message}`);
  }

  await supabase
    .from("field_agent_collection_batch_lines")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);

  await supabase
    .from("customer_balance_disclosures")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("customer_id", customerId);
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

export { QUALIFYING_TX_TYPES };


