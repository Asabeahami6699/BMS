import { FormEvent, useCallback, useEffect, useState } from "react";
import type { HrLeaveRequest } from "@bms/shared";
import { createHrLeaveRequest, listHrLeaveRequests, listUsers, updateHrLeaveStatus } from "../../api";
import { AdminDataTable, filterRowsBySearch } from "../../../components/AdminDataTable";
import { useToast } from "../../../components/Toast";
import { HrSectionShell } from "./HrSectionShell";

type Props = { displayName?: string; canManage: boolean };

export function HrLeavePage({ displayName, canManage }: Props) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<HrLeaveRequest[]>([]);
  const [users, setUsers] = useState<Array<{ userId: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [leaveType, setLeaveType] = useState("Annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [leaveRows, staff] = await Promise.all([listHrLeaveRequests(), listUsers()]);
      setRows(leaveRows);
      setUsers(
        staff.map((u) => ({
          userId: u.userId,
          label: u.fullName ? `${u.fullName} (${u.email})` : u.email
        }))
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load leave", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId || !startDate || !endDate) {
      return;
    }
    try {
      await createHrLeaveRequest({ userId, leaveType, startDate, endDate });
      showToast("Leave request submitted", "success");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <HrSectionShell
      title="Leave management"
      subtitle="Submit, approve, and track staff leave across branches."
      displayName={displayName}
      loading={loading}
      onRefresh={() => void load()}
      refreshing={loading}
    >
      {canManage ? (
        <form className="card stack-form" onSubmit={handleSubmit}>
          <h3>New leave request</h3>
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
            <span>Leave type</span>
            <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
              <option>Annual</option>
              <option>Sick</option>
              <option>Emergency</option>
              <option>Unpaid</option>
            </select>
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Start</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </label>
            <label className="field">
              <span>End</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </label>
          </div>
          <button type="submit" className="button primary">
            Submit request
          </button>
        </form>
      ) : null}

      <AdminDataTable
        variant="desk"
        title="Leave requests"
        subtitle="Pending, approved, and rejected leave across the organisation."
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search employee, type, status…"
        columns={[
          { key: "userName", label: "Employee" },
          { key: "leaveType", label: "Type" },
          { key: "startDate", label: "Start" },
          { key: "endDate", label: "End" },
          { key: "status", label: "Status" }
        ]}
        rows={filterRowsBySearch(
          rows.map((r) => ({
            id: r.id,
            userName: r.userName ?? r.userId,
            leaveType: r.leaveType,
            startDate: r.startDate,
            endDate: r.endDate,
            status: r.status,
            raw: r
          })),
          search,
          ["userName", "leaveType", "status", "startDate", "endDate"]
        )}
        rowKey={(r) => r.id}
        emptyMessage={loading ? "Loading…" : "No leave requests yet."}
        actions={
          canManage
            ? (row) =>
                row.raw.status === "pending" ? (
                  <div className="role-workspace__queue-actions">
                    <button
                      type="button"
                      className="btn primary"
                      onClick={() =>
                        void updateHrLeaveStatus(row.id, "approved").then(() => load())
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        void updateHrLeaveStatus(row.id, "rejected").then(() => load())
                      }
                    >
                      Reject
                    </button>
                  </div>
                ) : null
            : undefined
        }
      />
    </HrSectionShell>
  );
}
