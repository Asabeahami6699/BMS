import { FormEvent, useMemo, useState } from "react";
import { INCIDENT_TYPES } from "@bms/shared";
import { useShallow } from "zustand/react/shallow";
import { AdminDataTable } from "../../components/AdminDataTable";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useUniversalOpsLiveSync } from "../hooks/useUniversalOpsLiveSync";
import { useUniversalOpsStore } from "../stores/universalOpsStore";
import { UniversalOpsQuickLinks, UniversalOpsShell } from "./UniversalOpsShell";

type Props = { displayName?: string };

export function UniversalOpsIncidentsPage({ displayName }: Props) {
  const { showToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [incidentType, setIncidentType] = useState<string>(INCIDENT_TYPES[0]);
  const [description, setDescription] = useState("");
  const [search, setSearch] = useState("");
  useUniversalOpsLiveSync({ scope: "incidents" });

  const { incidents, loading, actionBusy, submitIncident, refreshIncidents } = useUniversalOpsStore(
    useShallow((s) => ({
      incidents: s.incidents,
      loading: s.incidentsLoading,
      actionBusy: s.actionBusy,
      submitIncident: s.submitIncident,
      refreshIncidents: s.refreshIncidents
    }))
  );

  const stats = useMemo(() => {
    const pending = incidents.filter((i) => i.status === "pending").length;
    const investigating = incidents.filter((i) => i.status === "investigating").length;
    const resolved = incidents.filter((i) => i.status === "resolved" || i.status === "closed").length;
    return { pending, investigating, resolved, total: incidents.length };
  }, [incidents]);

  function closeModal() {
    setModalOpen(false);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (description.trim().length < 10) {
      showToast("Please provide a detailed description (at least 10 characters)", "error");
      return;
    }
    try {
      await submitIncident({ incidentType, description: description.trim() });
      showToast("Incident reported", "success");
      closeModal();
      setDescription("");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to report", "error");
    }
  }

  return (
    <>
      <UniversalOpsShell
        title="Incident Reporting"
        subtitle="Report operational, cash, and security incidents for manager review."
        displayName={displayName}
        actions={
          <div className="universal-ops__actions">
            <button type="button" className="button primary" onClick={() => setModalOpen(true)}>
              Report incident
            </button>
            <button type="button" className="button secondary" onClick={() => void refreshIncidents()}>
              Refresh
            </button>
          </div>
        }
      >
        <section className="card universal-ops__kpi-row">
          <div className="universal-ops__kpi">
            <span className="muted">My incidents</span>
            <strong>{stats.total}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Pending cases</span>
            <strong>{stats.pending}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Under investigation</span>
            <strong>{stats.investigating}</strong>
          </div>
          <div className="universal-ops__kpi">
            <span className="muted">Resolved</span>
            <strong>{stats.resolved}</strong>
          </div>
        </section>

        <AdminDataTable
          variant="desk"
          title="My incidents"
          subtitle="Cases you have filed with current status."
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search type or status…"
          columns={[
            { key: "type", label: "Type" },
            { key: "status", label: "Status" },
            { key: "created", label: "Reported" },
            { key: "description", label: "Summary" }
          ]}
          rows={incidents.map((i) => ({
            id: i.id,
            type: i.incidentType,
            status: i.status,
            created: new Date(i.createdAt).toLocaleString(),
            description: i.description.length > 80 ? `${i.description.slice(0, 80)}…` : i.description
          }))}
          rowKey={(r) => r.id}
          emptyMessage={loading ? "Loading…" : "No incidents reported."}
        />

        <UniversalOpsQuickLinks excludePath="operations/incidents" />
      </UniversalOpsShell>

      <Modal
        open={modalOpen}
        title="Report incident"
        subtitle="Describe what happened for manager review."
        onClose={closeModal}
        panelClassName="modal-panel--narrow"
        footer={
          <div className="modal-footer-actions">
            <button type="button" className="button secondary" onClick={closeModal}>
              Cancel
            </button>
            <button type="submit" form="incident-report-form" className="button primary" disabled={actionBusy}>
              {actionBusy ? "Submitting…" : "Submit report"}
            </button>
          </div>
        }
      >
        <form id="incident-report-form" className="stack-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Incident type</span>
            <select value={incidentType} onChange={(e) => setIncidentType(e.target.value)}>
              {INCIDENT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Description</span>
            <textarea
              rows={5}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What happened, when, and who was involved?"
              required
            />
          </label>
        </form>
      </Modal>
    </>
  );
}
