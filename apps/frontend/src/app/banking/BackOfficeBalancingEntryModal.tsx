import { FormEvent, useEffect, useMemo, useState } from "react";
import { bankProductAppliesToBranch, type OpenBackOfficeDayInput } from "@bms/shared";
import { Modal } from "../../components/Modal";

type BranchOption = { id: string; name: string; code?: string };

type CompanyAccount = {
  id: string;
  name: string;
  bankLabel: string;
  branchId?: string | null;
  branchName?: string;
};

export type BalancingEntryMode = "opening" | "ecash";

type Props = {
  open: boolean;
  mode: BalancingEntryMode;
  busy?: boolean;
  businessDate: string;
  branches: BranchOption[];
  companyAccounts: CompanyAccount[];
  defaultBranchId?: string;
  onClose: () => void;
  onOpenDay: (payload: OpenBackOfficeDayInput) => Promise<void>;
  onRequestEcash: (payload: {
    branchId: string;
    amount: number;
    notes?: string;
    bankProductId?: string;
  }) => Promise<void>;
};

export function BackOfficeBalancingEntryModal({
  open,
  mode,
  busy,
  businessDate,
  branches,
  companyAccounts,
  defaultBranchId,
  onClose,
  onOpenDay,
  onRequestEcash
}: Props) {
  const [branchId, setBranchId] = useState("");
  const [openingDraft, setOpeningDraft] = useState<Record<string, { opening: string; ecash: string }>>(
    {}
  );
  const [ecashAmount, setEcashAmount] = useState("");
  const [ecashNotes, setEcashNotes] = useState("");
  const [ecashAccountId, setEcashAccountId] = useState("");

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
    setEcashAmount("");
    setEcashNotes("");
  }, [open, branches, defaultBranchId]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const next: Record<string, { opening: string; ecash: string }> = {};
    for (const account of branchAccounts) {
      next[account.id] = { opening: "", ecash: "0" };
    }
    setOpeningDraft(next);
    setEcashAccountId(branchAccounts[0]?.id ?? "");
  }, [open, branchAccounts]);

  async function handleOpenDay(event: FormEvent) {
    event.preventDefault();
    if (!branchId) {
      return;
    }
    await onOpenDay({
      branchId,
      businessDate,
      openings: branchAccounts.map((account) => ({
        bankProductId: account.id,
        openingBalance: Number(openingDraft[account.id]?.opening ?? 0),
        extraCash: Number(openingDraft[account.id]?.ecash ?? 0)
      }))
    });
    onClose();
  }

  async function handleEcash(event: FormEvent) {
    event.preventDefault();
    if (!branchId) {
      return;
    }
    const parsed = Number(ecashAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return;
    }
    await onRequestEcash({
      branchId,
      amount: parsed,
      notes: ecashNotes.trim() || undefined,
      bankProductId: ecashAccountId || undefined
    });
    onClose();
  }

  const isOpening = mode === "opening";

  return (
    <Modal
      open={open}
      title={isOpening ? "Opening balances" : "Ecash request"}
      subtitle={
        isOpening
          ? `Pick the branch and record each company account balance for ${businessDate}.`
          : "Pick the branch and ask the accountant for extra cash."
      }
      onClose={onClose}
      panelClassName="modal-panel--back-office"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          {isOpening ? (
            <button
              type="submit"
              form="back-office-opening-form"
              className="button primary"
              disabled={busy || !branchId || branchAccounts.length === 0}
            >
              {busy ? "Saving…" : "Save & open day"}
            </button>
          ) : (
            <button
              type="submit"
              form="back-office-ecash-form"
              className="button primary"
              disabled={busy || !branchId}
            >
              {busy ? "Sending…" : "Send request"}
            </button>
          )}
        </>
      }
    >
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

      {isOpening ? (
        branchAccounts.length === 0 ? (
          <p className="muted">
            {branchId
              ? "No company accounts for this branch. Add one under Bank Products → Company accounts."
              : "Select a branch to load company accounts."}
          </p>
        ) : (
          <form id="back-office-opening-form" onSubmit={(e) => void handleOpenDay(e)}>
            <div className="agency-deposit-table-wrap">
              <table className="agency-deposit-table back-office-balancing-entry-table">
                <thead>
                  <tr>
                    <th>Company account</th>
                    <th className="agency-deposit-table__num">Opening (GHS)</th>
                    <th className="agency-deposit-table__num">Ecash on hand (GHS)</th>
                  </tr>
                </thead>
                <tbody>
                  {branchAccounts.map((account) => (
                    <tr key={account.id} className="agency-deposit-table__row">
                      <td>
                        <strong>{account.bankLabel}</strong>
                        <span className="muted agency-deposit-table__account">
                          {account.name}
                          {account.branchName ? ` · ${account.branchName}` : ""}
                        </span>
                      </td>
                      <td className="agency-deposit-table__num">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="back-office-balancing-input"
                          value={openingDraft[account.id]?.opening ?? ""}
                          onChange={(e) =>
                            setOpeningDraft((prev) => ({
                              ...prev,
                              [account.id]: {
                                opening: e.target.value,
                                ecash: prev[account.id]?.ecash ?? "0"
                              }
                            }))
                          }
                          placeholder="0.00"
                          required
                        />
                      </td>
                      <td className="agency-deposit-table__num">
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          className="back-office-balancing-input"
                          value={openingDraft[account.id]?.ecash ?? "0"}
                          onChange={(e) =>
                            setOpeningDraft((prev) => ({
                              ...prev,
                              [account.id]: {
                                opening: prev[account.id]?.opening ?? "",
                                ecash: e.target.value
                              }
                            }))
                          }
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </form>
        )
      ) : (
        <form id="back-office-ecash-form" className="stack-form" onSubmit={(e) => void handleEcash(e)}>
          {branchAccounts.length > 0 ? (
            <label className="field">
              <span>Company account</span>
              <select value={ecashAccountId} onChange={(e) => setEcashAccountId(e.target.value)}>
                <option value="">Any / general request</option>
                {branchAccounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.bankLabel} — {account.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="field">
            <span>Amount (GHS)</span>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={ecashAmount}
              onChange={(e) => setEcashAmount(e.target.value)}
              placeholder="0.00"
              required
              autoFocus
            />
          </label>
          <label className="field">
            <span>Notes</span>
            <input
              type="text"
              value={ecashNotes}
              onChange={(e) => setEcashNotes(e.target.value)}
              placeholder="Reason or reference (optional)"
            />
          </label>
        </form>
      )}
    </Modal>
  );
}
