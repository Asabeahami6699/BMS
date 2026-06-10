import { useEffect } from "react";
import { useShallow } from "zustand/react/shallow";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { useBackOfficeStore } from "../stores/backOfficeStore";
import { formatWorkspaceMoney } from "../stores/roleWorkspaceStore";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";

type Props = { displayName?: string };

export function AccountantApprovalsPage({ displayName }: Props) {
  const config = getRoleDeskConfig("accountant");
  const { user } = useAuth();
  const { showToast } = useToast();
  const {
    data,
    loading,
    error,
    busyId,
    lastFetchedAt,
    hydrate,
    refresh,
    approveAccountantDeposit,
    approveEcash,
    startLiveSync,
    stopLiveSync
  } = useBackOfficeStore(
    useShallow((s) => ({
      data: s.data,
      loading: s.loading,
      error: s.error,
      busyId: s.busyId,
      lastFetchedAt: s.lastFetchedAt,
      hydrate: s.hydrate,
      refresh: s.refresh,
      approveAccountantDeposit: s.approveAccountantDeposit,
      approveEcash: s.approveEcash,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    hydrate({
      force: true,
      fallbackBranchId: user?.scopeType === "head_office" ? "all" : user?.branchId
    });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync, user?.branchId, user?.scopeType]);

  const depositQueue = data?.depositQueue ?? [];
  const ecashRequests = data?.ecashRequests ?? [];
  const updatedLabel = lastFetchedAt
    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  return (
    <RoleDeskShell
      config={{ ...config, title: "Accountant approvals", subtitle: "Large deposits and ecash requests." }}
      displayName={displayName}
      updatedLabel={updatedLabel}
      error={error}
      loading={loading && !data}
      onRefresh={() => void refresh()}
      refreshing={loading}
    >
      <section className="card role-workspace__panel role-workspace__panel--accent">
        <h3>Approval queue</h3>
        <p className="muted">Approve or decline before back office can execute at the bank.</p>
        {depositQueue.filter((row) => row.executionStatus === "pending_accountant").length === 0 &&
        ecashRequests.filter((r) => r.status === "pending").length === 0 ? (
          <p className="muted">No items awaiting accountant approval.</p>
        ) : (
          <div className="role-workspace__queue">
            {depositQueue
              .filter((row) => row.executionStatus === "pending_accountant")
              .map((row) => (
                <article key={row.id} className="role-workspace__queue-row">
                  <div className="role-workspace__queue-main">
                    <strong>Large deposit — {row.customerName}</strong>
                    <span>{formatWorkspaceMoney(row.amount)}</span>
                  </div>
                  <button
                    type="button"
                    className="btn primary"
                    disabled={busyId === row.id}
                    onClick={() =>
                      void approveAccountantDeposit(row.id)
                        .then(() => showToast("Deposit approved for back office", "success"))
                        .catch((err) =>
                          showToast(toUserFacingError(err, "Approval failed"), "error")
                        )
                    }
                  >
                    Approve
                  </button>
                </article>
              ))}
            {ecashRequests
              .filter((r) => r.status === "pending")
              .map((r) => (
                <article key={r.id} className="role-workspace__queue-row">
                  <div className="role-workspace__queue-main">
                    <strong>Ecash request</strong>
                    <span>{formatWorkspaceMoney(r.amount)}</span>
                  </div>
                  <div className="role-workspace__queue-actions">
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busyId === r.id}
                      onClick={() =>
                        void approveEcash(r.id, true)
                          .then(() => showToast("Ecash approved", "success"))
                          .catch((err) =>
                            showToast(toUserFacingError(err, "Approval failed"), "error")
                          )
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busyId === r.id}
                      onClick={() =>
                        void approveEcash(r.id, false)
                          .then(() => showToast("Ecash declined", "success"))
                          .catch((err) =>
                            showToast(toUserFacingError(err, "Decline failed"), "error")
                          )
                      }
                    >
                      Decline
                    </button>
                  </div>
                </article>
              ))}
          </div>
        )}
      </section>
    </RoleDeskShell>
  );
}
