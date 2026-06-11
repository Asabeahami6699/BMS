import { FormEvent, useEffect, useMemo, useState } from "react";
import { bankProductAppliesToBranch } from "@bms/shared";
import { Modal } from "../../components/Modal";

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

  const branchAccounts = useMemo(
    () =>
      companyAccounts.filter((account) =>
        branchId ? bankProductAppliesToBranch({ branchId: account.branchId ?? undefined }, branchId) : false
      ),
    [branchId, companyAccounts]
  );

  useEffect(() => {
    if (!open) {
      return;
    }
    const preferred =
      defaultBranchId && defaultBranchId !== "all" && branches.some((b) => b.id === defaultBranchId)
        ? defaultBranchId
        : branches[0]?.id ?? "";
    setBranchId(preferred);
    setAmount("");
    setNotes("");
  }, [open, branches, defaultBranchId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setFromId(branchAccounts[0]?.id ?? "");
    setToId(branchAccounts[1]?.id ?? branchAccounts[0]?.id ?? "");
  }, [open, branchAccounts]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const parsed = Number(amount);
    if (!branchId || !fromId || !toId || fromId === toId || !Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    await onTransfer({
      branchId,
      businessDate,
      fromBankProductId: fromId,
      toBankProductId: toId,
      amount: parsed,
      notes: notes.trim() || undefined
    });
    onClose();
  }

  return (
    <Modal
      open={open}
      title="Agent to agent transfer"
      subtitle="Move ecash between company accounts when a bank daily limit is reached (e.g. Ecobank GHS 1M cap)."
      onClose={onClose}
      panelClassName="modal-panel--back-office"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="back-office-agent-transfer-form"
            className="button primary"
            disabled={busy || !branchId || !fromId || !toId || fromId === toId}
          >
            {busy ? "Transferring…" : "Transfer ecash"}
          </button>
        </>
      }
    >
      <form id="back-office-agent-transfer-form" className="stack-form" onSubmit={(e) => void handleSubmit(e)}>
        <label className="field">
          <span>Branch</span>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
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
          Day must be open with opening balances entered. Transfers ecash on hand from one agent account to another
          before posting deposit entries.
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
              <select value={fromId} onChange={(e) => setFromId(e.target.value)} required>
                {branchAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankLabel} — {account.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>To account</span>
              <select value={toId} onChange={(e) => setToId(e.target.value)} required>
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
                type="number"
                min={0.01}
                step={0.01}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                required
              />
            </label>
            <label className="field">
              <span>Notes</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Reason or reference (optional)"
              />
            </label>
          </>
        )}
      </form>
    </Modal>
  );
}
