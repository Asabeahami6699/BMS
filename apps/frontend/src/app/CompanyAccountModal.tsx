import { FormEvent, useEffect, useState } from "react";
import type { TenantBankProduct } from "@bms/shared";
import { COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT } from "@bms/shared";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useBankProductsStore } from "./stores/bankProductsStore";
import { useBranchesStore } from "./stores/branchesStore";

/** Empty value = company account available at every branch (null branch_id). */
const ALL_BRANCHES = "";

const BANK_TYPES = [
  "Ecobank",
  "GCB",
  "Fidelity",
  "Absa",
  "Stanbic",
  "Zenith",
  "CalBank",
  "UBA",
  "Access",
  "MTN",
  "Other"
] as const;

const LEGACY_BANK_LABELS: Record<string, (typeof BANK_TYPES)[number] | "Other"> = {
  "GCB Bank": "GCB",
  "Fidelity Bank": "Fidelity",
  "Absa Bank": "Absa",
  "Stanbic Bank": "Stanbic",
  "Zenith Bank": "Zenith",
  "Access Bank": "Access"
};

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
      const legacy = LEGACY_BANK_LABELS[product.bankLabel];
      const known = BANK_TYPES.includes(product.bankLabel as (typeof BANK_TYPES)[number]);
      if (known) {
        setBankType(product.bankLabel);
        setCustomBankType("");
      } else if (legacy) {
        setBankType(legacy);
        setCustomBankType("");
      } else {
        setBankType("Other");
        setCustomBankType(product.bankLabel);
      }
      setAccountLimit(
        String(product.executionLimitAmount ?? COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT)
      );
      setBranchId(product.branchId ?? ALL_BRANCHES);
    } else {
      setAccountName("");
      setBankType(BANK_TYPES[0]);
      setCustomBankType("");
      setAccountLimit(String(COMPANY_ACCOUNT_DEFAULT_EXECUTION_LIMIT));
      const preferred =
        branchFilter && activeBranches.some((b) => b.id === branchFilter)
          ? branchFilter
          : ALL_BRANCHES;
      setBranchId(preferred);
    }
  }, [open, mode, product?.id, branchFilter]);

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
          branchId: branchId || null
        });
        showToast("Company account created", "success");
      } else if (product) {
        await updateProduct(product.id, {
          name: accountName.trim(),
          bankLabel: resolvedBankLabel,
          executionLimitAmount: limit,
          branchId: branchId || null,
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
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value={ALL_BRANCHES}>All branches</option>
            {activeBranches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name} ({branch.code})
              </option>
            ))}
          </select>
          <small className="muted">
            All branches — back officer can use this account at any branch. Or pick one branch to
            limit scope.
          </small>
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
