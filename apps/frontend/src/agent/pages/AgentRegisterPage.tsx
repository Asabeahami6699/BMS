import { useMemo, useState } from "react";
import { discardRejectedCustomerRegistration, type Customer } from "../../app/api";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { RegistrationModal } from "../RegistrationModal";
import { useFieldAgentCapabilities } from "../hooks/useFieldAgentCapabilities";
import { formatNextOfKin } from "../../lib/formatNextOfKin";
import { formatFieldAgent } from "../../lib/formatFieldAgent";
import { useAgentCustomerStore } from "../stores/agentCustomerStore";

type Props = {
  onQueueChange: () => void;
};

export function AgentRegisterPage({ onQueueChange }: Props) {
  const { showToast } = useToast();
  const { canRegisterCustomers } = useFieldAgentCapabilities();
  const [open, setOpen] = useState(false);
  const [resubmitCustomer, setResubmitCustomer] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [deleting, setDeleting] = useState(false);
  const customers = useAgentCustomerStore((s) => s.customers);
  const hydrated = useAgentCustomerStore((s) => s.hydrated);
  const error = useAgentCustomerStore((s) => s.error);
  const mergeCustomer = useAgentCustomerStore((s) => s.mergeCustomer);
  const removeCustomer = useAgentCustomerStore((s) => s.removeCustomer);
  const refreshSilent = useAgentCustomerStore((s) => s.refreshSilent);

  const registrations = useMemo(
    () =>
      customers.filter((c) => c.status === "pending_activation" || c.status === "rejected"),
    [customers]
  );

  const status = error ?? (hydrated ? "" : "Loading…");

  async function handleConfirmDelete(startFresh: boolean) {
    if (!deleteTarget || deleting) return;
    setDeleting(true);
    try {
      await discardRejectedCustomerRegistration(deleteTarget.id);
      removeCustomer(deleteTarget.id);
      showToast(
        startFresh
          ? `Deleted ${deleteTarget.fullName}'s rejected form — ready for a fresh registration.`
          : `Deleted ${deleteTarget.fullName}'s rejected registration.`,
        "success"
      );
      setDeleteTarget(null);
      if (startFresh && canRegisterCustomers) {
        setOpen(true);
      }
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to delete rejected registration"), "error");
    } finally {
      setDeleting(false);
    }
  }

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
              <span
                className={`status-pill status-pill--${c.status === "pending_activation" ? "pending" : "inactive"}`}
              >
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
                <div className="agent-customer-card-actions" style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
                  <button
                    type="button"
                    className="button btn-sm"
                    onClick={() => setResubmitCustomer(c)}
                  >
                    Fix &amp; resubmit
                  </button>
                  <button
                    type="button"
                    className="button button--danger btn-sm"
                    onClick={() => setDeleteTarget(c)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}
            </article>
          ))
        )}
      </div>

      <Modal
        open={deleteTarget !== null}
        title="Delete rejected registration?"
        subtitle={deleteTarget ? `${deleteTarget.fullName} · ${deleteTarget.phone}` : undefined}
        onClose={() => {
          if (!deleting) setDeleteTarget(null);
        }}
        footer={
          <>
            <button
              type="button"
              className="button secondary"
              disabled={deleting}
              onClick={() => setDeleteTarget(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="button button--danger"
              disabled={deleting}
              onClick={() => void handleConfirmDelete(false)}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
            {canRegisterCustomers ? (
              <button
                type="button"
                className="button"
                disabled={deleting}
                onClick={() => void handleConfirmDelete(true)}
              >
                {deleting ? "Deleting…" : "Delete & start fresh"}
              </button>
            ) : null}
          </>
        }
      >
        <p style={{ marginTop: 0 }}>
          This permanently removes <strong>{deleteTarget?.fullName}</strong>&apos;s rejected
          registration so it will not remain stuck in your list.
        </p>
        {deleteTarget?.rejectionReason ? (
          <p className="muted" style={{ marginBottom: 0 }}>
            <strong>Coordinator note:</strong> {deleteTarget.rejectionReason}
          </p>
        ) : null}
      </Modal>

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
