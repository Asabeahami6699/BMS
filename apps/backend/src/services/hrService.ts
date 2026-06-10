import {
  createHrAttendanceSchema,
  createHrLeaveRequestSchema,
  createHrTrainingSchema,
  hrAttendanceRecordSchema,
  hrLeaveRequestSchema,
  hrTrainingRecordSchema,
  type HrAttendanceRecord,
  type HrLeaveRequest,
  type HrTrainingRecord
} from "@bms/shared";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import { fetchTenantUserNameMap } from "./userNameResolver.js";

const memoryLeave = new Map<string, HrLeaveRequest[]>();
const memoryAttendance = new Map<string, HrAttendanceRecord[]>();
const memoryTraining = new Map<string, HrTrainingRecord[]>();

function tenantKey(tenantId: string): string {
  return tenantId;
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
    return (data ?? []).map((row) =>
      hrLeaveRequestSchema.parse({
        id: String(row.id),
        userId: String(row.user_id),
        userName: names.get(String(row.user_id)),
        leaveType: String(row.leave_type),
        startDate: String(row.start_date),
        endDate: String(row.end_date),
        status: row.status,
        notes: row.notes ?? undefined,
        createdAt: String(row.created_at)
      })
    );
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

export async function updateHrLeaveStatus(
  tenantId: string,
  requestId: string,
  status: "approved" | "rejected"
): Promise<HrLeaveRequest> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data, error } = await supabase
      .from("hr_leave_requests")
      .update({ status })
      .eq("tenant_id", tenantId)
      .eq("id", requestId)
      .select("*")
      .maybeSingle();
    if (error || !data) {
      throw new Error("Leave request not found");
    }
    const names = await nameMap(tenantId);
    return hrLeaveRequestSchema.parse({
      id: String(data.id),
      userId: String(data.user_id),
      userName: names.get(String(data.user_id)),
      leaveType: String(data.leave_type),
      startDate: String(data.start_date),
      endDate: String(data.end_date),
      status: data.status,
      notes: data.notes ?? undefined,
      createdAt: String(data.created_at)
    });
  }
  const list = memoryLeave.get(tenantKey(tenantId)) ?? [];
  const idx = list.findIndex((row) => row.id === requestId);
  if (idx < 0) {
    throw new Error("Leave request not found");
  }
  const updated = { ...list[idx], status };
  list[idx] = updated;
  memoryLeave.set(tenantKey(tenantId), list);
  return updated;
}

export async function listHrAttendance(
  tenantId: string,
  options?: { businessDate?: string }
): Promise<HrAttendanceRecord[]> {
  const supabase = getSupabaseAdminClient();
  const names = await nameMap(tenantId);
  if (supabase) {
    let query = supabase
      .from("hr_attendance_records")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("business_date", { ascending: false })
      .limit(200);
    if (options?.businessDate) {
      query = query.eq("business_date", options.businessDate);
    }
    const { data, error } = await query;
    if (error) {
      throw new Error(`Failed to load attendance: ${error.message}`);
    }
    return (data ?? []).map((row) =>
      hrAttendanceRecordSchema.parse({
        id: String(row.id),
        userId: String(row.user_id),
        userName: names.get(String(row.user_id)),
        branchId: row.branch_id ?? null,
        businessDate: String(row.business_date),
        status: row.status,
        checkIn: row.check_in ?? null,
        notes: row.notes ?? undefined
      })
    );
  }
  const rows = memoryAttendance.get(tenantKey(tenantId)) ?? [];
  return options?.businessDate
    ? rows.filter((row) => row.businessDate === options.businessDate)
    : rows;
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
      record.id = String(data.id);
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
