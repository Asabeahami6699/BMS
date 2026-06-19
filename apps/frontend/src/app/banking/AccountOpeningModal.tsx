import { useEffect, useState } from "react";
import { bankProductDisplayLabel, type TenantBankProduct } from "@bms/shared";
import type { Branch } from "../api";
import { Modal } from "../../components/Modal";

export type AccountOpeningFormValues = {
  accountNumber: string;
  accountName: string;
  phone: string;
  email: string;
  initialDeposit: string;
  bankProductId: string;
  branchId: string;
  openingDate: string;
};

type Props = {
  open: boolean;
  posting: boolean;
  productsLoading: boolean;
  branches: Branch[];
  openingProducts: TenantBankProduct[];
  openedByName: string;
  defaultBranchId?: string;
  onClose: () => void;
  onSubmit: (values: AccountOpeningFormValues) => Promise<void>;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

const EMPTY_FORM: AccountOpeningFormValues = {
  accountNumber: "",
  accountName: "",
  phone: "",
  email: "",
  initialDeposit: "",
  bankProductId: "",
  branchId: "",
  openingDate: todayIso()
};

export function AccountOpeningModal({
  open,
  posting,
  productsLoading,
  branches,
  openingProducts,
  openedByName,
  defaultBranchId,
  onClose,
  onSubmit
}: Props) {
  const [form, setForm] = useState<AccountOpeningFormValues>(EMPTY_FORM);

  useEffect(() => {
    if (!open) {
      return;
    }
    setForm({
      ...EMPTY_FORM,
      bankProductId: openingProducts[0]?.id ?? "",
      branchId: defaultBranchId ?? branches[0]?.id ?? "",
      openingDate: todayIso()
    });
  }, [open, openingProducts, branches, defaultBranchId]);

  function patchForm(patch: Partial<AccountOpeningFormValues>) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  async function handleSubmit() {
    await onSubmit(form);
  }

  return (
    <Modal
      open={open}
      title="Record account opening"
      subtitle="Capture partner bank account details created on Ecobank, GCB, or other platforms."
      panelClassName="modal-panel--70 account-opening-modal"
      onClose={onClose}
      footer={
        <div className="modal-actions">
          <button type="button" className="button secondary" disabled={posting} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="button primary"
            disabled={posting || productsLoading || openingProducts.length === 0}
            onClick={() => void handleSubmit()}
          >
            {posting ? "Saving…" : "Record account"}
          </button>
        </div>
      }
    >
      {productsLoading ? (
        <p className="muted">Loading account-opening products…</p>
      ) : openingProducts.length === 0 ? (
        <p className="muted">
          Account-opening products could not be loaded. Close and try again, or ask an admin to
          confirm you have the Open partner bank accounts permission.
        </p>
      ) : (
        <div className="account-opening-form">
          <div className="account-opening-form__grid">
            <label className="field">
              <span>Account No.</span>
              <input
                value={form.accountNumber}
                onChange={(e) => patchForm({ accountNumber: e.target.value })}
                placeholder="Partner bank account number"
              />
            </label>
            <label className="field">
              <span>Account Name</span>
              <input
                value={form.accountName}
                onChange={(e) => patchForm({ accountName: e.target.value })}
                placeholder="As shown on partner bank"
              />
            </label>
            <label className="field">
              <span>Opened By</span>
              <input value={openedByName} readOnly className="is-readonly" />
            </label>
            <label className="field">
              <span>Phone</span>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => patchForm({ phone: e.target.value })}
                placeholder="Customer phone"
              />
            </label>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => patchForm({ email: e.target.value })}
                placeholder="Customer email"
              />
            </label>
            <label className="field">
              <span>Initial Deposit</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.initialDeposit}
                onChange={(e) => patchForm({ initialDeposit: e.target.value })}
                placeholder="0.00"
              />
            </label>
            <label className="field">
              <span>Type</span>
              <select
                value={form.bankProductId}
                onChange={(e) => patchForm({ bankProductId: e.target.value })}
              >
                {openingProducts.map((product) => (
                  <option key={product.id} value={product.id}>
                    {bankProductDisplayLabel(product)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Branch</span>
              <select
                value={form.branchId}
                onChange={(e) => patchForm({ branchId: e.target.value })}
              >
                {branches.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name} ({branch.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Date</span>
              <input
                type="date"
                value={form.openingDate}
                onChange={(e) => patchForm({ openingDate: e.target.value })}
              />
            </label>
          </div>
        </div>
      )}
    </Modal>
  );
}

export function buildAccountOpeningWorkflowPayload(
  values: AccountOpeningFormValues
): Record<string, unknown> {
  const workflow: Record<string, unknown> = {};
  if (values.phone.trim()) {
    workflow.contact_phone = values.phone.trim();
  }
  if (values.email.trim()) {
    workflow.contact_email = values.email.trim();
  }
  if (values.openingDate.trim()) {
    workflow.opening_date = values.openingDate.trim();
  }
  if (values.initialDeposit.trim()) {
    const amount = Number(values.initialDeposit);
    if (Number.isFinite(amount)) {
      workflow.initial_deposit = amount;
    }
  }
  return workflow;
}
