import { useMemo, useState } from "react";
import { isManualPartnerWithdrawal } from "@bms/shared";

import { Link } from "react-router-dom";

import { useShallow } from "zustand/react/shallow";

import { useToast } from "../../components/Toast";

import { toUserFacingError } from "../../lib/networkError";

import { useAuth } from "../../auth/AuthContext";

import { useRoleWorkspaceSync } from "../hooks/useRoleWorkspaceSync";

import { formatWorkspaceMoney, useRoleWorkspaceStore } from "../stores/roleWorkspaceStore";
import { useTellerReconciliationStore } from "../stores/tellerReconciliationStore";

import { getRoleDeskConfig } from "./roleDeskConfig";

import { RoleDeskShell } from "./RoleDeskShell";

import { TellerReconciliationWorkbench } from "./TellerReconciliationWorkbench";
import { TellerPayoutDetailModal, type TellerPayoutRow } from "./TellerPayoutDetailModal";



type Props = { displayName?: string };



export function TellerDeskPage({ displayName }: Props) {

  const config = getRoleDeskConfig("teller");

  const { user } = useAuth();

  const { showToast } = useToast();

  useRoleWorkspaceSync("teller");



  const { agency, loading, busyId, error, lastFetchedAt, payWithdrawal, refresh } = useRoleWorkspaceStore(

    useShallow((s) => ({

      agency: s.agency,

      loading: s.loading,

      busyId: s.busyId,

      error: s.error,

      lastFetchedAt: s.lastFetchedAt,

      payWithdrawal: s.payWithdrawal,

      refresh: s.refresh

    }))

  );



  const queue = agency?.queue;

  const payouts = (agency?.withdrawalsPendingTeller ?? []) as TellerPayoutRow[];
  const [payoutDetail, setPayoutDetail] = useState<TellerPayoutRow | null>(null);



  const kpis = useMemo(

    () => [

      { label: "Ready to pay", value: queue?.withdrawalsPendingTeller ?? 0, tone: "success" as const },

      { label: "Awaiting back office", value: queue?.depositsPendingBank ?? 0, tone: "warning" as const },

      { label: "CS verification queue", value: queue?.withdrawalsPendingCs ?? 0, tone: "primary" as const }

    ],

    [queue]

  );



  const updatedLabel = lastFetchedAt

    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`

    : undefined;



  const refreshReconciliation = useTellerReconciliationStore((s) => s.refreshSilent);

  async function handlePay(disclosureId: string) {
    try {
      await payWithdrawal(disclosureId);
      setPayoutDetail(null);
      void refreshReconciliation();
      showToast("Cash paid — withdrawal completed", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Payout failed"), "error");
    }
  }



  return (

    <RoleDeskShell

      config={config}

      displayName={displayName}

      updatedLabel={updatedLabel}

      error={error}

      loading={loading && !agency}

      kpis={agency || loading ? kpis : undefined}

      onRefresh={() => void refresh()}

      refreshing={loading}

    >

      <section className="card role-workspace__panel">

        <header className="role-workspace__panel-head">

          <div>

            <h3>Cash payout queue</h3>

            <p className="muted">
              Confirm withdrawal details and pay cash. Walk-in requests arrive here directly after CS
              initiation; BMS members appear after CS verification.
            </p>

          </div>

        </header>



        {payouts.length === 0 ? (

          <p className="muted role-workspace__empty">No withdrawals ready for cash payout.</p>

        ) : (

          <div className="role-workspace__queue">

            {payouts.map((row, index) => {
              const amount = Number(row.withdrawalAmount ?? 0);
              const customerName = String(row.customerName ?? row.id);
              const requestedAt = row.requestedAt
                ? new Date(row.requestedAt).toLocaleString()
                : "—";
              const workflow = row.workflowData;
              const partnerAccount =
                typeof workflow?.account_number === "string" ? workflow.account_number : null;
              const customerCategory = isManualPartnerWithdrawal(row)
                ? "Non-BMS walk-in"
                : "BMS member";

              return (
                <article
                  key={row.id}
                  className="role-workspace__queue-row role-workspace__queue-row--payout"
                  style={{ animationDelay: `${index * 0.05}s` }}
                >
                  <div className="role-workspace__queue-body">
                    <div className="role-workspace__queue-main">
                      <strong>{customerName}</strong>
                      <span className="role-workspace__queue-amount">
                        {formatWorkspaceMoney(amount)}
                      </span>
                    </div>
                    <div className="role-workspace__queue-meta muted">
                      <span className="role-workspace__pill">Withdrawal</span>
                      <span className="role-workspace__pill">{customerCategory}</span>
                      {partnerAccount ? (
                        <span className="role-workspace__pill">Acct {partnerAccount}</span>
                      ) : null}
                      <span>{requestedAt}</span>
                    </div>
                  </div>
                  <div className="role-workspace__queue-actions">
                    <button
                      type="button"
                      className="button secondary"
                      disabled={busyId === row.id}
                      onClick={() => setPayoutDetail(row)}
                    >
                      View details
                    </button>
                    <button
                      type="button"
                      className="btn primary"
                      disabled={busyId === row.id}
                      onClick={() => setPayoutDetail(row)}
                    >
                      Pay cash
                    </button>
                  </div>
                </article>
              );
            })}

          </div>

        )}

      </section>



      <section className="card role-workspace__panel">

        <header className="role-workspace__panel-head">

          <div>

            <h3>Today&apos;s reconciliation</h3>

            <p className="muted">Opening, deposits, withdrawals, closing, and difference.</p>

          </div>

          <Link to="/app/banking/reconciliation" className="button secondary">

            Full view →

          </Link>

        </header>

        <TellerReconciliationWorkbench compact fallbackBranchId={user?.branchId} />

      </section>

      <TellerPayoutDetailModal
        open={payoutDetail != null}
        row={payoutDetail}
        busy={payoutDetail != null && busyId === payoutDetail.id}
        onClose={() => setPayoutDetail(null)}
        onPay={() => {
          if (payoutDetail) {
            void handlePay(payoutDetail.id);
          }
        }}
      />
    </RoleDeskShell>
  );
}


