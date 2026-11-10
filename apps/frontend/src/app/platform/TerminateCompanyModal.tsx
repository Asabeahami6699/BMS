import { FormEvent, useEffect, useState } from "react";
import type { TenantRecord } from "../api";
import { terminatePlatformTenant } from "../api";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";

type Props = {
  open: boolean;
  tenant: TenantRecord | null;
  onClose: () => void;
  onTerminated: () => void;
};

export function TerminateCompanyModal({ open, tenant, onClose, onTerminated }: Props) {
  const { showToast } = useToast();
  const [confirmName, setConfirmName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setConfirmName("");
    }
  }, [open, tenant?.id]);

  const nameMatches =
    Boolean(tenant) &&
    confirmName.trim().toLowerCase() === (tenant?.name ?? "").trim().toLowerCase();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!tenant || !nameMatches || busy) {
      return;
    }
    setBusy(true);
    try {
      const result = await terminatePlatformTenant(tenant.id, confirmName.trim());
      showToast(
        `Terminated ${result.name}${
          result.deletedRows != null ? ` · ${result.deletedRows} rows removed` : ""
        }`,
        "success"
      );
      onTerminated();
      onClose();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not terminate company"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open && tenant != null}
      title={tenant ? `Terminate ${tenant.name}` : "Terminate company"}
      subtitle="This permanently removes the company and all related data. It cannot be undone."
      onClose={busy ? () => undefined : onClose}
      panelClassName="modal-panel--sm"
      footer={
        <>
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="terminate-company-form"
            className="button button--danger"
            disabled={busy || !nameMatches}
          >
            {busy ? "Terminating…" : "Terminate company"}
          </button>
        </>
      }
    >
      {tenant ? (
        <form id="terminate-company-form" className="terminate-company" onSubmit={(e) => void handleSubmit(e)}>
          <p>
            All customers, ledgers, loans, users, and settings for <strong>{tenant.name}</strong> will
            be deleted from the system.
          </p>
          <label className="field">
            <span>
              Type <strong>{tenant.name}</strong> to confirm
            </span>
            <input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={tenant.name}
              autoComplete="off"
              disabled={busy}
              required
            />
          </label>
        </form>
      ) : null}
    </Modal>
  );
}
