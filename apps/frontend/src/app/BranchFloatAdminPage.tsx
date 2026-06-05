import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { AppRole, Branch, BranchFloatSession, UserRecord } from "./api";
import {
  allocateBranchFloat,
  listBranchFloatSessions,
  listBranches,
  listPendingBranchFloats,
  listUsers,
  pushBranchFloat,
  settleBranchFloat
} from "./api";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = { role: AppRole };

function formatMoney(n: number): string {
  return `GHS ${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const STATUS_LABEL: Record<BranchFloatSession["status"], string> = {
  requested: "Requested",
  approved: "Approved",
  open: "Open",
  closed: "Closed — awaiting settle",
  settled: "Settled",
  rejected: "Rejected"
};

export function BranchFloatAdminPage({ role }: Props) {
  const { showToast } = useToast();
  const [pending, setPending] = useState<BranchFloatSession[]>([]);
  const [todaySessions, setTodaySessions] = useState<BranchFloatSession[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [allocateAmount, setAllocateAmount] = useState<Record<string, string>>({});
  const [pushBranchId, setPushBranchId] = useState("");
  const [pushUserId, setPushUserId] = useState("");
  const [pushAmount, setPushAmount] = useState("500");

  const counterStaff = useMemo(
    () =>
      users.filter(
        (u) =>
          u.status === "active" &&
          (u.role === "teller" || u.role === "coordinator") &&
          (!pushBranchId || u.branchId === pushBranchId || u.scopeType === "head_office")
      ),
    [users, pushBranchId]
  );

  const userLabel = useCallback(
    (userId: string) => {
      const u = users.find((x) => x.userId === userId);
      return u ? `${u.fullName ?? u.email} (${u.role.replace(/_/g, " ")})` : userId.slice(0, 8) + "…";
    },
    [users]
  );

  const branchLabel = useCallback(
    (branchId: string) => {
      const b = branches.find((x) => x.id === branchId);
      return b ? `${b.name} (${b.code})` : branchId;
    },
    [branches]
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pendingRows, sessions, branchRows, userRows] = await Promise.all([
        listPendingBranchFloats(),
        listBranchFloatSessions({ date: todayIso() }),
        listBranches(),
        listUsers()
      ]);
      setPending(pendingRows);
      setTodaySessions(sessions);
      const activeBranches = branchRows.filter((b) => b.status !== "inactive");
      setBranches(activeBranches);
      setUsers(userRows);
      setPushBranchId((prev) => prev || activeBranches[0]?.id || "");
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to load till float data"), "error");
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleAllocate(session: BranchFloatSession) {
    const amount = Number(allocateAmount[session.id] ?? session.openingFloat);
    setBusy(true);
    try {
      await allocateBranchFloat(session.id, amount);
      showToast("Float released — teller till is open", "success");
      await load();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not release float"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handlePush(e: FormEvent) {
    e.preventDefault();
    if (!pushBranchId || !pushUserId) {
      showToast("Select branch and teller", "error");
      return;
    }
    setBusy(true);
    try {
      await pushBranchFloat({
        branchId: pushBranchId,
        cashierUserId: pushUserId,
        openingFloat: Number(pushAmount)
      });
      showToast("Float pushed — till opened for teller", "success");
      await load();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to push float"), "error");
    } finally {
      setBusy(false);
    }
  }

  async function handleSettle(session: BranchFloatSession) {
    setBusy(true);
    try {
      await settleBranchFloat(session.id);
      showToast("Session settled", "success");
      await load();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to settle"), "error");
    } finally {
      setBusy(false);
    }
  }

  const closedAwaitingSettle = todaySessions.filter((s) => s.status === "closed");

  return (
    <div className="branch-float-admin">
      <header className="overview-hero">
        <div>
          <p className="overview-hero__eyebrow">Susu management</p>
          <h1 className="overview-hero__title">Till float</h1>
          <p className="overview-hero__sub muted">
            Approve teller requests or push opening cash for branch counter staff. Tellers work from{" "}
            <Link to="/app/susu/collections">Branch counter</Link>.
          </p>
        </div>
        <button type="button" className="button secondary" disabled={loading || busy} onClick={() => void load()}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </header>

      {role !== "admin" && role !== "coordinator" ? (
        <p className="muted">Only admin or coordinator can manage till float.</p>
      ) : (
        <>
          <section className="overview-panel branch-float-admin__push">
            <h2 className="overview-panel__title">Push float (no request needed)</h2>
            <p className="overview-panel__lead muted">
              Open a teller&apos;s till for today without waiting for a request — typical start-of-day
              workflow.
            </p>
            <form className="branch-float-admin__push-form" onSubmit={(e) => void handlePush(e)}>
              <label className="field">
                <span>Branch</span>
                <select value={pushBranchId} onChange={(e) => setPushBranchId(e.target.value)} required>
                  <option value="">Select branch</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Teller / coordinator</span>
                <select value={pushUserId} onChange={(e) => setPushUserId(e.target.value)} required>
                  <option value="">Select staff</option>
                  {counterStaff.map((u) => (
                    <option key={u.userId} value={u.userId}>
                      {u.fullName ?? u.email} — {u.role.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Opening float (GHS)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={pushAmount}
                  onChange={(e) => setPushAmount(e.target.value)}
                  required
                />
              </label>
              <button type="submit" className="button" disabled={busy}>
                Push &amp; open till
              </button>
            </form>
          </section>

          <section className="overview-panel">
            <h2 className="overview-panel__title">
              Pending requests
              {pending.length > 0 ? (
                <span className="branch-float-admin__badge">{pending.length}</span>
              ) : null}
            </h2>
            {loading ? (
              <p className="muted">Loading…</p>
            ) : pending.length === 0 ? (
              <p className="muted">No pending float requests right now.</p>
            ) : (
              <ul className="branch-float__pending-list">
                {pending.map((s) => (
                  <li key={s.id} className="branch-float__pending-item">
                    <div>
                      <strong>{userLabel(s.cashierUserId)}</strong>
                      <p className="muted">
                        {branchLabel(s.branchId)} · {s.businessDate} · requested{" "}
                        {formatMoney(s.openingFloat)}
                      </p>
                      {s.requestedNote ? <p className="muted">{s.requestedNote}</p> : null}
                    </div>
                    <div className="branch-float__pending-actions">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="branch-float__allocate-input"
                        value={allocateAmount[s.id] ?? String(s.openingFloat)}
                        onChange={(e) =>
                          setAllocateAmount((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                      />
                      <button
                        type="button"
                        className="button"
                        disabled={busy}
                        onClick={() => void handleAllocate(s)}
                      >
                        Approve &amp; release
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {closedAwaitingSettle.length > 0 ? (
            <section className="overview-panel">
              <h2 className="overview-panel__title">Closed — awaiting settlement</h2>
              <ul className="branch-float__pending-list">
                {closedAwaitingSettle.map((s) => (
                  <li key={s.id} className="branch-float__pending-item">
                    <div>
                      <strong>{userLabel(s.cashierUserId)}</strong>
                      <p className="muted">
                        {branchLabel(s.branchId)} · expected {formatMoney(s.expectedClosing ?? 0)} ·
                        actual {formatMoney(s.actualClosing ?? 0)} · variance{" "}
                        {formatMoney(s.variance ?? 0)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busy}
                      onClick={() => void handleSettle(s)}
                    >
                      Settle
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="overview-panel">
            <h2 className="overview-panel__title">Today&apos;s till sessions</h2>
            {todaySessions.length === 0 ? (
              <p className="muted">No float sessions for today yet.</p>
            ) : (
              <div className="admin-table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Staff</th>
                      <th>Branch</th>
                      <th>Status</th>
                      <th>Opening</th>
                      <th>Expected</th>
                      <th>Variance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todaySessions.map((s) => (
                      <tr key={s.id}>
                        <td>{userLabel(s.cashierUserId)}</td>
                        <td>{branchLabel(s.branchId)}</td>
                        <td>{STATUS_LABEL[s.status]}</td>
                        <td>{formatMoney(s.openingFloat)}</td>
                        <td>
                          {s.status === "open" || s.status === "closed" || s.status === "settled"
                            ? formatMoney(s.expectedClosing ?? 0)
                            : "—"}
                        </td>
                        <td>
                          {s.variance != null ? formatMoney(s.variance) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
