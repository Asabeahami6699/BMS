import { useMemo, useState } from "react";
import type { Customer } from "./api";
import { RegistrationReviewModal } from "./RegistrationReviewModal";
import { useCoordinatorLiveSync } from "./hooks/useCoordinatorLiveSync";
import { useCoordinatorStore } from "./stores/coordinatorStore";
import { formatFieldAgent } from "../lib/formatFieldAgent";
import { formatNextOfKin } from "../lib/formatNextOfKin";

export function PendingApprovalsCard() {
  useCoordinatorLiveSync();
  const pending = useCoordinatorStore((s) => s.pendingRegistrations);
  const branches = useCoordinatorStore((s) => s.branches);
  const loading = useCoordinatorStore((s) => s.loading);
  const [reviewCustomer, setReviewCustomer] = useState<Customer | null>(null);

  const branchById = useMemo(() => new Map(branches.map((b) => [b.id, b])), [branches]);

  function branchLabel(customer: Customer): string | undefined {
    const branch = branchById.get(customer.homeBranchId);
    return branch ? `${branch.name} (${branch.code})` : undefined;
  }

  return (
    <>
      <article className="card">
        <h2>Pending registrations</h2>
        <p className="muted">
          Review full details from field agents. Account numbers are assigned when you approve.
        </p>
        {loading && pending.length === 0 ? <p className="muted">Loading…</p> : null}
        <div className="lines">
          {pending.length === 0 && !loading ? (
            <p className="muted">No pending registrations.</p>
          ) : (
            pending.map((c) => (
              <div className="line tenant-line" key={c.id}>
                <div>
                  <strong>{c.fullName}</strong>
                  <small>
                    {c.phone} · {c.accountType?.replace(/_/g, " ") ?? "—"} · {c.location ?? "—"}
                    {c.houseNumber ? ` · House ${c.houseNumber}` : ""}
                  </small>
                  <small>Field agent: {formatFieldAgent(c)}</small>
                  <small>Next of kin: {formatNextOfKin(c.nextOfKin)}</small>
                </div>
                <div className="platform-actions-buttons">
                  <button type="button" className="button" onClick={() => setReviewCustomer(c)}>
                    Review
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </article>

      <RegistrationReviewModal
        open={reviewCustomer !== null}
        customer={reviewCustomer}
        agentLabel={reviewCustomer ? formatFieldAgent(reviewCustomer) : undefined}
        branchLabel={reviewCustomer ? branchLabel(reviewCustomer) : undefined}
        onClose={() => setReviewCustomer(null)}
        onDecided={() => {
          if (reviewCustomer) {
            useCoordinatorStore.getState().removePendingRegistration(reviewCustomer.id);
          }
          void useCoordinatorStore.getState().refreshSilent();
        }}
      />
    </>
  );
}
