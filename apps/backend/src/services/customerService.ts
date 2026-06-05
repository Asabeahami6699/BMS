import {
  assignCustomerFieldAgentSchema,
  createCustomerInputSchema,
  customerRegistrationInputSchema,
  customerSchema,
  rejectCustomerSchema,
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
  customerId: string
): Promise<number> {
  const customer = await getCustomerById(tenantId, customerId);
  if (!customer) {
    throw new Error("Customer not found");
  }
  const total = await computeCustomerBalance(tenantId, customerId);
  const locked = customer.lockedBalance ?? 0;
  return Math.max(0, total - locked);
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



export async function submitCustomerRegistration(

  tenantId: string,

  agentUserId: string,

  agentBranchId: string | undefined,

  input: unknown

): Promise<Customer> {

  const payload = customerRegistrationInputSchema.parse(input) as CustomerRegistrationInput;
  const homeBranchId = await resolveHomeBranchId(
    tenantId,
    agentBranchId,
    payload.homeBranchId
  );

  const nextCustomer: Customer = customerSchema.parse({

    id: randomUUID(),

    tenantId,

    fullName: payload.fullName,

    email: payload.email || undefined,

    phone: payload.phone,

    location: payload.location,
    houseNumber: payload.houseNumber,
    accountType: payload.accountType,
    idCardNumber: payload.idCardNumber,
    photoUrl: payload.photoUrl,
    idCardPhotoUrl: payload.idCardPhotoUrl,
    savingsOpeningFeeCollected:
      payload.accountType === "savings" ? Boolean(payload.savingsOpeningFeeCollected) : false,
    savingsOpeningFeeRecovered: 0,
    nextOfKin: payload.nextOfKin,
    homeBranchId,

    assignedFieldAgentId: payload.assignedFieldAgentId ?? agentUserId,

    createdByFieldAgentId: agentUserId,

    dailyContributionAmount: payload.dailyContributionAmount ?? 0,

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

        rejection_reason: null

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

  return customers.map((customer) => {
    if (customer.status !== "active") {
      return customer;
    }
    const accountBalance = totals.get(customer.id) ?? 0;
    const locked = customer.lockedBalance ?? 0;
    return customerSchema.parse({
      ...customer,
      accountBalance,
      withdrawableBalance: Math.max(0, accountBalance - locked)
    });
  });
}

export async function listCustomers(tenantId: string, options?: { agentId?: string; status?: string }): Promise<Customer[]> {

  const supabase = getSupabaseAdminClient();

  if (!supabase) {

    let rows = getTenantCustomers(tenantId);

    if (options?.agentId) {

      rows = rows.filter((c) => c.createdByFieldAgentId === options.agentId || c.assignedFieldAgentId === options.agentId);

    }

    if (options?.status) {

      rows = rows.filter((c) => c.status === options.status);

    }

    const named = await enrichCustomersWithAgentNames(tenantId, rows);
    if (options?.agentId) {
      return named;
    }
    return enrichCustomersWithAccountBalances(tenantId, named);

  }



  let query = supabase.from("customers").select("*").eq("tenant_id", tenantId);

  if (options?.agentId) {

    query = query.or(

      `created_by_field_agent_id.eq.${options.agentId},assigned_field_agent_id.eq.${options.agentId}`

    );

  }

  if (options?.status) {

    query = query.eq("status", options.status);

  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) {

    throw new Error(`Failed to list customers: ${error.message}`);

  }



  const customers = (data ?? []).map((row) => mapCustomerRow(row as Record<string, unknown>));
  const named = await enrichCustomersWithAgentNames(tenantId, customers);
  if (options?.agentId) {
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

    return getTenantCustomers(tenantId).find((customer) => customer.id === customerId);

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



  return enrichCustomerWithAgentNames(
    tenantId,
    mapCustomerRow(data as Record<string, unknown>)
  );

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


