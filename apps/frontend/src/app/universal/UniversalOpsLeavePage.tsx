import { FormEvent, useState } from "react";
import { LEAVE_TYPES } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import { AdminDataTable } from "../../components/AdminDataTable";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useUniversalOpsLiveSync } from "../hooks/useUniversalOpsLiveSync";
import { useUniversalOpsStore } from "../stores/universalOpsStore";
import { UniversalOpsQuickLinks, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

export function UniversalOpsLeavePage({ displayName }: Props) {
  const { showToast } = useToast();
  const [leaveType, setLeaveType] = useState<string>(LEAVE_TYPES[0]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [notes, setNotes] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  useUniversalOpsLiveSync({ scope: "leave" });

  const { rows, summary, loading, actionBusy, submitLeave, refreshLeave } = useUniversalOpsStore(
    useShallow((s) => ({
      rows: s.leaveRequests,
      summary: s.leaveSummary,
      loading: s.leaveLoading,
      actionBusy: s.actionBusy,
      submitLeave: s.submitLeave,
      refreshLeave: s.refreshLeave
    }))
  );

  function closeModal() {
    setModalOpen(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!startDate || !endDate) {
      return;
    }
    try {
      await submitLeave({ leaveType, startDate, endDate, notes: notes || undefined });
      showToast("Leave request submitted", "success");
      closeModal();
      setNotes("");
      setStartDate("");
      setEndDate("");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to submit leave", "error");
    }
  }

  return (
    <>
      <UniversalOpsShell
        title="Leave Management"
        subtitle="Submit requests, track balances, and view approval history."
        displayName={displayName}
        actions={
          <div className="universal-ops__actions">
            <button type="button" className="button primary" onClick={() => setModalOpen(true)}>
              Submit leave request
            </button>
            <button type="button" className="button secondary" onClick={() => void refreshLeave()}>
              Refresh
            </button>
          </div>
        }
      >
        <section className="card universal-ops__kpi-row">
          <div className="universal-ops__kpi">
            <span className="muted">Available days</span>
            <strong>{summary?.availableDays ?? "—"}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Pending</span>
            <strong>{summary?.pendingCount ?? 0}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Approved</span>
            <strong>{summary?.approvedCount ?? 0}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Used this year</span>
            <strong>{summary?.usedDays ?? "—"} days</strong>
          </div>
        </section>

        <AdminDataTable
          variant="desk"
          title="My leave requests"
          subtitle="Pending, approved, and rejected requests."
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search type or status…"
          columns={[
            { key: "leaveType", label: "Type" },
            { key: "startDate", label: "Start" },
            { key: "endDate", label: "End" },
            { key: "status", label: "Status" },
            { key: "notes", label: "Notes" }
          ]}
          rows={rows.map((r) => ({
            id: r.id,
            leaveType: r.leaveType,
            startDate: r.startDate,
            endDate: r.endDate,
            status: r.status,
            notes: r.notes ?? r.rejectedReason ?? "—"
          }))}
          rowKey={(r) => r.id}
          emptyMessage={loading ? "Loading…" : "No leave requests yet."}
        />

        <UniversalOpsQuickLinks excludePath="operations/leave" />
      </UniversalOpsShell>

      <Modal
        open={modalOpen}
        title="Submit leave request"
        subtitle="Choose dates and leave type for HR approval."
        onClose={closeModal}
        panelClassName="modal-panel--narrow"
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="button secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" form="leave-request-form" className="button primary" disabled={actionBusy}>
              {actionBusy ? "Submitting…" : "Submit request"}
            </button>
          </div>
        }
      >
        <form id="leave-request-form" className="stack-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Leave type</span>
            <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
              {LEAVE_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label className="field">
              <span>Start date</span>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
            </label>
            <label className="field">
              <span>End date</span>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} required />
            </label>
          </div>
          <label className="field">
            <span>Notes (optional)</span>
            <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Reason or handover notes" />
          </label>
        </form>
      </Modal>
    </>
  );
}
