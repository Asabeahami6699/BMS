import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { bankProductAppliesToBranch } from "@bms/shared";
import { Modal } from "../../components/Modal";
import { toUserFacingError } from "../../lib/networkError";

type BranchOption = { id: string; name: string; code?: string };

type CompanyAccount = {
  id: string;
  name: string;
  bankLabel: string;
  branchId?: string | null;
  branchName?: string;
};

type Props = {
  open: boolean;
  busy?: boolean;
  businessDate: string;
  branches: BranchOption[];
  companyAccounts: CompanyAccount[];
  defaultBranchId?: string;
  onClose: () => void;
  onTransfer: (payload: {
    branchId: string;
    businessDate: string;
    fromBankProductId: string;
    toBankProductId: string;
    amount: number;
    notes?: string;
  }) => Promise<void>;
};

export function BackOfficeAgentTransferModal({
  open,
  busy,
  businessDate,
  branches,
  companyAccounts,
  defaultBranchId,
  onClose,
  onTransfer
}: Props) {
  const [branchId, setBranchId] = useState("");
  const [fromId, setFromId] = useState("");
  const [toId, setToId] = useState("");
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const seededRef = useRef(false);
  const amountRef = useRef<HTMLInputElement | null>(null);

  const branchAccounts = useMemo(
    () =>
      companyAccounts.filter((account) =>
        branchId ? bankProductAppliesToBranch({ branchId: account.branchId ?? undefined }, branchId) : false
      ),
    [branchId, companyAccounts]
  );

  const isBusy = Boolean(busy || submitting);

  useEffect(() => {
    if (!open) {
      seededRef.current = false;
      setSubmitting(false);
      setFormError(null);
      return;
    }
    const preferred =
      defaultBranchId && defaultBranchId !== "all" && branches.some((b) => b.id === defaultBranchId)
        ? defaultBranchId
        : branches[0]?.id ?? "";
    if (!seededRef.current) {
      seededRef.current = true;
      setBranchId(preferred);
      setAmount("");
      setNotes("");
      setFormError(null);
      setSubmitting(false);
      return;
    }
    setBranchId((current) => current || preferred);
  }, [open, branches, defaultBranchId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFromId((current) => current || branchAccounts[0]?.id || "");
    setToId((current) => {
      const nextTo = branchAccounts.find((account) => account.id !== (current || branchAccounts[0]?.id))?.id;
      return current && branchAccounts.some((a) => a.id === current)
        ? current
        : nextTo || branchAccounts[1]?.id || branchAccounts[0]?.id || "";
    });
  }, [open, branchAccounts]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const timer = window.setTimeout(() => amountRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open, branchId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const parsed = Number(amount);
    if (!branchId) {
      setFormError("Select a branch.");
      return;
    }
    if (branchAccounts.length < 2) {
      setFormError("Need at least two company accounts for this branch.");
      return;
    }
    if (!fromId || !toId || fromId === toId) {
      setFormError("Choose different from and to accounts.");
      return;
    }
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFormError("Enter a valid amount greater than zero.");
      return;
    }
    setSubmitting(true);
    try {
      await onTransfer({
        branchId,
        businessDate,
        fromBankProductId: fromId,
        toBankProductId: toId,
        amount: parsed,
        notes: notes.trim() || undefined
      });
      onClose();
    } catch (err) {
      setFormError(toUserFacingError(err, "Transfer failed."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Agent to agent transfer"
      subtitle="Move ecash between company accounts when a bank daily limit is reached (e.g. Ecobank GHS 1M cap)."
      onClose={isBusy ? () => undefined : onClose}
      captureDismiss={!isBusy}
      stacked
      titleId="back-office-agent-transfer-modal-title"
      panelClassName="modal-panel--back-office"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </button>
          <button
            type="submit"
            form="back-office-agent-transfer-form"
            className="button primary"
            disabled={isBusy || !branchId || !fromId || !toId || fromId === toId || branchAccounts.length < 2}
          >
            {isBusy ? "Transferring…" : "Transfer ecash"}
          </button>
        </>
      }
    >
      {formError ? <p className="error-text">{formError}</p> : null}

      <form
        id="back-office-agent-transfer-form"
        className="stack-form"
        onSubmit={(e) => void handleSubmit(e)}
      >
        <label className="field">
          <span>Branch</span>
          <select
            value={branchId}
            onChange={(e) => {
              setBranchId(e.target.value);
              setFormError(null);
            }}
            required
            disabled={isBusy}
          >
            <option value="">Select branch…</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
                {branch.code ? ` (${branch.code})` : ""}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Day must be open with opening balances entered. Transfers ecash on hand from one agent
          account to another before posting deposit entries.
        </p>
        {branchAccounts.length < 2 ? (
          <p className="muted">
            {branchId
              ? "Need at least two company accounts for this branch."
              : "Select a branch to load company accounts."}
          </p>
        ) : (
          <>
            <label className="field">
              <span>From account</span>
              <select
                value={fromId}
                onChange={(e) => {
                  setFromId(e.target.value);
                  setFormError(null);
                }}
                required
                disabled={isBusy}
              >
                {branchAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankLabel} — {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>To account</span>
              <select
                value={toId}
                onChange={(e) => {
                  setToId(e.target.value);
                  setFormError(null);
                }}
                required
                disabled={isBusy}
              >
                {branchAccounts
                  .filter((account) => account.id !== fromId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.bankLabel} — {account.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="field">
              <span>Amount (GHS)</span>
              <input
                ref={amountRef}
                type="number"
                min={0.01}
                step={0.01}
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setFormError(null);
                }}
                placeholder="0.00"
                required
                disabled={isBusy}
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason or reference (optional)"
                disabled={isBusy}
              />
            </label>
          </>
        )}
      </form>
    </Modal>
  );
}
