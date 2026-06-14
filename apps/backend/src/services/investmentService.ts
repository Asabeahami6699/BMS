import type {
  InvestmentAttachment,
  InvestmentAuditEvent,
  InvestmentBeneficiary,
  InvestmentFormConfig,
  InvestmentProduct,
  InvestmentRecord,
  InvestmentSummary
} from "@bms/shared";
import {
  buildDefaultInvestmentFormConfig,
  computeInvestmentFigures,
  createInvestmentApplicationSchema,
  createInvestmentProductSchema,
  investmentAttachmentSchema,
  investmentAuditEventSchema,
  investmentBeneficiarySchema,
  investmentFormConfigSchema,
  investmentProductSchema,
  investmentRecordSchema,
  investmentSearchSchema,
  investmentSummarySchema,
  normalizeInvestmentProductInput,
  updateInvestmentApplicationSchema,
  updateInvestmentFormConfigSchema,
  updateInvestmentProductSchema
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { isMissingSupabaseResource } from "../lib/supabaseSchema.js";
import { listBranches } from "./branchService.js";
import { fetchUserNameMap } from "./userNameResolver.js";

type ActorContext = {
  tenantId: string;
  userId: string;
  role: string;
  branchId?: string;
};

type MemoryStore = {
  products: InvestmentProduct[];
  investments: InvestmentRecord[];
  beneficiariesByInvestmentId: Map<string, InvestmentBeneficiary[]>;
  attachments: InvestmentAttachment[];
  audit: InvestmentAuditEvent[];
  formConfig: InvestmentFormConfig | null;
  seq: number;
};

const memory = new Map<string, MemoryStore>();

function ensureMemory(tenantId: string): MemoryStore {
  let store = memory.get(tenantId);
  if (!store) {
    store = {
      products: [],
      investments: [],
      beneficiariesByInvestmentId: new Map(),
      attachments: [],
      audit: [],
      formConfig: null,
      seq: 0
    };
    memory.set(tenantId, store);
  }
  return store;
}

function nextInvestmentNumber(tenantId: string, store?: MemoryStore): string {
  const year = new Date().getFullYear();
  if (store) {
    store.seq += 1;
    return `INV-${year}-${String(store.seq).padStart(5, "0")}`;
  }
  return `INV-${year}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

async function branchNameMap(tenantId: string): Promise<Map<string, string>> {
  const branches = await listBranches(tenantId);
  return new Map(branches.map((b) => [b.id, b.name]));
}

function rowToProduct(row: Record<string, unknown>): InvestmentProduct {
  const rawTiers = row.rate_tiers;
  const rateTiers = Array.isArray(rawTiers)
    ? rawTiers.map((tier, index) => {
        const t = tier as Record<string, unknown>;
        return {
          id: t.id != null ? String(t.id) : undefined,
          label: t.label != null ? String(t.label) : undefined,
          tenureDays: Number(t.tenureDays ?? t.tenure_days ?? 0),
          ratePercent: Number(t.ratePercent ?? t.rate_percent ?? 0),
          sortOrder: t.sortOrder != null ? Number(t.sortOrder) : index
        };
      })
    : [];
  return investmentProductSchema.parse({
    id: String(row.id),
    tenantId: String(row.tenant_id),
    productType: row.product_type,
    name: String(row.name),
    description: row.description != null ? String(row.description) : undefined,
    defaultRatePercent: Number(row.default_rate_percent ?? 0),
    defaultTenureDays: Number(row.default_tenure_days ?? 0),
    rateTiers,
    minAmount: Number(row.min_amount ?? 0),
    maxAmount: Number(row.max_amount ?? 0),
    status: row.status === "inactive" ? "inactive" : "active",
    createdAt: row.created_at != null ? String(row.created_at) : undefined
  });
}

function attachRelated(
  record: InvestmentRecord,
  beneficiaries: InvestmentBeneficiary[],
  attachments: InvestmentAttachment[]
): InvestmentRecord {
  return investmentRecordSchema.parse({
    ...record,
    beneficiaries,
    attachments
  });
}

function rowToInvestment(
  row: Record<string, unknown>,
  beneficiaries: InvestmentBeneficiary[] = [],
  attachments: InvestmentAttachment[] = []
): InvestmentRecord {
  return attachRelated(
    investmentRecordSchema.parse({
      id: String(row.id),
      tenantId: String(row.tenant_id),
      investmentNumber: String(row.investment_number),
      productId: row.product_id != null ? String(row.product_id) : undefined,
      productType: row.product_type,
      productName: String(row.product_name),
      branchId: String(row.branch_id),
      officerUserId: row.officer_user_id != null ? String(row.officer_user_id) : undefined,
      customerId: row.customer_id != null ? String(row.customer_id) : undefined,
      customerName: String(row.customer_name),
      customerPhone: row.customer_phone != null ? String(row.customer_phone) : undefined,
      customerSnapshot: (row.customer_snapshot as Record<string, unknown>) ?? {},
      customFields: (row.custom_fields as Record<string, unknown>) ?? {},
      principalAmount: Number(row.principal_amount ?? 0),
      interestRatePercent: Number(row.interest_rate_percent ?? 0),
      tenureDays: Number(row.tenure_days ?? 0),
      startDate: String(row.start_date).slice(0, 10),
      maturityDate: String(row.maturity_date).slice(0, 10),
      expectedInterest: Number(row.expected_interest ?? 0),
      expectedMaturityValue: Number(row.expected_maturity_value ?? 0),
      autoRenewal: row.auto_renewal ?? "none",
      status: row.status,
      parentInvestmentId:
        row.parent_investment_id != null ? String(row.parent_investment_id) : undefined,
      renewalCycle: Number(row.renewal_cycle ?? 1),
      createdBy: String(row.created_by),
      modifiedBy: row.modified_by != null ? String(row.modified_by) : undefined,
      approvedBy: row.approved_by != null ? String(row.approved_by) : undefined,
      createdAt: row.created_at != null ? String(row.created_at) : undefined,
      updatedAt: row.updated_at != null ? String(row.updated_at) : undefined,
      approvedAt: row.approved_at != null ? String(row.approved_at) : undefined
    }),
    beneficiaries,
    attachments
  );
}

function computeSummary(investments: InvestmentRecord[]): InvestmentSummary {
  const active = investments.filter((i) => i.status === "active");
  const matured = investments.filter((i) => i.status === "matured");
  const redeemed = investments.filter((i) => i.status === "redeemed");
  const autoRenewed = investments.filter((i) => (i.renewalCycle ?? 1) > 1);
  const byProductType: Record<string, number> = {};
  const byBranch: Record<string, number> = {};
  for (const row of active) {
    byProductType[row.productType] = (byProductType[row.productType] ?? 0) + 1;
    byBranch[row.branchId] = (byBranch[row.branchId] ?? 0) + 1;
  }
  return investmentSummarySchema.parse({
    active: active.length,
    matured: matured.length,
    redeemed: redeemed.length,
    autoRenewed: autoRenewed.length,
    totalPrincipal: active.reduce((sum, i) => sum + i.principalAmount, 0),
    totalExpectedInterest: active.reduce((sum, i) => sum + i.expectedInterest, 0),
    byProductType,
    byBranch
  });
}

async function appendAudit(
  tenantId: string,
  investmentId: string,
  action: string,
  actor: ActorContext,
  changes?: Record<string, unknown>
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const event = investmentAuditEventSchema.parse({
    id: randomUUID(),
    tenantId,
    investmentId,
    action,
    actorUserId: actor.userId,
    actorRole: actor.role,
    changes,
    createdAt: new Date().toISOString()
  });
  if (supabase) {
    const { error } = await supabase.from("investment_audit_log").insert({
      id: event.id,
      tenant_id: tenantId,
      investment_id: investmentId,
      action,
      actor_user_id: actor.userId,
      actor_role: actor.role,
      changes: changes ?? null
    });
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to write investment audit: ${error.message}`);
    }
    return;
  }
  const store = ensureMemory(tenantId);
  store.audit.unshift(event);
}

export async function getInvestmentFormConfig(tenantId: string): Promise<InvestmentFormConfig> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("investment_form_configs")
      .select("tenant_id, sections, fields, updated_at, updated_by")
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to load investment form config: ${error.message}`);
    }
    if (data) {
      return investmentFormConfigSchema.parse({
        tenantId,
        sections: data.sections ?? [],
        fields: data.fields ?? [],
        updatedAt: data.updated_at != null ? String(data.updated_at) : undefined,
        updatedBy: data.updated_by != null ? String(data.updated_by) : undefined
      });
    }
  } else {
    const store = ensureMemory(tenantId);
    if (store.formConfig) {
      return store.formConfig;
    }
  }
  return buildDefaultInvestmentFormConfig(tenantId);
}

export async function updateInvestmentFormConfig(
  tenantId: string,
  actor: ActorContext,
  raw: unknown
): Promise<InvestmentFormConfig> {
  const parsed = updateInvestmentFormConfigSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid form configuration");
  }
  const now = new Date().toISOString();
  const config = investmentFormConfigSchema.parse({
    tenantId,
    sections: parsed.data.sections,
    fields: parsed.data.fields,
    updatedAt: now,
    updatedBy: actor.userId
  });
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("investment_form_configs").upsert({
      tenant_id: tenantId,
      sections: config.sections,
      fields: config.fields,
      updated_at: now,
      updated_by: actor.userId
    });
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to save investment form config: ${error.message}`);
    }
  } else {
    ensureMemory(tenantId).formConfig = config;
  }
  return config;
}

export async function listInvestmentProducts(tenantId: string): Promise<InvestmentProduct[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("investment_products")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("name");
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to list investment products: ${error.message}`);
    }
    return (data ?? []).map((row) => rowToProduct(row as Record<string, unknown>));
  }
  return ensureMemory(tenantId).products;
}

export async function createInvestmentProduct(tenantId: string, raw: unknown): Promise<InvestmentProduct> {
  const parsed = createInvestmentProductSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid investment product");
  }
  const normalized = normalizeInvestmentProductInput(parsed.data);
  const product = investmentProductSchema.parse({
    id: randomUUID(),
    tenantId,
    ...normalized,
    status: normalized.status ?? "active",
    createdAt: new Date().toISOString()
  });
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("investment_products").insert({
      id: product.id,
      tenant_id: tenantId,
      product_type: product.productType,
      name: product.name,
      description: product.description ?? null,
      default_rate_percent: product.defaultRatePercent,
      default_tenure_days: product.defaultTenureDays,
      rate_tiers: product.rateTiers ?? [],
      min_amount: product.minAmount,
      max_amount: product.maxAmount,
      status: product.status
    });
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to create investment product: ${error.message}`);
    }
  } else {
    ensureMemory(tenantId).products.push(product);
  }
  return product;
}

export async function updateInvestmentProduct(
  tenantId: string,
  productId: string,
  raw: unknown
): Promise<InvestmentProduct> {
  const parsed = updateInvestmentProductSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid investment product update");
  }
  const products = await listInvestmentProducts(tenantId);
  const existing = products.find((p) => p.id === productId);
  if (!existing) {
    throw new Error("Investment product not found");
  }
  const updated = investmentProductSchema.parse({
    ...existing,
    ...normalizeInvestmentProductInput({ ...existing, ...parsed.data })
  });
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("investment_products")
      .update({
        product_type: updated.productType,
        name: updated.name,
        description: updated.description ?? null,
        default_rate_percent: updated.defaultRatePercent,
        default_tenure_days: updated.defaultTenureDays,
        rate_tiers: updated.rateTiers ?? [],
        min_amount: updated.minAmount,
        max_amount: updated.maxAmount,
        status: updated.status,
        updated_at: new Date().toISOString()
      })
      .eq("id", productId)
      .eq("tenant_id", tenantId);
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to update investment product: ${error.message}`);
    }
  } else {
    const store = ensureMemory(tenantId);
    store.products = store.products.map((p) => (p.id === productId ? updated : p));
  }
  return updated;
}

async function loadBeneficiaries(
  tenantId: string,
  investmentId: string
): Promise<InvestmentBeneficiary[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("investment_beneficiaries")
      .select("*")
      .eq("investment_id", investmentId)
      .eq("tenant_id", tenantId);
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to load beneficiaries: ${error.message}`);
    }
    return (data ?? []).map((row) =>
      investmentBeneficiarySchema.parse({
        id: String(row.id),
        name: String(row.name),
        relationship: String(row.relationship),
        phone: row.phone != null ? String(row.phone) : undefined,
        altPhone: row.alt_phone != null ? String(row.alt_phone) : undefined,
        email: row.email != null ? String(row.email) : undefined,
        address: row.address != null ? String(row.address) : undefined,
        allocationPercent: Number(row.allocation_percent ?? 0)
      })
    );
  }
  return ensureMemory(tenantId).beneficiariesByInvestmentId.get(investmentId) ?? [];
}

async function loadAttachments(tenantId: string, investmentId: string): Promise<InvestmentAttachment[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("investment_attachments")
      .select("*")
      .eq("investment_id", investmentId)
      .eq("tenant_id", tenantId);
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to load attachments: ${error.message}`);
    }
    return (data ?? []).map((row) =>
      investmentAttachmentSchema.parse({
        id: String(row.id),
        investmentId,
        tenantId,
        kind: row.kind,
        fileName: String(row.file_name),
        mimeType: row.mime_type != null ? String(row.mime_type) : undefined,
        contentUrl: row.content_url != null ? String(row.content_url) : undefined,
        uploadedBy: String(row.uploaded_by),
        createdAt: row.created_at != null ? String(row.created_at) : undefined
      })
    );
  }
  return ensureMemory(tenantId).attachments.filter((a) => a.investmentId === investmentId);
}

export async function listInvestments(
  tenantId: string,
  rawQuery?: unknown,
  branchFilter?: string | null
): Promise<InvestmentRecord[]> {
  const query = investmentSearchSchema.safeParse(rawQuery ?? {}).data ?? {};
  const supabase = getSupabaseAdminClient();
  let rows: InvestmentRecord[] = [];
  if (supabase) {
    let builder = supabase.from("investments").select("*").eq("tenant_id", tenantId);
    if (branchFilter) {
      builder = builder.eq("branch_id", branchFilter);
    }
    if (query.status) {
      builder = builder.eq("status", query.status);
    }
    if (query.productType) {
      builder = builder.eq("product_type", query.productType);
    }
    if (query.branchId) {
      builder = builder.eq("branch_id", query.branchId);
    }
    if (query.officerUserId) {
      builder = builder.eq("officer_user_id", query.officerUserId);
    }
    const { data, error } = await builder.order("created_at", { ascending: false });
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to list investments: ${error.message}`);
    }
    const branchNames = await branchNameMap(tenantId);
    rows = await Promise.all(
      (data ?? []).map(async (row) => {
        const id = String(row.id);
        const beneficiaries = await loadBeneficiaries(tenantId, id);
        const attachments = await loadAttachments(tenantId, id);
        const record = rowToInvestment(row as Record<string, unknown>, beneficiaries, attachments);
        return {
          ...record,
          branchName: branchNames.get(record.branchId)
        };
      })
    );
  } else {
    const store = ensureMemory(tenantId);
    rows = store.investments.filter((row) => !branchFilter || row.branchId === branchFilter);
  }

  const q = query.q?.trim().toLowerCase();
  if (!q) {
    return rows;
  }
  return rows.filter(
    (row) =>
      row.customerName.toLowerCase().includes(q) ||
      (row.customerPhone ?? "").toLowerCase().includes(q) ||
      row.investmentNumber.toLowerCase().includes(q) ||
      row.productName.toLowerCase().includes(q)
  );
}

export async function getInvestmentDetail(
  tenantId: string,
  investmentId: string
): Promise<InvestmentRecord | null> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("investments")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", investmentId)
      .maybeSingle();
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to load investment: ${error.message}`);
    }
    if (!data) {
      return null;
    }
    const beneficiaries = await loadBeneficiaries(tenantId, investmentId);
    const attachments = await loadAttachments(tenantId, investmentId);
    const branchNames = await branchNameMap(tenantId);
    const record = rowToInvestment(data as Record<string, unknown>, beneficiaries, attachments);
    return { ...record, branchName: branchNames.get(record.branchId) };
  }
  const store = ensureMemory(tenantId);
  const row = store.investments.find((i) => i.id === investmentId);
  return row ?? null;
}

async function saveBeneficiaries(
  tenantId: string,
  investmentId: string,
  rows: InvestmentBeneficiary[]
): Promise<InvestmentBeneficiary[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    await supabase.from("investment_beneficiaries").delete().eq("investment_id", investmentId);
    if (rows.length) {
      const { error } = await supabase.from("investment_beneficiaries").insert(
        rows.map((b) => ({
          id: randomUUID(),
          tenant_id: tenantId,
          investment_id: investmentId,
          name: b.name,
          relationship: b.relationship,
          phone: b.phone ?? null,
          alt_phone: b.altPhone ?? null,
          email: b.email ?? null,
          address: b.address ?? null,
          allocation_percent: b.allocationPercent
        }))
      );
      if (error && !isMissingSupabaseResource(error.message)) {
        throw new Error(`Failed to save beneficiaries: ${error.message}`);
      }
    }
    return loadBeneficiaries(tenantId, investmentId);
  }
  const store = ensureMemory(tenantId);
  const saved = rows.map((b) => ({ ...b, id: randomUUID() }));
  store.beneficiariesByInvestmentId.set(investmentId, saved);
  return saved;
}

async function saveAttachments(
  tenantId: string,
  investmentId: string,
  actorUserId: string,
  rows: Array<{
    kind: InvestmentAttachment["kind"];
    fileName: string;
    mimeType?: string;
    contentUrl?: string;
  }>
): Promise<InvestmentAttachment[]> {
  if (!rows.length) {
    return loadAttachments(tenantId, investmentId);
  }
  const supabase = getSupabaseAdminClient();
  const payload = rows.map((row) => ({
    id: randomUUID(),
    tenant_id: tenantId,
    investment_id: investmentId,
    kind: row.kind,
    file_name: row.fileName,
    mime_type: row.mimeType ?? null,
    content_url: row.contentUrl ?? null,
    uploaded_by: actorUserId
  }));
  if (supabase) {
    const { error } = await supabase.from("investment_attachments").insert(payload);
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to save attachments: ${error.message}`);
    }
    return loadAttachments(tenantId, investmentId);
  }
  const store = ensureMemory(tenantId);
  const saved = payload.map((row) =>
    investmentAttachmentSchema.parse({
      id: row.id,
      investmentId,
      tenantId,
      kind: row.kind,
      fileName: row.file_name,
      mimeType: row.mime_type ?? undefined,
      contentUrl: row.content_url ?? undefined,
      uploadedBy: actorUserId,
      createdAt: new Date().toISOString()
    })
  );
  store.attachments.push(...saved);
  return saved;
}

export async function createInvestmentApplication(
  actor: ActorContext,
  raw: unknown
): Promise<InvestmentRecord> {
  const parsed = createInvestmentApplicationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid investment application");
  }
  const figures = computeInvestmentFigures({
    principalAmount: parsed.data.principalAmount,
    interestRatePercent: parsed.data.interestRatePercent,
    tenureDays: parsed.data.tenureDays,
    startDate: parsed.data.startDate
  });
  const store = ensureMemory(actor.tenantId);
  const id = randomUUID();
  const investmentNumber = nextInvestmentNumber(actor.tenantId, getSupabaseAdminClient() ? undefined : store);
  const now = new Date().toISOString();
  const record = investmentRecordSchema.parse({
    id,
    tenantId: actor.tenantId,
    investmentNumber,
    productId: parsed.data.productId,
    productType: parsed.data.productType,
    productName: parsed.data.productName,
    branchId: parsed.data.branchId,
    officerUserId: parsed.data.officerUserId ?? actor.userId,
    customerId: parsed.data.customerId,
    customerName: parsed.data.customerName,
    customerPhone: parsed.data.customerPhone,
    customerSnapshot: parsed.data.customerSnapshot,
    customFields: parsed.data.customFields ?? {},
    principalAmount: parsed.data.principalAmount,
    interestRatePercent: parsed.data.interestRatePercent,
    tenureDays: parsed.data.tenureDays,
    startDate: parsed.data.startDate,
    maturityDate: figures.maturityDate,
    expectedInterest: figures.expectedInterest,
    expectedMaturityValue: figures.expectedMaturityValue,
    autoRenewal: parsed.data.autoRenewal ?? "none",
    status: "active",
    renewalCycle: 1,
    beneficiaries: parsed.data.beneficiaries ?? [],
    attachments: [],
    createdBy: actor.userId,
    createdAt: now,
    updatedAt: now
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("investments").insert({
      id: record.id,
      tenant_id: actor.tenantId,
      investment_number: record.investmentNumber,
      product_id: record.productId ?? null,
      product_type: record.productType,
      product_name: record.productName,
      branch_id: record.branchId,
      officer_user_id: record.officerUserId ?? null,
      customer_id: record.customerId ?? null,
      customer_name: record.customerName,
      customer_phone: record.customerPhone ?? null,
      customer_snapshot: record.customerSnapshot,
      custom_fields: record.customFields,
      principal_amount: record.principalAmount,
      interest_rate_percent: record.interestRatePercent,
      tenure_days: record.tenureDays,
      start_date: record.startDate,
      maturity_date: record.maturityDate,
      expected_interest: record.expectedInterest,
      expected_maturity_value: record.expectedMaturityValue,
      auto_renewal: record.autoRenewal,
      status: record.status,
      renewal_cycle: record.renewalCycle,
      created_by: actor.userId
    });
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to create investment: ${error.message}`);
    }
  } else {
    store.investments.unshift(record);
  }

  const beneficiaries = await saveBeneficiaries(
    actor.tenantId,
    id,
    parsed.data.beneficiaries ?? []
  );
  const attachments = await saveAttachments(
    actor.tenantId,
    id,
    actor.userId,
    parsed.data.attachments ?? []
  );
  await appendAudit(actor.tenantId, id, "created", actor, { status: "active" });
  return attachRelated(record, beneficiaries, attachments);
}

export async function updateInvestmentApplication(
  actor: ActorContext,
  investmentId: string,
  raw: unknown
): Promise<InvestmentRecord> {
  const existing = await getInvestmentDetail(actor.tenantId, investmentId);
  if (!existing) {
    throw new Error("Investment not found");
  }
  const parsed = updateInvestmentApplicationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid investment update");
  }
  const principalAmount = parsed.data.principalAmount ?? existing.principalAmount;
  const interestRatePercent = parsed.data.interestRatePercent ?? existing.interestRatePercent;
  const tenureDays = parsed.data.tenureDays ?? existing.tenureDays;
  const startDate = parsed.data.startDate ?? existing.startDate;
  const figures = computeInvestmentFigures({ principalAmount, interestRatePercent, tenureDays, startDate });
  const updated = investmentRecordSchema.parse({
    ...existing,
    ...parsed.data,
    principalAmount,
    interestRatePercent,
    tenureDays,
    startDate,
    maturityDate: figures.maturityDate,
    expectedInterest: figures.expectedInterest,
    expectedMaturityValue: figures.expectedMaturityValue,
    modifiedBy: actor.userId,
    updatedAt: new Date().toISOString()
  });

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("investments")
      .update({
        product_id: updated.productId ?? null,
        product_type: updated.productType,
        product_name: updated.productName,
        branch_id: updated.branchId,
        officer_user_id: updated.officerUserId ?? null,
        customer_id: updated.customerId ?? null,
        customer_name: updated.customerName,
        customer_phone: updated.customerPhone ?? null,
        customer_snapshot: updated.customerSnapshot,
        custom_fields: updated.customFields,
        principal_amount: updated.principalAmount,
        interest_rate_percent: updated.interestRatePercent,
        tenure_days: updated.tenureDays,
        start_date: updated.startDate,
        maturity_date: updated.maturityDate,
        expected_interest: updated.expectedInterest,
        expected_maturity_value: updated.expectedMaturityValue,
        auto_renewal: updated.autoRenewal,
        modified_by: actor.userId,
        updated_at: updated.updatedAt
      })
      .eq("id", investmentId)
      .eq("tenant_id", actor.tenantId);
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to update investment: ${error.message}`);
    }
  } else {
    const store = ensureMemory(actor.tenantId);
    store.investments = store.investments.map((row) => (row.id === investmentId ? updated : row));
  }

  if (parsed.data.beneficiaries) {
    updated.beneficiaries = await saveBeneficiaries(
      actor.tenantId,
      investmentId,
      parsed.data.beneficiaries
    );
  }
  if (parsed.data.attachments) {
    updated.attachments = await saveAttachments(
      actor.tenantId,
      investmentId,
      actor.userId,
      parsed.data.attachments
    );
  }
  await appendAudit(actor.tenantId, investmentId, "updated", actor);
  return updated;
}

export async function setInvestmentStatus(
  actor: ActorContext,
  investmentId: string,
  status: InvestmentRecord["status"],
  action: string
): Promise<InvestmentRecord> {
  const existing = await getInvestmentDetail(actor.tenantId, investmentId);
  if (!existing) {
    throw new Error("Investment not found");
  }
  const now = new Date().toISOString();
  const updated = { ...existing, status, modifiedBy: actor.userId, updatedAt: now };
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase
      .from("investments")
      .update({
        status,
        modified_by: actor.userId,
        updated_at: now,
        approved_by: status === "active" ? actor.userId : existing.approvedBy ?? null,
        approved_at: status === "active" ? now : existing.approvedAt ?? null
      })
      .eq("id", investmentId)
      .eq("tenant_id", actor.tenantId);
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to update investment status: ${error.message}`);
    }
  } else {
    const store = ensureMemory(actor.tenantId);
    store.investments = store.investments.map((row) =>
      row.id === investmentId ? { ...row, ...updated } : row
    );
  }
  await appendAudit(actor.tenantId, investmentId, action, actor, { status });
  return updated;
}

export async function processMaturedInvestments(actor: ActorContext): Promise<InvestmentRecord[]> {
  const today = new Date().toISOString().slice(0, 10);
  const investments = await listInvestments(actor.tenantId);
  const renewed: InvestmentRecord[] = [];
  for (const row of investments) {
    if (row.status !== "active" || row.maturityDate > today) {
      continue;
    }
    await setInvestmentStatus(actor, row.id, "matured", "matured");
    if (row.autoRenewal === "none") {
      continue;
    }
    const principal =
      row.autoRenewal === "principal_and_interest"
        ? row.expectedMaturityValue
        : row.principalAmount;
    const child = await createInvestmentApplication(actor, {
      productId: row.productId,
      productType: row.productType,
      productName: row.productName,
      branchId: row.branchId,
      officerUserId: row.officerUserId,
      customerId: row.customerId,
      customerName: row.customerName,
      customerPhone: row.customerPhone,
      customerSnapshot: row.customerSnapshot,
      customFields: row.customFields,
      principalAmount: principal,
      interestRatePercent: row.interestRatePercent,
      tenureDays: row.tenureDays,
      startDate: today,
      autoRenewal: row.autoRenewal,
      beneficiaries: row.beneficiaries
    });
    const supabase = getSupabaseAdminClient();
    const patch = {
      parentInvestmentId: row.id,
      renewalCycle: (row.renewalCycle ?? 1) + 1
    };
    if (supabase) {
      await supabase
        .from("investments")
        .update({
          parent_investment_id: patch.parentInvestmentId,
          renewal_cycle: patch.renewalCycle
        })
        .eq("id", child.id)
        .eq("tenant_id", actor.tenantId);
    } else {
      const store = ensureMemory(actor.tenantId);
      store.investments = store.investments.map((i) =>
        i.id === child.id ? { ...i, ...patch } : i
      );
    }
    renewed.push({ ...child, ...patch });
    await appendAudit(actor.tenantId, row.id, "auto_renewed", actor, {
      childInvestmentId: child.id
    });
  }
  return renewed;
}

export async function listInvestmentAudit(
  tenantId: string,
  investmentId: string
): Promise<InvestmentAuditEvent[]> {
  const supabase = getSupabaseAdminClient();
  let events: InvestmentAuditEvent[] = [];
  if (supabase) {
    const { data, error } = await supabase
      .from("investment_audit_log")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("investment_id", investmentId)
      .order("created_at", { ascending: false });
    if (error && !isMissingSupabaseResource(error.message)) {
      throw new Error(`Failed to load investment audit: ${error.message}`);
    }
    events = (data ?? []).map((row) =>
      investmentAuditEventSchema.parse({
        id: String(row.id),
        tenantId,
        investmentId,
        action: String(row.action),
        actorUserId: String(row.actor_user_id),
        actorRole: row.actor_role != null ? String(row.actor_role) : undefined,
        changes: (row.changes as Record<string, unknown>) ?? undefined,
        createdAt: String(row.created_at)
      })
    );
  } else {
    events = ensureMemory(tenantId).audit.filter((e) => e.investmentId === investmentId);
  }
  const nameMap = await fetchUserNameMap(
    tenantId,
    events.map((event) => event.actorUserId)
  );
  return events.map((event) => ({
    ...event,
    actorName: nameMap.get(event.actorUserId) ?? event.actorUserId
  }));
}

export async function getInvestmentsBootstrap(
  tenantId: string,
  branchFilter?: string | null
): Promise<{
  products: InvestmentProduct[];
  investments: InvestmentRecord[];
  formConfig: InvestmentFormConfig;
  summary: InvestmentSummary;
}> {
  const [products, investments, formConfig] = await Promise.all([
    listInvestmentProducts(tenantId),
    listInvestments(tenantId, undefined, branchFilter),
    getInvestmentFormConfig(tenantId)
  ]);
  return {
    products,
    investments,
    formConfig,
    summary: computeSummary(investments)
  };
}

export async function getInvestmentReports(
  tenantId: string,
  branchFilter?: string | null
): Promise<{
  summary: InvestmentSummary;
  active: InvestmentRecord[];
  matured: InvestmentRecord[];
  redeemed: InvestmentRecord[];
  autoRenewed: InvestmentRecord[];
}> {
  const investments = await listInvestments(tenantId, undefined, branchFilter);
  return {
    summary: computeSummary(investments),
    active: investments.filter((i) => i.status === "active"),
    matured: investments.filter((i) => i.status === "matured"),
    redeemed: investments.filter((i) => i.status === "redeemed"),
    autoRenewed: investments.filter((i) => (i.renewalCycle ?? 1) > 1)
  };
}
