import { useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import type { BankProductCreateDirection, TenantBankProduct } from "@bms/shared";
import {
  BANK_PRODUCT_CREATE_DIRECTION_LABELS,
  BANK_PRODUCT_DIRECTION_LABELS,
  bankProductDisplayLabel,
  bankProductScopeLabel,
  hasAnyPermission,
  suggestBankProductCode
} from "@bms/shared";
import type { AppRole, Branch } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useBankProductsLiveSync } from "./hooks/useBankProductsLiveSync";
import { WorkflowFieldsEditor } from "./banking/WorkflowFieldsEditor";
import { useBankProductsStore } from "./stores/bankProductsStore";
import { useBranchesStore } from "./stores/branchesStore";

type Props = {
  role: AppRole;
  permissions?: import("@bms/shared").Permission[];
};

export function BankProductsPage({ role, permissions }: Props) {
  const { showToast } = useToast();
  useBankProductsLiveSync();

  const branches = useBranchesStore((s) => s.branches);
  const {
    products,
    branchFilter,
    loading,
    saving,
    error,
    refresh,
    setBranchFilter,
    createProduct,
    updateProduct,
    formOpen,
    editingId,
    formDraft: form,
    openCreateForm,
    openEditForm,
    closeForm,
    patchFormDraft
  } = useBankProductsStore(
    useShallow((s) => ({
      products: s.products,
      branchFilter: s.branchFilter,
      loading: s.loading,
      saving: s.saving,
      error: s.error,
      refresh: s.refresh,
      setBranchFilter: s.setBranchFilter,
      createProduct: s.createProduct,
      updateProduct: s.updateProduct,
      formOpen: s.formOpen,
      editingId: s.editingId,
      formDraft: s.formDraft,
      openCreateForm: s.openCreateForm,
      openEditForm: s.openEditForm,
      closeForm: s.closeForm,
      patchFormDraft: s.patchFormDraft
    }))
  );

  const canManage =
    role === "admin" || hasAnyPermission(permissions, ["banking.products.manage"]);

  const [search, setSearch] = useState("");

  const activeBranches = useMemo(
    () => branches.filter((b) => b.status === "active"),
    [branches]
  );

  const branchCode = activeBranches.find((b) => b.id === form.branchId)?.code;

  const suggestedDepositCode = useMemo(() => {
    if (editingId) {
      return form.code;
    }
    return suggestBankProductCode({
      bankLabel: form.bankLabel,
      name: form.name,
      direction: "deposit",
      branchCode
    });
  }, [editingId, form.bankLabel, form.name, form.code, branchCode]);

  const suggestedWithdrawalCode = useMemo(() => {
    if (editingId || form.direction !== "both") {
      return "";
    }
    return suggestBankProductCode({
      bankLabel: form.bankLabel,
      name: form.name,
      direction: "withdrawal",
      branchCode
    });
  }, [editingId, form.direction, form.bankLabel, form.name, branchCode]);

  const suggestedCode =
    form.direction === "both" && !editingId ? suggestedDepositCode : suggestedDepositCode;

  const filtered = useMemo(() => {
    const scoped =
      branchFilter === ""
        ? products
        : products.filter((p) => p.branchId == null || p.branchId === branchFilter);
    return filterRowsBySearch(scoped, search, [
      "name",
      "code",
      "bankLabel",
      "branchName"
    ] as (keyof TenantBankProduct)[]);
  }, [products, search, branchFilter]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canManage) {
      return;
    }

    const sortOrder = Number(form.sortOrder);
    if (!form.name.trim() || !form.bankLabel.trim()) {
      showToast("Name and bank label are required", "error");
      return;
    }
    if (!Number.isFinite(sortOrder) || sortOrder < 0) {
      showToast("Sort order must be zero or greater", "error");
      return;
    }

    const limitRaw = form.executionLimitAmount.trim();
    const executionLimitAmount =
      limitRaw === "" ? null : Number(limitRaw);
    if (executionLimitAmount != null && (!Number.isFinite(executionLimitAmount) || executionLimitAmount < 0)) {
      showToast("Execution limit must be zero or greater", "error");
      return;
    }

    const sharedPayload = {
      name: form.name.trim(),
      bankLabel: form.bankLabel.trim(),
      branchId: form.branchId ? form.branchId : null,
      sortOrder,
      isActive: form.isActive,
      workflowFields: form.workflowFields,
      isCompanyBankAccount: form.isCompanyBankAccount,
      executionLimitAmount
    };

    try {
      if (editingId) {
        await updateProduct(editingId, {
          ...sharedPayload,
          code: form.code.trim() || suggestedCode,
          direction: form.direction === "both" ? undefined : form.direction
        });
        showToast("Bank product updated", "success");
      } else {
        const created = await createProduct({
          ...sharedPayload,
          direction: form.direction,
          code: form.direction === "both" ? undefined : form.code.trim() || suggestedCode
        });
        showToast(
          created.length > 1
            ? "Deposit and withdrawal products created"
            : "Bank product created",
          "success"
        );
      }
      closeForm();
    } catch (err) {
      showToast(toUserFacingError(err, "Save failed"), "error");
    }
  }

  return (
    <div className="agents-page">
      <header className="agents-page__header">
        <div>
          <h2>Bank products</h2>
          <p className="muted">
            Define deposit and withdrawal types per branch or for all branches. Choose{" "}
            <strong>Deposit &amp; withdrawal (both)</strong> to create both products in one step.
          </p>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        <div className="agents-page__header-actions">
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => void refresh()}
          >
            {loading ? "…" : "↻"}
          </button>
          {canManage ? (
            <button type="button" className="button primary" onClick={openCreateForm}>
              Add product
            </button>
          ) : null}
        </div>
      </header>

      {formOpen && canManage ? (
        <section className="card loans-form-panel">
          <h3>{editingId ? "Edit bank product" : "New bank product"}</h3>
          <form className="loans-form-grid" onSubmit={(e) => void handleSubmit(e)}>
            <label className="field">
              <span>Branch scope</span>
              <select
                value={form.branchId}
                onChange={(e) => patchFormDraft({ branchId: e.target.value })}
              >
                <option value="">All branches</option>
                {activeBranches.map((b: Branch) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({b.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Bank</span>
              <input
                value={form.bankLabel}
                onChange={(e) => patchFormDraft({ bankLabel: e.target.value })}
                placeholder="e.g. Ecobank, GCB, Fidelity"
                required
              />
            </label>
            <label className="field">
              <span>Display name</span>
              <input
                value={form.name}
                onChange={(e) => patchFormDraft({ name: e.target.value })}
                placeholder="e.g. Cash at counter"
                required
              />
            </label>
            <label className="field">
              <span>Direction</span>
              <select
                value={form.direction}
                disabled={Boolean(editingId)}
                onChange={(e) =>
                  patchFormDraft({ direction: e.target.value as BankProductCreateDirection })
                }
              >
                <option value="both">{BANK_PRODUCT_CREATE_DIRECTION_LABELS.both}</option>
                <option value="deposit">{BANK_PRODUCT_CREATE_DIRECTION_LABELS.deposit}</option>
                <option value="withdrawal">{BANK_PRODUCT_CREATE_DIRECTION_LABELS.withdrawal}</option>
                <option value="account_opening">
                  {BANK_PRODUCT_CREATE_DIRECTION_LABELS.account_opening}
                </option>
              </select>
            </label>
            <WorkflowFieldsEditor
              direction={form.direction}
              fields={form.workflowFields}
              onChange={(workflowFields) => patchFormDraft({ workflowFields })}
            />
            <label className="field">
              <span>Code {editingId ? "" : "(optional — auto-generated if blank)"}</span>
              <input
                value={form.code}
                disabled={!editingId && form.direction === "both"}
                onChange={(e) =>
                  patchFormDraft({
                    code: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")
                  })
                }
                placeholder={
                  form.direction === "both" && !editingId
                    ? `${suggestedDepositCode}, ${suggestedWithdrawalCode}`
                    : suggestedCode || "e.g. ecobank_deposit"
                }
              />
              {form.direction === "both" && !editingId ? (
                <small className="muted">
                  Creates two codes: {suggestedDepositCode} and {suggestedWithdrawalCode}
                </small>
              ) : null}
            </label>
            <label className="field">
              <span>Sort order</span>
              <input
                type="number"
                min={0}
                value={form.sortOrder}
                onChange={(e) => patchFormDraft({ sortOrder: e.target.value })}
              />
            </label>
            <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={form.isCompanyBankAccount}
                onChange={(e) => patchFormDraft({ isCompanyBankAccount: e.target.checked })}
              />
              <span>Company bank account (back officer uses at partner bank)</span>
            </label>
            <label className="field">
              <span>Back-office execution limit (GHS)</span>
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.executionLimitAmount}
                onChange={(e) => patchFormDraft({ executionLimitAmount: e.target.value })}
                placeholder="Leave blank for no limit"
              />
            </label>
            <label className="field" style={{ flexDirection: "row", alignItems: "center", gap: "0.5rem" }}>
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => patchFormDraft({ isActive: e.target.checked })}
              />
              <span>Active</span>
            </label>
            <div className="loans-form-actions">
              <button type="button" className="button secondary" onClick={closeForm}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={saving}>
                {saving ? "Saving…" : editingId ? "Save product" : "Save product(s)"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <AdminDataTable
        search={search}
        onSearchChange={setSearch}
        searchPlaceholder="Search by name, code, bank, or branch…"
        toolbar={
          <label className="field agents-page__branch-filter">
            <span>Branch</span>
            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)}>
              <option value="">All branches</option>
              {activeBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} ({b.code})
                </option>
              ))}
            </select>
          </label>
        }
        columns={[
          { key: "name", label: "Product" },
          { key: "scope", label: "Branch" },
          { key: "bankLabel", label: "Bank" },
          { key: "direction", label: "Type" },
          { key: "code", label: "Code" },
          { key: "status", label: "Status" }
        ]}
        rows={filtered.map((product) => ({
          id: product.id,
          product,
          name: bankProductDisplayLabel(product),
          scope: bankProductScopeLabel(product),
          bankLabel: product.bankLabel,
          direction: BANK_PRODUCT_DIRECTION_LABELS[product.direction],
          code: product.code,
          status: product.isActive ? "Active" : "Inactive"
        }))}
        rowKey={(row) => row.id}
        emptyMessage={
          loading
            ? "Loading products…"
            : "No bank products yet. Add Ecobank, GCB, Fidelity, or other agency types your branch uses."
        }
        actions={
          canManage
            ? (row) => (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => openEditForm(row.product)}
                >
                  Edit
                </button>
              )
            : undefined
        }
      />
    </div>
  );
}
