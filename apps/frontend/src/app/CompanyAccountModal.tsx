import { FormEvent, useEffect, useState } from "react";
import type { TenantBankProduct } from "@bms/shared";
import { COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT } from "@bms/shared";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useBankProductsStore } from "./stores/bankProductsStore";
import { useBranchesStore } from "./stores/branchesStore";

const BANK_TYPES = [
  "Ecobank",
  "GCB Bank",
  "Fidelity Bank",
  "Absa Bank",
  "Stanbic Bank",
  "Zenith Bank",
  "CalBank",
  "UBA",
  "Access Bank",
  "Other"
] as const;

type Mode = "create" | "edit";

type Props = {
  open: boolean;
  mode: Mode;
  product: TenantBankProduct | null;
  onClose: () => void;
  onSaved: () => void;
};

export function CompanyAccountModal({ open, mode, product, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const branches = useBranchesStore((s) => s.branches);
  const createCompanyAccount = useBankProductsStore((s) => s.createCompanyAccount);
  const updateProduct = useBankProductsStore((s) => s.updateProduct);
  const branchFilter = useBankProductsStore((s) => s.branchFilter);
  const saving = useBankProductsStore((s) => s.saving);

  const activeBranches = branches.filter((b) => b.status === "active");

  const [accountName, setAccountName] = useState("");
  const [bankType, setBankType] = useState<string>(BANK_TYPES[0]);
  const [customBankType, setCustomBankType] = useState("");
  const [accountLimit, setAccountLimit] = useState(String(COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT));
  const [branchId, setBranchId] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }
    if (mode === "edit" && product) {
      setAccountName(product.name);
      const known = BANK_TYPES.includes(product.bankLabel as (typeof BANK_TYPES)[number]);
      if (known) {
        setBankType(product.bankLabel);
        setCustomBankType("");
      } else {
        setBankType("Other");
        setCustomBankType(product.bankLabel);
      }
      setAccountLimit(
        String(product.executionLimitAmount ?? COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT)
      );
      setBranchId(product.branchId ?? "");
    } else {
      setAccountName("");
      setBankType(BANK_TYPES[0]);
      setCustomBankType("");
      setAccountLimit(String(COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT));
      const preferred =
        branchFilter && activeBranches.some((b) => b.id === branchFilter)
          ? branchFilter
          : activeBranches[0]?.id ?? "";
      setBranchId(preferred);
    }
  }, [open, mode, product, branchFilter, activeBranches]);

  const resolvedBankLabel = bankType === "Other" ? customBankType.trim() : bankType;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!accountName.trim()) {
      showToast("Account name is required", "error");
      return;
    }
    if (!resolvedBankLabel) {
      showToast("Bank type is required", "error");
      return;
    }
    if (!branchId) {
      showToast("Select a branch for this company account", "error");
      return;
    }
    const limit = Number(accountLimit);
    if (!Number.isFinite(limit) || limit <= 0) {
      showToast("Account limit must be greater than zero", "error");
      return;
    }

    try {
      if (mode === "create") {
        await createCompanyAccount({
          name: accountName.trim(),
          bankLabel: resolvedBankLabel,
          executionLimitAmount: limit,
          branchId
        });
        showToast("Company account created", "success");
      } else if (product) {
        await updateProduct(product.id, {
          name: accountName.trim(),
          bankLabel: resolvedBankLabel,
          executionLimitAmount: limit,
          branchId,
          isCompanyBankAccount: true
        });
        showToast("Company account updated", "success");
      }
      onSaved();
      onClose();
    } catch (err) {
      showToast(toUserFacingError(err, "Save failed"), "error");
    }
  }

  return (
    <Modal
      open={open}
      title={mode === "create" ? "Add company account" : "Edit company account"}
      subtitle="Settlement account the back officer uses at the partner bank — separate from teller deposit products."
      onClose={onClose}
      panelClassName="modal-panel--narrow"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="company-account-form" className="button primary" disabled={saving}>
            {saving ? "Saving…" : mode === "create" ? "Create account" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="company-account-form" className="stack-form company-account-form" onSubmit={handleSubmit}>
        <label className="field">
          <span>Branch</span>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} required>
            <option value="">Select branch…</option>
            {activeBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name} ({branch.code})
              </option>
            ))}
          </select>
          <small className="muted">Deposits at this branch can be executed through this account.</small>
        </label>

        <label className="field">
          <span>Account name</span>
          <input
            value={accountName}
            onChange={(e) => setAccountName(e.target.value)}
            placeholder="e.g. Main Ecobank settlement"
            required
            autoFocus
          />
        </label>

        <label className="field">
          <span>Bank type</span>
          <select value={bankType} onChange={(e) => setBankType(e.target.value)}>
            {BANK_TYPES.map((bank) => (
              <option key={bank} value={bank}>
                {bank}
              </option>
            ))}
          </select>
        </label>

        {bankType === "Other" ? (
          <label className="field">
            <span>Bank name</span>
            <input
              value={customBankType}
              onChange={(e) => setCustomBankType(e.target.value)}
              placeholder="Enter bank name"
              required
            />
          </label>
        ) : null}

        <label className="field">
          <span>Account limit (GHS)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={accountLimit}
            onChange={(e) => setAccountLimit(e.target.value)}
            required
          />
          <small className="muted">
            Daily execution cap (default GHS {COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT.toLocaleString()}).
          </small>
        </label>
      </form>
    </Modal>
  );
}
