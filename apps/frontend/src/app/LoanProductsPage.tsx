import { useMemo, useState } from "react";
import type { LoanProduct } from "@bms/shared";
import type { AppRole } from "./api";
import { createLoanProduct, updateLoanProduct } from "./api";
import { AdminDataTable, filterRowsBySearch } from "../components/AdminDataTable";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";
import { useLoanPermissions } from "./hooks/useLoanPermissions";
import { LoansLayout } from "./loans/LoansLayout";
import { formatLoanMoney, frequencyLabel, loanTypeLabel, parseMoneyInput } from "./loans/loanUi";
import { LoanMoneyInput } from "./loans/LoanMoneyInput";
import { useLoansStore } from "./stores/loansStore";

type Props = { role: AppRole };

type ProductForm = {
  name: string;
  description: string;
  interestRatePercent: string;
  termMonths: string;
  repaymentFrequency: LoanProduct["repaymentFrequency"];
  minAmount: string;
  minAmountNum: number;
  maxAmount: string;
  maxAmountNum: number;
  loanType: LoanProduct["loanType"];
  minGroupMembers: string;
  maxGroupMembers: string;
  status: LoanProduct["status"];
};

const emptyForm = (): ProductForm => ({
  name: "",
  description: "",
  interestRatePercent: "",
  termMonths: "12",
  repaymentFrequency: "monthly",
  minAmount: "",
  minAmountNum: NaN,
  maxAmount: "",
  maxAmountNum: NaN,
  loanType: "individual",
  minGroupMembers: "5",
  maxGroupMembers: "15",
  status: "active"
});

export function LoanProductsPage({ role: _role }: Props) {
  const { showToast } = useToast();
  const { canManageProducts } = useLoanPermissions();
  const loading = useLoansStore((s) => s.loading);
  const error = useLoansStore((s) => s.error);
  const products = useLoansStore((s) => s.products);
  const refresh = useLoansStore((s) => s.refresh);
  const upsertProduct = useLoansStore((s) => s.upsertProduct);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductForm>(emptyForm);
  const [busy, setBusy] = useState(false);

  const filtered = useMemo(
    () => filterRowsBySearch(products, search, ["name", "description"] as (keyof LoanProduct)[]),
    [products, search]
  );

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm());
    setShowForm(true);
  }

  function openEdit(product: LoanProduct) {
    setEditingId(product.id);
    setForm({
      name: product.name,
      description: product.description ?? "",
      interestRatePercent: String(product.interestRatePercent),
      termMonths: String(product.termMonths),
      repaymentFrequency: product.repaymentFrequency,
      minAmount: String(product.minAmount),
      minAmountNum: product.minAmount,
      maxAmount: String(product.maxAmount),
      maxAmountNum: product.maxAmount,
      loanType: product.loanType ?? "individual",
      minGroupMembers: product.minGroupMembers != null ? String(product.minGroupMembers) : "5",
      maxGroupMembers: product.maxGroupMembers != null ? String(product.maxGroupMembers) : "15",
      status: product.status
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const minAmount = Number.isFinite(form.minAmountNum) ? form.minAmountNum : parseMoneyInput(form.minAmount);
    const maxAmount = Number.isFinite(form.maxAmountNum) ? form.maxAmountNum : parseMoneyInput(form.maxAmount);
    const interestRatePercent = Number(form.interestRatePercent);
    const termMonths = Number(form.termMonths);

    if (!Number.isFinite(minAmount) || !Number.isFinite(maxAmount) || minAmount <= 0 || maxAmount <= 0) {
      showToast("Enter valid minimum and maximum amounts", "error");
      return;
    }
    if (maxAmount < minAmount) {
      showToast("Maximum amount must be at least the minimum", "error");
      return;
    }
    if (!Number.isFinite(interestRatePercent) || interestRatePercent < 0 || interestRatePercent > 100) {
      showToast("Interest rate must be between 0 and 100", "error");
      return;
    }

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      interestRatePercent,
      termMonths,
      repaymentFrequency: form.repaymentFrequency,
      minAmount,
      maxAmount,
      loanType: form.loanType,
      minGroupMembers:
        form.loanType === "group_solidarity" ? Number(form.minGroupMembers) || undefined : undefined,
      maxGroupMembers:
        form.loanType === "group_solidarity" ? Number(form.maxGroupMembers) || undefined : undefined,
      status: form.status
    };
    setBusy(true);
    try {
      if (editingId) {
        const updated = await updateLoanProduct(editingId, payload);
        upsertProduct(updated);
        showToast("Product updated", "success");
      } else {
        const created = await createLoanProduct(payload);
        upsertProduct(created);
        showToast("Product created", "success");
      }
      setShowForm(false);
    } catch (err) {
      showToast(toUserFacingError(err, "Save failed"), "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <LoansLayout
      activeNav="products"
      title="Loan products"
      subtitle="Define interest, term, amount limits, and weekly or monthly collection cycles."
      actions={
        <>
          <button
            type="button"
            className="button secondary"
            disabled={loading}
            onClick={() => {
              void refresh().catch((err) =>
                showToast(toUserFacingError(err, "Failed to refresh products"), "error")
              );
            }}
          >
            {loading ? "…" : "↻"}
          </button>
          {canManageProducts ? (
            <button type="button" className="button primary" onClick={openCreate}>
              Add product
            </button>
          ) : null}
        </>
      }
    >
      {error ? <p className="loans-field-error loans-animate-in">{error}</p> : null}

      {showForm && canManageProducts ? (
        <section className="card loans-form-panel loans-animate-in">
          <h3>{editingId ? "Edit product" : "New product"}</h3>
          <form className="loans-form-grid" onSubmit={(e) => void handleSubmit(e)}>
            <label className="field">
              <span>Name</span>
              <input required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </label>
            <label className="field">
              <span>Interest rate (%)</span>
              <input
                required
                type="text"
                inputMode="decimal"
                className="loans-money-input"
                value={form.interestRatePercent}
                onChange={(e) => setForm((f) => ({ ...f, interestRatePercent: e.target.value }))}
              />
            </label>
            <label className="field">
              <span>Term (months)</span>
              <input
                required
                type="text"
                inputMode="numeric"
                className="loans-money-input"
                value={form.termMonths}
                onChange={(e) => setForm((f) => ({ ...f, termMonths: e.target.value.replace(/\D/g, "") }))}
              />
            </label>
            <label className="field">
              <span>Loan type</span>
              <select
                value={form.loanType}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    loanType: e.target.value as LoanProduct["loanType"]
                  }))
                }
              >
                <option value="individual">Individual</option>
                <option value="group_solidarity">Group solidarity</option>
              </select>
            </label>
            {form.loanType === "group_solidarity" ? (
              <>
                <label className="field">
                  <span>Min group members</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.minGroupMembers}
                    onChange={(e) => setForm((f) => ({ ...f, minGroupMembers: e.target.value.replace(/\D/g, "") }))}
                  />
                </label>
                <label className="field">
                  <span>Max group members</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={form.maxGroupMembers}
                    onChange={(e) => setForm((f) => ({ ...f, maxGroupMembers: e.target.value.replace(/\D/g, "") }))}
                  />
                </label>
              </>
            ) : null}
            <label className="field">
              <span>Repayment frequency</span>
              <select
                value={form.repaymentFrequency}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    repaymentFrequency: e.target.value as LoanProduct["repaymentFrequency"]
                  }))
                }
              >
                <option value="monthly">Monthly</option>
                <option value="weekly">Weekly</option>
              </select>
            </label>
            <label className="field">
              <span>Minimum amount</span>
              <LoanMoneyInput
                required
                value={form.minAmount}
                onChange={(display, numeric) =>
                  setForm((f) => ({ ...f, minAmount: display, minAmountNum: numeric }))
                }
              />
            </label>
            <label className="field">
              <span>Maximum amount</span>
              <LoanMoneyInput
                required
                value={form.maxAmount}
                onChange={(display, numeric) =>
                  setForm((f) => ({ ...f, maxAmount: display, maxAmountNum: numeric }))
                }
              />
              {Number.isFinite(form.minAmountNum) &&
              Number.isFinite(form.maxAmountNum) &&
              form.maxAmountNum < form.minAmountNum ? (
                <p className="field-hint loans-field-error">Maximum must be at least the minimum</p>
              ) : null}
            </label>
            <label className="field field--full">
              <span>Description</span>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
            <div className="loans-wizard-actions field--full">
              <button type="button" className="button secondary" onClick={() => setShowForm(false)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={busy}>
                {busy ? "Saving…" : "Save product"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <section className="card loans-animate-in loans-animate-in--3">
        <AdminDataTable
          columns={[
            { key: "name", label: "Product", render: (row) => <strong>{row.name}</strong> },
            {
              key: "rate",
              label: "Rate / term",
              render: (row) => `${row.interestRatePercent}% · ${row.termMonths} mo`
            },
            {
              key: "type",
              label: "Type",
              render: (row) => loanTypeLabel(row.loanType)
            },
            {
              key: "freq",
              label: "Repayment",
              render: (row) => frequencyLabel(row.repaymentFrequency)
            },
            {
              key: "range",
              label: "Amount range",
              render: (row) => `${formatLoanMoney(row.minAmount)} – ${formatLoanMoney(row.maxAmount)}`
            },
            {
              key: "status",
              label: "Status",
              render: (row) => (
                <span className={`status-pill status-pill--${row.status === "active" ? "active" : "inactive"}`}>
                  {row.status}
                </span>
              )
            }
          ]}
          rows={filtered}
          rowKey={(row) => row.id}
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search products…"
          emptyMessage={loading && !products.length ? "Loading products…" : "No loan products yet."}
          actions={
            canManageProducts
              ? (row) => (
                  <button type="button" className="button link" onClick={() => openEdit(row)}>
                    Edit
                  </button>
                )
              : undefined
          }
        />
      </section>
    </LoansLayout>
  );
}
