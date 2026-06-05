import { useMemo, useState } from "react";
import type { Customer } from "../../app/api";
import { RegistrationModal } from "../RegistrationModal";
import { formatNextOfKin } from "../../lib/formatNextOfKin";
import { formatFieldAgent } from "../../lib/formatFieldAgent";
import { useAgentCustomerStore } from "../stores/agentCustomerStore";

type Props = {
  onQueueChange: () => void;
};

export function AgentRegisterPage({ onQueueChange }: Props) {
  const [open, setOpen] = useState(false);
  const customers = useAgentCustomerStore((s) => s.customers);
  const hydrated = useAgentCustomerStore((s) => s.hydrated);
  const error = useAgentCustomerStore((s) => s.error);
  const mergeCustomer = useAgentCustomerStore((s) => s.mergeCustomer);
  const refreshSilent = useAgentCustomerStore((s) => s.refreshSilent);

  const registrations = useMemo(
    () =>
      customers.filter((c) => c.status === "pending_activation" || c.status === "rejected"),
    [customers]
  );

  const status = error ?? (hydrated ? "" : "Loading…");

  return (
    <div className="agent-page">
      <div className="agent-page-head">
        <h2>Registrations</h2>
        <button type="button" className="button" onClick={() => setOpen(true)}>
          + New
        </button>
      </div>

      {status ? <p className="muted">{status}</p> : null}

      <div className="agent-list">
        {registrations.length === 0 ? (
          <p className="muted">No submissions yet. Tap + New to register a customer.</p>
        ) : (
          registrations.map((c) => (
            <article className="agent-list-item" key={c.id}>
              <strong>{c.fullName}</strong>
              <span className={`status-pill status-pill--${c.status === "pending_activation" ? "pending" : "inactive"}`}>
                {c.status === "pending_activation" ? "Pending approval" : "Rejected"}
              </span>
              <p className="muted">
                {c.phone} · {c.location ?? "—"}
                {c.houseNumber ? ` · House ${c.houseNumber}` : ""}
              </p>
              <p className="muted">Submitted by: {formatFieldAgent(c)}</p>
              <p className="muted">Next of kin: {formatNextOfKin(c.nextOfKin)}</p>
              {c.accountNumber ? <p className="muted">Account: {c.accountNumber}</p> : null}
              {c.rejectionReason ? <p className="muted">Reason: {c.rejectionReason}</p> : null}
            </article>
          ))
        )}
      </div>

      <RegistrationModal
        open={open}
        onClose={() => setOpen(false)}
        onSubmitted={(customer) => {
          onQueueChange();
          if (customer) {
            mergeCustomer(customer);
          } else {
            void refreshSilent();
          }
        }}
      />
    </div>
  );
}
