import { useMemo, useState } from "react";
import type { Customer } from "../../app/api";
import { RegistrationModal } from "../RegistrationModal";
import { useFieldAgentCapabilities } from "../hooks/useFieldAgentCapabilities";
import { formatNextOfKin } from "../../lib/formatNextOfKin";
import { formatFieldAgent } from "../../lib/formatFieldAgent";
import { useAgentCustomerStore } from "../stores/agentCustomerStore";

type Props = {
  onQueueChange: () => void;
};

export function AgentRegisterPage({ onQueueChange }: Props) {
  const { canRegisterCustomers } = useFieldAgentCapabilities();
  const [open, setOpen] = useState(false);
  const [resubmitCustomer, setResubmitCustomer] = useState<Customer | null>(null);
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
        {canRegisterCustomers ? (
          <button type="button" className="button" onClick={() => setOpen(true)}>
            + New
          </button>
        ) : null}
      </div>

      {status ? <p className="muted">{status}</p> : null}

      <div className="agent-list">
        {registrations.length === 0 ? (
          <p className="muted">
            {canRegisterCustomers
              ? "No submissions yet. Tap + New to register a customer."
              : "Customer registration is disabled by your company admin."}
          </p>
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
              {c.rejectionReason ? (
                <p className="muted">
                  <strong>Coordinator note:</strong> {c.rejectionReason}
                </p>
              ) : null}
              {c.status === "rejected" ? (
                <div className="agent-customer-card-actions">
                  <button
                    type="button"
                    className="button btn-sm"
                    onClick={() => setResubmitCustomer(c)}
                  >
                    Fix &amp; resubmit
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      {canRegisterCustomers ? (
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
      ) : null}

      <RegistrationModal
        open={resubmitCustomer !== null}
        editCustomer={resubmitCustomer}
        onClose={() => setResubmitCustomer(null)}
        onSubmitted={(customer) => {
          onQueueChange();
          if (customer) {
            mergeCustomer(customer);
          } else {
            void refreshSilent();
          }
          setResubmitCustomer(null);
        }}
      />
    </div>
  );
}
