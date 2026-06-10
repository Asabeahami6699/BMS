import { FormEvent, useCallback, useEffect, useState } from "react";
import type { HrAttendanceRecord } from "@bms/shared";
import { listHrAttendance, listUsers, upsertHrAttendance } from "../../api";
import { AdminDataTable, filterRowsBySearch } from "../../../components/AdminDataTable";
import { useToast } from "../../../components/Toast";
import { HrSectionShell } from "./HrSectionShell";

type Props = { displayName?: string; canManage: boolean };

export function HrAttendancePage({ displayName, canManage }: Props) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<HrAttendanceRecord[]>([]);
  const [users, setUsers] = useState<Array<{ userId: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [businessDate, setBusinessDate] = useState(new Date().toISOString().slice(0, 10));
  const [userId, setUserId] = useState("");
  const [status, setStatus] = useState<HrAttendanceRecord["status"]>("present");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [attendance, staff] = await Promise.all([
        listHrAttendance({ businessDate }),
        listUsers()
      ]);
      setRows(attendance);
      setUsers(
        staff.map((u) => ({
          userId: u.userId,
          label: u.fullName ? `${u.fullName} (${u.email})` : u.email
        }))
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load attendance", "error");
    } finally {
      setLoading(false);
    }
  }, [businessDate, showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId) {
      return;
    }
    try {
      await upsertHrAttendance({ userId, businessDate, status });
      showToast("Attendance saved", "success");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <HrSectionShell
      title="Attendance"
      subtitle="Daily presence register by branch and employee."
      displayName={displayName}
      loading={loading}
      onRefresh={() => void load()}
      refreshing={loading}
    >
      <section className="card stack-form">
        <label className="field">
          <span>Business date</span>
          <input type="date" value={businessDate} onChange={(e) => setBusinessDate(e.target.value)} />
        </label>
      </section>

      {canManage ? (
        <form className="card stack-form" onSubmit={handleSubmit}>
          <h3>Mark attendance</h3>
          <label className="field">
            <span>Employee</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">Select employee…</option>
              {users.map((u) => (
                <option key={u.userId} value={u.userId}>
                  {u.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value as HrAttendanceRecord["status"])}>
              <option value="present">Present</option>
              <option value="late">Late</option>
              <option value="absent">Absent</option>
              <option value="leave">On leave</option>
            </select>
          </label>
          <button type="submit" className="button primary">
            Save attendance
          </button>
        </form>
      ) : null}

      <AdminDataTable
        variant="desk"
        title="Attendance register"
        subtitle={`Daily presence for ${businessDate}.`}
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search employee or status…"
        columns={[
          { key: "userName", label: "Employee" },
          { key: "businessDate", label: "Date" },
          { key: "status", label: "Status" },
          { key: "checkIn", label: "Check-in" }
        ]}
        rows={filterRowsBySearch(
          rows.map((r) => ({
            id: r.id,
            userName: r.userName ?? r.userId,
            businessDate: r.businessDate,
            status: r.status,
            checkIn: r.checkIn ?? "—"
          })),
          search,
          ["userName", "status", "businessDate"]
        )}
        rowKey={(r) => r.id}
        emptyMessage={loading ? "Loading…" : "No attendance for this date."}
      />
    </HrSectionShell>
  );
}
