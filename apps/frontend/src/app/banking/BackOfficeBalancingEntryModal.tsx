import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { bankProductAppliesToBranch, type OpenBackOfficeDayInput } from "@bms/shared";
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
  const isOpening = mode === "opening";
  const formId = isOpening ? "back-office-opening-form" : "back-office-ecash-form";

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
      setEcashAmount("");
      setEcashNotes("");
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
    setOpeningDraft((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const account of branchAccounts) {
        if (!next[account.id]) {
          next[account.id] = { opening: "", ecash: "0" };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    setEcashAccountId((current) => current || branchAccounts[0]?.id || "");
  }, [open, branchAccounts]);

  useEffect(() => {
    if (!open || isOpening) {
      return;
    }
    const timer = window.setTimeout(() => amountRef.current?.focus(), 40);
    return () => window.clearTimeout(timer);
  }, [open, isOpening, mode]);

  async function handleOpenDay(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!branchId) {
      setFormError("Select a branch.");
      return;
    }
    if (branchAccounts.length === 0) {
      setFormError("No company accounts for this branch.");
      return;
    }
    setSubmitting(true);
    try {
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
    } catch (err) {
      setFormError(toUserFacingError(err, "Could not save opening balances."));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEcash(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!branchId) {
      setFormError("Select a branch.");
      return;
    }
    const parsed = Number(ecashAmount);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setFormError("Enter a valid amount greater than zero.");
      return;
    }
    setSubmitting(true);
    try {
      await onRequestEcash({
        branchId,
        amount: parsed,
        notes: ecashNotes.trim() || undefined,
        bankProductId: ecashAccountId || undefined
      });
      onClose();
    } catch (err) {
      setFormError(toUserFacingError(err, "Ecash request failed."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={isOpening ? "Opening balances" : "Ecash request"}
      subtitle={
        isOpening
          ? `Pick the branch and record each company account balance for ${businessDate}.`
          : "Pick the branch and ask the accountant for extra cash."
      }
      onClose={isBusy ? () => undefined : onClose}
      captureDismiss={!isBusy}
      stacked
      titleId={isOpening ? "back-office-opening-modal-title" : "back-office-ecash-modal-title"}
      panelClassName={
        isOpening ? "modal-panel--back-office modal-panel--back-office-wide" : "modal-panel--back-office"
      }
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={isBusy}>
            Cancel
          </button>
          <button
            type="submit"
            form={formId}
            className="button primary"
            disabled={
              isBusy ||
              !branchId ||
              (isOpening ? branchAccounts.length === 0 : false)
            }
          >
            {isBusy
              ? isOpening
                ? "Saving…"
                : "Sending…"
              : isOpening
                ? "Save & open day"
                : "Send request"}
          </button>
        </>
      }
    >
      {formError ? <p className="error-text">{formError}</p> : null}

      {isOpening ? (
        <form id={formId} className="stack-form" onSubmit={(e) => void handleOpenDay(e)}>
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

          {branchAccounts.length === 0 ? (
            <p className="muted">
              {branchId
                ? "No company accounts for this branch. Add one under Bank Products → Company accounts."
                : "Select a branch to load company accounts."}
            </p>
          ) : (
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
                          disabled={isBusy}
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
                          disabled={isBusy}
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
          )}
        </form>
      ) : (
        <form id={formId} className="stack-form" onSubmit={(e) => void handleEcash(e)}>
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
          {branchAccounts.length > 0 ? (
            <label className="field">
              <span>Company account</span>
              <select
                value={ecashAccountId}
                onChange={(e) => setEcashAccountId(e.target.value)}
                disabled={isBusy}
              >
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
              ref={amountRef}
              type="number"
              min={0.01}
              step={0.01}
              value={ecashAmount}
              onChange={(e) => {
                setEcashAmount(e.target.value);
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
              value={ecashNotes}
              onChange={(e) => setEcashNotes(e.target.value)}
              placeholder="Reason or reference (optional)"
              disabled={isBusy}
            />
          </label>
        </form>
      )}
    </Modal>
  );
}
