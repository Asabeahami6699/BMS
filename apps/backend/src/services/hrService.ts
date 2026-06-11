import {
  createHrAttendanceSchema,
  createHrLeaveRequestSchema,
  createHrTrainingSchema,
  hrAttendanceCheckSchema,
  hrAttendanceRecordSchema,
  hrLeaveRequestSchema,
  hrLeaveSummarySchema,
  hrTrainingRecordSchema,
  type HrAttendanceRecord,
  type HrLeaveRequest,
  type HrLeaveSummary,
  type HrTrainingRecord
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { getAnnualLeaveEntitlement, getLateCheckInTime, isLateCheckIn } from "./hrPolicyService.js";
import { fetchTenantUserNameMap } from "./userNameResolver.js";

const memoryLeave = new Map<string, HrLeaveRequest[]>();
const memoryAttendance = new Map<string, HrAttendanceRecord[]>();
const memoryTraining = new Map<string, HrTrainingRecord[]>();

function tenantKey(tenantId: string): string {
  return tenantId;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTime(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
}

function parseTimeValue(value: unknown): string | null {
  if (value == null) {
    return null;
  }
  const raw = String(value);
  return raw.length >= 5 ? raw.slice(0, 8) : raw;
}

function parseAttendanceRow(row: Record<string, unknown>, names: Map<string, string>): HrAttendanceRecord {
  return hrAttendanceRecordSchema.parse({
    id: String(row.id),
    userId: String(row.user_id),
    userName: names.get(String(row.user_id)),
    branchId: row.branch_id ?? null,
    businessDate: String(row.business_date),
    status: row.status,
    checkIn: parseTimeValue(row.check_in),
    checkOut: parseTimeValue(row.check_out),
    checkInPhotoUrl: row.check_in_photo_url ? String(row.check_in_photo_url) : undefined,
    checkOutPhotoUrl: row.check_out_photo_url ? String(row.check_out_photo_url) : undefined,
    notes: row.notes ?? undefined
  });
}

function parseLeaveRow(row: Record<string, unknown>, names: Map<string, string>): HrLeaveRequest {
  return hrLeaveRequestSchema.parse({
    id: String(row.id),
    userId: String(row.user_id),
    userName: names.get(String(row.user_id)),
    leaveType: String(row.leave_type),
    startDate: String(row.start_date),
    endDate: String(row.end_date),
    status: row.status,
    notes: row.notes ?? undefined,
    rejectedReason: row.rejected_reason ?? undefined,
    reviewedBy: row.reviewed_by ?? undefined,
    reviewedAt: row.reviewed_at ? String(row.reviewed_at) : undefined,
    createdAt: String(row.created_at)
  });
}

function countLeaveDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  return Math.max(1, diff + 1);
}

function eachDateInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const cursor = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setDate(cursor.getDate() + 1);
  }
  return dates;
}

async function nameMap(tenantId: string): Promise<Map<string, string>> {
  return fetchTenantUserNameMap(tenantId);
}

export async function listHrLeaveRequests(tenantId: string): Promise<HrLeaveRequest[]> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    const { data, error } = await supabase
      .from("hr_leave_requests")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      throw new Error(`Failed to load leave requests: ${error.message}`);
    }
    return (data ?? []).map((row) => parseLeaveRow(row, names));
  }
  return memoryLeave.get(tenantKey(tenantId)) ?? [];
}

export async function createHrLeaveRequest(tenantId: string, raw: unknown): Promise<HrLeaveRequest> {
  const payload = createHrLeaveRequestSchema.parse(raw ?? {});
  const names = await nameMap(tenantId);
  const record = hrLeaveRequestSchema.parse({
    id: randomUUID(),
    userId: payload.userId,
    userName: names.get(payload.userId),
    leaveType: payload.leaveType,
    startDate: payload.startDate,
    endDate: payload.endDate,
    status: "pending",
    notes: payload.notes,
    createdAt: new Date().toISOString()
  });
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("hr_leave_requests").insert({
      id: record.id,
      tenant_id: tenantId,
      user_id: record.userId,
      leave_type: record.leaveType,
      start_date: record.startDate,
      end_date: record.endDate,
      status: record.status,
      notes: record.notes ?? null
    });
    if (error) {
      throw new Error(`Failed to create leave request: ${error.message}`);
    }
  } else {
    const list = memoryLeave.get(tenantKey(tenantId)) ?? [];
    memoryLeave.set(tenantKey(tenantId), [record, ...list]);
  }
  return record;
}

export async function listMyLeaveRequests(tenantId: string, userId: string): Promise<HrLeaveRequest[]> {
  const rows = await listHrLeaveRequests(tenantId);
  return rows.filter((row) => row.userId === userId);
}

export async function getMyLeaveSummary(
  tenantId: string,
  userId: string,
  userRole?: string
): Promise<HrLeaveSummary> {
  const rows = await listMyLeaveRequests(tenantId, userId);
  const year = new Date().getFullYear();
  const approved = rows.filter((r) => r.status === "approved");
  const usedDays = approved
    .filter((r) => r.startDate.startsWith(String(year)))
    .reduce((sum, r) => sum + countLeaveDays(r.startDate, r.endDate), 0);
  const role = userRole ?? (await resolveUserRole(tenantId, userId));
  const annualEntitlement = await getAnnualLeaveEntitlement(tenantId, role);
  return hrLeaveSummarySchema.parse({
    annualEntitlement,
    usedDays,
    availableDays: Math.max(0, annualEntitlement - usedDays),
    pendingCount: rows.filter((r) => r.status === "pending").length,
    approvedCount: approved.length
  });
}

async function resolveUserRole(tenantId: string, userId: string): Promise<string> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data } = await supabase
      .from("users")
      .select("role")
      .eq("tenant_id", tenantId)
      .eq("id", userId)
      .maybeSingle();
    if (data?.role) {
      return String(data.role);
    }
  }
  return "teller";
}

export async function createMyLeaveRequest(
  tenantId: string,
  userId: string,
  raw: unknown
): Promise<HrLeaveRequest> {
  const payload = createHrLeaveRequestSchema.parse({ ...(raw as object), userId });
  return createHrLeaveRequest(tenantId, payload);
}

async function syncLeaveToAttendance(
  tenantId: string,
  leave: HrLeaveRequest
): Promise<void> {
  for (const date of eachDateInRange(leave.startDate, leave.endDate)) {
    await upsertHrAttendance(tenantId, {
      userId: leave.userId,
      businessDate: date,
      status: "leave",
      notes: `Approved leave: ${leave.leaveType}`
    });
  }
}

export async function updateHrLeaveStatus(
  tenantId: string,
  requestId: string,
  status: "approved" | "rejected",
  options?: { reviewedBy?: string; rejectedReason?: string }
): Promise<HrLeaveRequest> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("hr_leave_requests")
      .update({
        status,
        reviewed_by: options?.reviewedBy ?? null,
        reviewed_at: new Date().toISOString(),
        rejected_reason: status === "rejected" ? options?.rejectedReason ?? null : null
      })
      .eq("tenant_id", tenantId)
      .eq("id", requestId)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      throw new Error("Leave request not found");
    }
    const names = await nameMap(tenantId);
    const updated = parseLeaveRow(data, names);
    if (status === "approved") {
      await syncLeaveToAttendance(tenantId, updated);
    }
    return updated;
  }
  const list = memoryLeave.get(tenantKey(tenantId)) ?? [];
  const idx = list.findIndex((row) => row.id === requestId);
  if (idx < 0) {
    throw new Error("Leave request not found");
  }
  const updated = {
    ...list[idx],
    status,
    reviewedBy: options?.reviewedBy,
    reviewedAt: new Date().toISOString(),
    rejectedReason: status === "rejected" ? options?.rejectedReason : undefined
  };
  list[idx] = updated;
  memoryLeave.set(tenantKey(tenantId), list);
  if (status === "approved") {
    await syncLeaveToAttendance(tenantId, updated);
  }
  return updated;
}

export async function listHrAttendance(
  tenantId: string,
  options?: { businessDate?: string; dateFrom?: string; dateTo?: string; userId?: string }
): Promise<HrAttendanceRecord[]> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    let query = supabase
      .from("hr_attendance_records")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("business_date", { ascending: false })
      .limit(500);
    if (options?.businessDate) {
      query = query.eq("business_date", options.businessDate);
    } else {
      if (options?.dateFrom) {
        query = query.gte("business_date", options.dateFrom);
      }
      if (options?.dateTo) {
        query = query.lte("business_date", options.dateTo);
      }
    }
    if (options?.userId) {
      query = query.eq("user_id", options.userId);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load attendance: ${error.message}`);
    }
    return (data ?? []).map((row) => parseAttendanceRow(row, names));
  }
  const rows = memoryAttendance.get(tenantKey(tenantId)) ?? [];
  return options?.businessDate
    ? rows.filter((row) => row.businessDate === options.businessDate)
    : rows;
}

export async function getMyAttendanceToday(
  tenantId: string,
  userId: string
): Promise<HrAttendanceRecord | null> {
  const rows = await listHrAttendance(tenantId, { businessDate: todayIso(), userId });
  return rows[0] ?? null;
}

export async function listMyAttendanceHistory(
  tenantId: string,
  userId: string
): Promise<HrAttendanceRecord[]> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    const { data, error } = await supabase
      .from("hr_attendance_records")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("user_id", userId)
      .order("business_date", { ascending: false })
      .limit(60);
    if (error) {
      throw new Error(`Failed to load attendance history: ${error.message}`);
    }
    return (data ?? []).map((row) => parseAttendanceRow(row, names));
  }
  return (memoryAttendance.get(tenantKey(tenantId)) ?? []).filter((row) => row.userId === userId);
}

export async function checkInAttendance(
  tenantId: string,
  userId: string,
  raw: unknown,
  branchId?: string | null
): Promise<HrAttendanceRecord> {
  const payload = hrAttendanceCheckSchema.parse(raw ?? {});
  const existing = await getMyAttendanceToday(tenantId, userId);
  if (existing?.checkIn) {
    throw new Error("Already checked in today");
  }
  const time = nowTime();
  const lateThreshold = await getLateCheckInTime(tenantId);
  const status = isLateCheckIn(time, lateThreshold) ? "late" : "present";
  return upsertHrAttendance(tenantId, {
    userId,
    branchId: payload.branchId ?? branchId ?? undefined,
    businessDate: todayIso(),
    status,
    checkIn: time,
    checkInPhotoUrl: payload.photoUrl
  });
}

export async function checkOutAttendance(
  tenantId: string,
  userId: string,
  raw: unknown
): Promise<HrAttendanceRecord> {
  const payload = hrAttendanceCheckSchema.parse(raw ?? {});
  const existing = await getMyAttendanceToday(tenantId, userId);
  if (!existing?.checkIn) {
    throw new Error("Check in before checking out");
  }
  if (existing.checkOut) {
    throw new Error("Already checked out today");
  }
  return upsertHrAttendance(tenantId, {
    userId,
    branchId: existing.branchId ?? undefined,
    businessDate: todayIso(),
    status: existing.status,
    checkIn: existing.checkIn ?? undefined,
    checkOut: nowTime(),
    checkInPhotoUrl: existing.checkInPhotoUrl,
    checkOutPhotoUrl: payload.photoUrl
  });
}

export async function upsertHrAttendance(tenantId: string, raw: unknown): Promise<HrAttendanceRecord> {
  const payload = createHrAttendanceSchema.parse(raw ?? {});
  const names = await nameMap(tenantId);
  const record = hrAttendanceRecordSchema.parse({
    id: randomUUID(),
    userId: payload.userId,
    userName: names.get(payload.userId),
    branchId: payload.branchId ?? null,
    businessDate: payload.businessDate,
    status: payload.status,
    checkIn: payload.checkIn ?? null,
    checkOut: payload.checkOut ?? null,
    checkInPhotoUrl: payload.checkInPhotoUrl,
    checkOutPhotoUrl: payload.checkOutPhotoUrl,
    notes: payload.notes
  });
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("hr_attendance_records")
      .upsert(
        {
          tenant_id: tenantId,
          user_id: record.userId,
          branch_id: record.branchId,
          business_date: record.businessDate,
          status: record.status,
          check_in: record.checkIn,
          check_out: record.checkOut,
          check_in_photo_url: record.checkInPhotoUrl ?? null,
          check_out_photo_url: record.checkOutPhotoUrl ?? null,
          notes: record.notes ?? null
        },
        { onConflict: "tenant_id,user_id,business_date" }
      )
      .select("*")
      .maybeSingle();
    if (error) {
      throw new Error(`Failed to save attendance: ${error.message}`);
    }
    if (data) {
      return parseAttendanceRow(data, names);
    }
  } else {
    const list = memoryAttendance.get(tenantKey(tenantId)) ?? [];
    const without = list.filter(
      (row) => !(row.userId === record.userId && row.businessDate === record.businessDate)
    );
    memoryAttendance.set(tenantKey(tenantId), [record, ...without]);
  }
  return record;
}

export async function listHrTraining(tenantId: string): Promise<HrTrainingRecord[]> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    const { data, error } = await supabase
      .from("hr_training_records")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) {
      throw new Error(`Failed to load training records: ${error.message}`);
    }
    return (data ?? []).map((row) =>
      hrTrainingRecordSchema.parse({
        id: String(row.id),
        userId: String(row.user_id),
        userName: names.get(String(row.user_id)),
        trainingTitle: String(row.training_title),
        completedOn: row.completed_on ?? null,
        expiresOn: row.expires_on ?? null,
        status: row.status,
        notes: row.notes ?? undefined
      })
    );
  }
  return memoryTraining.get(tenantKey(tenantId)) ?? [];
}

export async function createHrTraining(tenantId: string, raw: unknown): Promise<HrTrainingRecord> {
  const payload = createHrTrainingSchema.parse(raw ?? {});
  const names = await nameMap(tenantId);
  const record = hrTrainingRecordSchema.parse({
    id: randomUUID(),
    userId: payload.userId,
    userName: names.get(payload.userId),
    trainingTitle: payload.trainingTitle,
    completedOn: payload.completedOn ?? null,
    expiresOn: payload.expiresOn ?? null,
    status: payload.status ?? "due",
    notes: payload.notes
  });
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("hr_training_records").insert({
      id: record.id,
      tenant_id: tenantId,
      user_id: record.userId,
      training_title: record.trainingTitle,
      completed_on: record.completedOn,
      expires_on: record.expiresOn,
      status: record.status,
      notes: record.notes ?? null
    });
    if (error) {
      throw new Error(`Failed to create training record: ${error.message}`);
    }
  } else {
    const list = memoryTraining.get(tenantKey(tenantId)) ?? [];
    memoryTraining.set(tenantKey(tenantId), [record, ...list]);
  }
  return record;
}
