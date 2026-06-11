import { FormEvent, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { AdminDataTable, filterRowsBySearch } from "../../../components/AdminDataTable";
import { useToast } from "../../../components/Toast";
import { useHrDeskStore } from "../../stores/hrDeskStore";
import { HrSectionShell } from "./HrSectionShell";

type Props = { displayName?: string; canManage: boolean };

export function HrTrainingPage({ displayName, canManage }: Props) {
  const { showToast } = useToast();
  const [userId, setUserId] = useState("");
  const [trainingTitle, setTrainingTitle] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [search, setSearch] = useState("");

  const {
    rows,
    users,
    loading,
    error,
    lastFetchedAt,
    hydrateTraining,
    refreshTraining,
    addTraining,
    startLiveSync,
    stopLiveSync
  } = useHrDeskStore(
    useShallow((s) => ({
      rows: s.trainingRows,
      users: s.users,
      loading: s.trainingLoading,
      error: s.trainingError,
      lastFetchedAt: s.lastTrainingAt,
      hydrateTraining: s.hydrateTraining,
      refreshTraining: s.refreshTraining,
      addTraining: s.addTraining,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrateTraining({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrateTraining, startLiveSync, stopLiveSync]);

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
    if (!userId || !trainingTitle.trim()) {
      return;
    }
    try {
      await addTraining({
        userId,
        trainingTitle: trainingTitle.trim(),
        expiresOn: expiresOn || undefined
      });
      showToast("Training record added", "success");
      setTrainingTitle("");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <HrSectionShell
      title="Training & compliance"
      subtitle="Track mandatory training, renewals, and compliance deadlines."
      displayName={displayName}
      loading={loading && rows.length === 0}
      error={error}
      updatedLabel={updatedLabel}
      onRefresh={() => void refreshTraining()}
      refreshing={loading}
    >
      {canManage ? (
        <form className="card stack-form" onSubmit={handleSubmit}>
          <h3>Add training record</h3>
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
            <span>Training title</span>
            <input value={trainingTitle} onChange={(e) => setTrainingTitle(e.target.value)} required />
          </label>
          <label className="field">
            <span>Renew by (optional)</span>
            <input type="date" value={expiresOn} onChange={(e) => setExpiresOn(e.target.value)} />
          </label>
          <button type="submit" className="button primary">
            Add record
          </button>
        </form>
      ) : null}

      <AdminDataTable
        variant="desk"
        title="Training & compliance records"
        subtitle="Mandatory courses, renewals, and expiry tracking."
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search employee, training, status…"
        columns={[
          { key: "userName", label: "Employee" },
          { key: "trainingTitle", label: "Training" },
          { key: "status", label: "Status" },
          { key: "completedOn", label: "Completed" },
          { key: "expiresOn", label: "Expires" }
        ]}
        rows={filterRowsBySearch(
          rows.map((r) => ({
            id: r.id,
            userName: r.userName ?? r.userId,
            trainingTitle: r.trainingTitle,
            status: r.status,
            completedOn: r.completedOn ?? "—",
            expiresOn: r.expiresOn ?? "—"
          })),
          search,
          ["userName", "trainingTitle", "status"]
        )}
        rowKey={(r) => r.id}
        emptyMessage={loading ? "Loading…" : "No training records yet."}
      />
    </HrSectionShell>
  );
}
