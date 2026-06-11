import { FormEvent, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AdminDataTable, filterRowsBySearch } from "../../../components/AdminDataTable";
import { useToast } from "../../../components/Toast";
import { useHrDeskStore } from "../../stores/hrDeskStore";
import { HrSectionShell } from "./HrSectionShell";

type Props = { displayName?: string; canManage: boolean };

export function HrLeavePage({ displayName, canManage }: Props) {
  const { showToast } = useToast();
  const [userId, setUserId] = useState("");
  const [leaveType, setLeaveType] = useState("Annual");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [search, setSearch] = useState("");

  const {
    rows,
    users,
    loading,
    error,
    lastFetchedAt,
    hydrateLeave,
    refreshLeave,
    submitLeave,
    setLeaveStatus,
    startLiveSync,
    stopLiveSync
  } = useHrDeskStore(
    useShallow((s) => ({
      rows: s.leaveRequests,
      users: s.users,
      loading: s.leaveLoading,
      error: s.leaveError,
      lastFetchedAt: s.lastLeaveAt,
      hydrateLeave: s.hydrateLeave,
      refreshLeave: s.refreshLeave,
      submitLeave: s.submitLeave,
      setLeaveStatus: s.setLeaveStatus,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrateLeave({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrateLeave, startLiveSync, stopLiveSync]);

  const staffOptions = useMemo(
    () =>
      users.map((u) => ({
        userId: u.userId,
        label: u.fullName ? `${u.fullName} (${u.email})` : u.email
      })),
    [users]
  );

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId || !startDate || !endDate) {
      return;
    }
    try {
      await submitLeave({ userId, leaveType, startDate, endDate, notes: notes || undefined });
      setNotes("");
      showToast("Leave request submitted", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <HrSectionShell
      title="Leave management"
      subtitle="Submit, approve, and track staff leave across branches."
      displayName={displayName}
      loading={loading && rows.length === 0}
      error={error}
      updatedLabel={updatedLabel}
      onRefresh={() => void refreshLeave()}
      refreshing={loading}
    >
      {canManage ? (
        <form className="card stack-form" onSubmit={handleSubmit}>
          <h3>New leave request</h3>
          <label className="field">
            <span>Employee</span>
            <select value={userId} onChange={(e) => setUserId(e.target.value)} required>
              <option value="">Select employee…</option>
              {staffOptions.map((u) => (
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
          <label className="field">
            <span>Notes</span>
            <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional reason or handover notes" />
          </label>
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
          {
            key: "status",
            label: "Status",
            render: (row) => (
              <span
                className={`trial-balance-status${
                  row.raw.status === "approved"
                    ? " trial-balance-status--ok"
                    : row.raw.status === "rejected"
                      ? " trial-balance-status--warn"
                      : ""
                }`}
              >
                {row.raw.status === "approved"
                  ? "Approved"
                  : row.raw.status === "rejected"
                    ? "Rejected"
                    : "Pending"}
              </span>
            )
          },
          { key: "notes", label: "Notes" }
        ]}
        rows={filterRowsBySearch(
          rows.map((r) => ({
            id: r.id,
            userName: r.userName ?? r.userId,
            leaveType: r.leaveType,
            startDate: r.startDate,
            endDate: r.endDate,
            status: r.status,
            notes: r.notes ?? r.rejectedReason ?? "—",
            raw: r
          })),
          search,
          ["userName", "leaveType", "status", "startDate", "endDate", "notes"]
        )}
        rowKey={(r) => r.id}
        emptyMessage={loading ? "Loading…" : "No leave requests yet."}
        actions={
          canManage
            ? (row) => {
                if (row.raw.status === "pending") {
                  return (
                    <div className="role-workspace__queue-actions">
                      <button
                        type="button"
                        className="btn primary"
                        onClick={() =>
                          void setLeaveStatus(row.id, "approved")
                            .then(() => showToast("Leave approved", "success"))
                            .catch((err) =>
                              showToast(err instanceof Error ? err.message : "Failed", "error")
                            )
                        }
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        onClick={() => {
                          const reason = window.prompt("Rejection reason (optional):");
                          if (reason === null) {
                            return;
                          }
                          void setLeaveStatus(row.id, "rejected", {
                            rejectedReason: reason || undefined
                          })
                            .then(() => showToast("Leave rejected", "success"))
                            .catch((err) =>
                              showToast(err instanceof Error ? err.message : "Failed", "error")
                            );
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  );
                }
                if (row.raw.status === "approved") {
                  return (
                    <span className="trial-balance-status trial-balance-status--ok">Approved</span>
                  );
                }
                if (row.raw.status === "rejected") {
                  return (
                    <span className="trial-balance-status trial-balance-status--warn">Rejected</span>
                  );
                }
                return null;
              }
            : undefined
        }
      />
    </HrSectionShell>
  );
}
