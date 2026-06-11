import {
  companyAnnouncementSchema,
  companyDocumentSchema,
  createAnnouncementSchema,
  createDocumentSchema,
  createIncidentSchema,
  createStaffLoanSchema,
  hrStaffLoanSchema,
  incidentReportSchema,
  universalOpsSummarySchema,
  type CompanyAnnouncement,
  type CompanyDocument,
  type HrStaffLoan,
  type IncidentReport,
  type UniversalOpsSummary
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import {
  getMyAttendanceToday,
  getMyLeaveSummary,
  listMyAttendanceHistory,
  listMyLeaveRequests
} from "./hrService.js";
import { fetchTenantUserNameMap } from "./userNameResolver.js";

const memoryLoans = new Map<string, HrStaffLoan[]>();
const memoryAnnouncements = new Map<string, CompanyAnnouncement[]>();
const memoryAnnouncementAcks = new Map<string, Set<string>>();
const memoryDocuments = new Map<string, CompanyDocument[]>();
const memoryIncidents = new Map<string, IncidentReport[]>();

function tenantKey(tenantId: string): string {
  return tenantId;
}

async function nameMap(tenantId: string): Promise<Map<string, string>> {
  return fetchTenantUserNameMap(tenantId);
}

function parseLoan(row: Record<string, unknown>, names: Map<string, string>): HrStaffLoan {
  return hrStaffLoanSchema.parse({
    id: String(row.id),
    userId: String(row.user_id),
    userName: names.get(String(row.user_id)),
    amount: Number(row.amount),
    purpose: String(row.purpose),
    termMonths: Number(row.term_months),
    monthlyDeduction: row.monthly_deduction != null ? Number(row.monthly_deduction) : null,
    outstandingBalance: row.outstanding_balance != null ? Number(row.outstanding_balance) : null,
    status: row.status,
    notes: row.notes ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
    createdAt: String(row.created_at)
  });
}

export async function getUniversalOpsSummary(
  tenantId: string,
  userId: string
): Promise<UniversalOpsSummary> {
  const [today, leave, loans, incidents, announcements] = await Promise.all([
    getMyAttendanceToday(tenantId, userId),
    getMyLeaveSummary(tenantId, userId, undefined),
    listMyStaffLoans(tenantId, userId),
    listMyIncidents(tenantId, userId),
    listAnnouncements(tenantId, userId)
  ]);

  const activeLoan = loans.find((l) => l.status === "active" || l.status === "approved");
  const hoursWorked =
    today?.checkIn && today?.checkOut
      ? calcHoursWorked(today.checkIn, today.checkOut)
      : today?.checkIn
        ? calcHoursWorked(today.checkIn, nowTime())
        : 0;

  return universalOpsSummarySchema.parse({
    clockedIn: Boolean(today?.checkIn && !today?.checkOut),
    checkIn: today?.checkIn ?? null,
    checkOut: today?.checkOut ?? null,
    hoursWorked,
    leaveAvailable: leave.availableDays,
    leavePending: leave.pendingCount,
    loanOutstanding: activeLoan?.outstandingBalance ?? activeLoan?.amount ?? null,
    loanStatus: activeLoan?.status ?? "None active",
    openIncidents: incidents.filter((i) => i.status === "pending" || i.status === "investigating").length,
    unreadAnnouncements: announcements.filter((a) => !a.acknowledged).length
  });
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function calcHoursWorked(checkIn: string, checkOut: string): number {
  const [ih, im] = checkIn.split(":").map(Number);
  const [oh, om] = checkOut.split(":").map(Number);
  const mins = oh * 60 + om - (ih * 60 + im);
  return Math.max(0, Math.round((mins / 60) * 10) / 10);
}

export async function listMyStaffLoans(tenantId: string, userId: string): Promise<HrStaffLoan[]> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    const { data, error } = await supabase
      .from("hr_staff_loans")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) {
      throw new Error(`Failed to load staff loans: ${error.message}`);
    }
    return (data ?? []).map((row) => parseLoan(row, names));
  }
  return (memoryLoans.get(tenantKey(tenantId)) ?? []).filter((l) => l.userId === userId);
}

export async function listAllStaffLoans(tenantId: string): Promise<HrStaffLoan[]> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    const { data, error } = await supabase
      .from("hr_staff_loans")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      throw new Error(`Failed to load staff loans: ${error.message}`);
    }
    return (data ?? []).map((row) => parseLoan(row, names));
  }
  return memoryLoans.get(tenantKey(tenantId)) ?? [];
}

export async function createStaffLoan(
  tenantId: string,
  userId: string,
  raw: unknown
): Promise<HrStaffLoan> {
  const payload = createStaffLoanSchema.parse(raw ?? {});
  const names = await nameMap(tenantId);
  const record = hrStaffLoanSchema.parse({
    id: randomUUID(),
    userId,
    userName: names.get(userId),
    amount: payload.amount,
    purpose: payload.purpose,
    termMonths: payload.termMonths,
    monthlyDeduction: null,
    outstandingBalance: payload.amount,
    status: "pending",
    notes: payload.notes,
    createdAt: new Date().toISOString()
  });
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("hr_staff_loans").insert({
      id: record.id,
      tenant_id: tenantId,
      user_id: record.userId,
      amount: record.amount,
      purpose: record.purpose,
      term_months: record.termMonths,
      outstanding_balance: record.outstandingBalance,
      status: record.status,
      notes: record.notes ?? null
    });
    if (error) {
      throw new Error(`Failed to submit loan: ${error.message}`);
    }
  } else {
    const list = memoryLoans.get(tenantKey(tenantId)) ?? [];
    memoryLoans.set(tenantKey(tenantId), [record, ...list]);
  }
  return record;
}

export function calculateStaffLoanMonthlyDeduction(amount: number, termMonths: number): number {
  if (termMonths <= 0) {
    return 0;
  }
  return Math.round((amount / termMonths) * 100) / 100;
}

export async function updateStaffLoanStatus(
  tenantId: string,
  loanId: string,
  status: "approved" | "declined",
  reviewedBy: string,
  monthlyDeductionOverride?: number
): Promise<HrStaffLoan> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    const { data: existing, error: fetchError } = await supabase
      .from("hr_staff_loans")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("id", loanId)
      .maybeSingle();
    if (fetchError || !existing) {
      throw new Error("Loan application not found");
    }
    const amount = Number(existing.amount);
    const termMonths = Number(existing.term_months);
    const monthlyDeduction =
      status === "approved"
        ? monthlyDeductionOverride ?? calculateStaffLoanMonthlyDeduction(amount, termMonths)
        : null;
    const nextStatus = status === "approved" ? "active" : "declined";
    const { data, error } = await supabase
      .from("hr_staff_loans")
      .update({
        status: nextStatus,
        monthly_deduction: status === "approved" ? monthlyDeduction : null,
        outstanding_balance: status === "approved" ? amount : null,
        reviewed_by: reviewedBy,
        reviewed_at: new Date().toISOString()
      })
      .eq("tenant_id", tenantId)
      .eq("id", loanId)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      throw new Error("Failed to update loan");
    }
    return parseLoan(data, names);
  }
  const list = memoryLoans.get(tenantKey(tenantId)) ?? [];
  const idx = list.findIndex((l) => l.id === loanId);
  if (idx < 0) {
    throw new Error("Loan application not found");
  }
  const amount = list[idx].amount;
  const termMonths = list[idx].termMonths;
  const monthlyDeduction =
    status === "approved"
      ? monthlyDeductionOverride ?? calculateStaffLoanMonthlyDeduction(amount, termMonths)
      : null;
  const updated = {
    ...list[idx],
    status: status === "approved" ? ("active" as const) : ("declined" as const),
    monthlyDeduction,
    outstandingBalance: status === "approved" ? amount : null,
    reviewedBy,
    reviewedAt: new Date().toISOString()
  };
  list[idx] = updated;
  memoryLoans.set(tenantKey(tenantId), list);
  return updated;
}

export async function listAnnouncements(
  tenantId: string,
  userId: string
): Promise<CompanyAnnouncement[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("company_announcements")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("pinned", { ascending: false })
      .order("published_at", { ascending: false })
      .limit(100);
    if (error) {
      throw new Error(`Failed to load announcements: ${error.message}`);
    }
    const { data: acks } = await supabase
      .from("company_announcement_acks")
      .select("announcement_id")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId);
    const ackSet = new Set((acks ?? []).map((a) => String(a.announcement_id)));
    return (data ?? []).map((row) =>
      companyAnnouncementSchema.parse({
        id: String(row.id),
        title: String(row.title),
        body: String(row.body),
        category: String(row.category),
        pinned: Boolean(row.pinned),
        publishedAt: String(row.published_at),
        expiresAt: row.expires_at ? String(row.expires_at) : null,
        createdBy: row.created_by ?? undefined,
        acknowledged: ackSet.has(String(row.id))
      })
    );
  }
  const ackKey = `${tenantKey(tenantId)}:${userId}`;
  const ackSet = memoryAnnouncementAcks.get(ackKey) ?? new Set();
  return (memoryAnnouncements.get(tenantKey(tenantId)) ?? []).map((a) => ({
    ...a,
    acknowledged: ackSet.has(a.id)
  }));
}

export async function createAnnouncement(
  tenantId: string,
  createdBy: string,
  raw: unknown
): Promise<CompanyAnnouncement> {
  const payload = createAnnouncementSchema.parse(raw ?? {});
  const record = companyAnnouncementSchema.parse({
    id: randomUUID(),
    title: payload.title,
    body: payload.body,
    category: payload.category,
    pinned: payload.pinned ?? false,
    publishedAt: new Date().toISOString(),
    expiresAt: payload.expiresAt ?? null,
    createdBy,
    acknowledged: false
  });
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("company_announcements").insert({
      id: record.id,
      tenant_id: tenantId,
      title: record.title,
      body: record.body,
      category: record.category,
      pinned: record.pinned,
      expires_at: record.expiresAt,
      created_by: createdBy
    });
    if (error) {
      throw new Error(`Failed to publish announcement: ${error.message}`);
    }
  } else {
    const list = memoryAnnouncements.get(tenantKey(tenantId)) ?? [];
    memoryAnnouncements.set(tenantKey(tenantId), [record, ...list]);
  }
  return record;
}

export async function acknowledgeAnnouncement(
  tenantId: string,
  userId: string,
  announcementId: string
): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("company_announcement_acks").upsert(
      {
        tenant_id: tenantId,
        announcement_id: announcementId,
        user_id: userId
      },
      { onConflict: "tenant_id,announcement_id,user_id" }
    );
    if (error) {
      throw new Error(`Failed to acknowledge: ${error.message}`);
    }
    return;
  }
  const ackKey = `${tenantKey(tenantId)}:${userId}`;
  const ackSet = memoryAnnouncementAcks.get(ackKey) ?? new Set();
  ackSet.add(announcementId);
  memoryAnnouncementAcks.set(ackKey, ackSet);
}

export async function listDocuments(tenantId: string): Promise<CompanyDocument[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("company_documents")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      throw new Error(`Failed to load documents: ${error.message}`);
    }
    return (data ?? []).map((row) =>
      companyDocumentSchema.parse({
        id: String(row.id),
        title: String(row.title),
        category: String(row.category),
        fileUrl: row.file_url ?? null,
        version: String(row.version ?? "1.0"),
        uploadedBy: row.uploaded_by ?? undefined,
        createdAt: String(row.created_at)
      })
    );
  }
  return memoryDocuments.get(tenantKey(tenantId)) ?? [];
}

export async function createDocument(
  tenantId: string,
  uploadedBy: string,
  raw: unknown
): Promise<CompanyDocument> {
  const payload = createDocumentSchema.parse(raw ?? {});
  const record = companyDocumentSchema.parse({
    id: randomUUID(),
    title: payload.title,
    category: payload.category,
    fileUrl: payload.fileUrl ?? null,
    version: payload.version ?? "1.0",
    uploadedBy,
    createdAt: new Date().toISOString()
  });
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("company_documents").insert({
      id: record.id,
      tenant_id: tenantId,
      title: record.title,
      category: record.category,
      file_url: record.fileUrl,
      version: record.version,
      uploaded_by: uploadedBy
    });
    if (error) {
      throw new Error(`Failed to upload document: ${error.message}`);
    }
  } else {
    const list = memoryDocuments.get(tenantKey(tenantId)) ?? [];
    memoryDocuments.set(tenantKey(tenantId), [record, ...list]);
  }
  return record;
}

export async function listMyIncidents(tenantId: string, userId: string): Promise<IncidentReport[]> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    const { data, error } = await supabase
      .from("incident_reports")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      throw new Error(`Failed to load incidents: ${error.message}`);
    }
    return (data ?? []).map((row) => parseIncident(row, names));
  }
  return (memoryIncidents.get(tenantKey(tenantId)) ?? []).filter((i) => i.userId === userId);
}

export async function listAllIncidents(tenantId: string): Promise<IncidentReport[]> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    const { data, error } = await supabase
      .from("incident_reports")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      throw new Error(`Failed to load incidents: ${error.message}`);
    }
    return (data ?? []).map((row) => parseIncident(row, names));
  }
  return memoryIncidents.get(tenantKey(tenantId)) ?? [];
}

function parseIncident(row: Record<string, unknown>, names: Map<string, string>): IncidentReport {
  return incidentReportSchema.parse({
    id: String(row.id),
    userId: String(row.user_id),
    userName: names.get(String(row.user_id)),
    incidentType: String(row.incident_type),
    description: String(row.description),
    status: row.status,
    resolutionNotes: row.resolution_notes ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  });
}

export async function createIncident(
  tenantId: string,
  userId: string,
  raw: unknown
): Promise<IncidentReport> {
  const payload = createIncidentSchema.parse(raw ?? {});
  const names = await nameMap(tenantId);
  const record = incidentReportSchema.parse({
    id: randomUUID(),
    userId,
    userName: names.get(userId),
    incidentType: payload.incidentType,
    description: payload.description,
    status: "pending",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  });
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("incident_reports").insert({
      id: record.id,
      tenant_id: tenantId,
      user_id: record.userId,
      incident_type: record.incidentType,
      description: record.description,
      status: record.status
    });
    if (error) {
      throw new Error(`Failed to submit incident: ${error.message}`);
    }
  } else {
    const list = memoryIncidents.get(tenantKey(tenantId)) ?? [];
    memoryIncidents.set(tenantKey(tenantId), [record, ...list]);
  }
  return record;
}

export async function updateIncidentStatus(
  tenantId: string,
  incidentId: string,
  status: "investigating" | "resolved" | "closed",
  reviewedBy: string,
  resolutionNotes?: string
): Promise<IncidentReport> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    const { data, error } = await supabase
      .from("incident_reports")
      .update({
        status,
        reviewed_by: reviewedBy,
        resolution_notes: resolutionNotes ?? null,
        updated_at: new Date().toISOString()
      })
      .eq("tenant_id", tenantId)
      .eq("id", incidentId)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      throw new Error("Incident not found");
    }
    return parseIncident(data, names);
  }
  const list = memoryIncidents.get(tenantKey(tenantId)) ?? [];
  const idx = list.findIndex((i) => i.id === incidentId);
  if (idx < 0) {
    throw new Error("Incident not found");
  }
  const updated = {
    ...list[idx],
    status,
    reviewedBy,
    resolutionNotes,
    updatedAt: new Date().toISOString()
  };
  list[idx] = updated;
  memoryIncidents.set(tenantKey(tenantId), list);
  return updated;
}

export { listMyLeaveRequests, listMyAttendanceHistory };
