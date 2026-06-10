import { FormEvent, useCallback, useEffect, useState } from "react";
import type { HrTrainingRecord } from "@bms/shared";
import { createHrTraining, listHrTraining, listUsers } from "../../api";
import { AdminDataTable, filterRowsBySearch } from "../../../components/AdminDataTable";
import { useToast } from "../../../components/Toast";
import { HrSectionShell } from "./HrSectionShell";

type Props = { displayName?: string; canManage: boolean };

export function HrTrainingPage({ displayName, canManage }: Props) {
  const { showToast } = useToast();
  const [rows, setRows] = useState<HrTrainingRecord[]>([]);
  const [users, setUsers] = useState<Array<{ userId: string; label: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("");
  const [trainingTitle, setTrainingTitle] = useState("");
  const [expiresOn, setExpiresOn] = useState("");
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [training, staff] = await Promise.all([listHrTraining(), listUsers()]);
      setRows(training);
      setUsers(
        staff.map((u) => ({
          userId: u.userId,
          label: u.fullName ? `${u.fullName} (${u.email})` : u.email
        }))
      );
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to load training", "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!userId || !trainingTitle.trim()) {
      return;
    }
    try {
      await createHrTraining({
        userId,
        trainingTitle: trainingTitle.trim(),
        expiresOn: expiresOn || undefined,
        status: "due"
      });
      showToast("Training record added", "success");
      setTrainingTitle("");
      await load();
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed", "error");
    }
  }

  return (
    <HrSectionShell
      title="Training & compliance"
      subtitle="Track mandatory training, renewals, and compliance deadlines."
      displayName={displayName}
      loading={loading}
      onRefresh={() => void load()}
      refreshing={loading}
    >
      {canManage ? (
        <form className="card stack-form" onSubmit={handleSubmit}>
          <h3>Add training record</h3>
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
