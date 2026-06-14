import { FormEvent, useState } from "react";
import {
  formatInvestmentTenureLabel,
  INVESTMENT_PRODUCT_TYPE_LABELS,
  INVESTMENT_TENURE_PRESETS,
  type InvestmentProductType,
  type InvestmentRateTier
} from "@bms/shared";
import { createInvestmentProduct } from "../api";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useInvestmentStore } from "../stores/investmentStore";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
};

const PRODUCT_TYPES = Object.keys(INVESTMENT_PRODUCT_TYPE_LABELS) as InvestmentProductType[];

function emptyTier(): InvestmentRateTier {
  return { tenureDays: 90, ratePercent: 2, sortOrder: 0 };
}

export function CreateInvestmentProductModal({ open, onClose, onCreated }: Props) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    productType: "fixed_deposit" as InvestmentProductType,
    name: "",
    description: "",
    minAmount: 100,
    maxAmount: 1_000_000,
    rateTiers: [emptyTier()] as InvestmentRateTier[]
  });

  function resetForm() {
    setForm({
      productType: "fixed_deposit",
      name: "",
      description: "",
      minAmount: 100,
      maxAmount: 1_000_000,
      rateTiers: [emptyTier()]
    });
  }

  function updateTier(index: number, patch: Partial<InvestmentRateTier>) {
    setForm((prev) => ({
      ...prev,
      rateTiers: prev.rateTiers.map((tier, i) => (i === index ? { ...tier, ...patch } : tier))
    }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (form.rateTiers.length === 0) {
      showToast("Add at least one tenure/rate tier", "error");
      return;
    }
    setSubmitting(true);
    try {
      const first = form.rateTiers[0];
      const product = await createInvestmentProduct({
        productType: form.productType,
        name: form.name,
        description: form.description || undefined,
        defaultRatePercent: first.ratePercent,
        defaultTenureDays: first.tenureDays,
        rateTiers: form.rateTiers.map((tier, index) => ({
          ...tier,
          label: tier.label ?? `${formatInvestmentTenureLabel(tier.tenureDays)} · ${tier.ratePercent}%`,
          sortOrder: index
        })),
        minAmount: form.minAmount,
        maxAmount: form.maxAmount,
        status: "active"
      });
      useInvestmentStore.getState().upsertProduct(product);
      showToast("Product created", "success");
      resetForm();
      onCreated();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to create product", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Create product"
      subtitle="Define product type, amount range, and tenure/rate tiers."
      onClose={onClose}
      panelClassName="modal-panel--70"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="submit" form="create-investment-product-form" className="button primary" disabled={submitting}>
            {submitting ? "Saving…" : "Create product"}
          </button>
        </>
      }
    >
      <form id="create-investment-product-form" className="stack-form" onSubmit={handleSubmit}>
        <div className="investment-form-grid">
          <label className="field">
            <span>Type</span>
            <select
              value={form.productType}
              onChange={(e) => setForm({ ...form, productType: e.target.value as InvestmentProductType })}
            >
              {PRODUCT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {INVESTMENT_PRODUCT_TYPE_LABELS[type]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Name</span>
            <input value={form.name} required onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field field--full">
            <span>Description</span>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
          <label className="field">
            <span>Minimum amount</span>
            <input
              type="number"
              value={form.minAmount}
              onChange={(e) => setForm({ ...form, minAmount: Number(e.target.value) })}
            />
          </label>
          <label className="field">
            <span>Maximum amount</span>
            <input
              type="number"
              value={form.maxAmount}
              onChange={(e) => setForm({ ...form, maxAmount: Number(e.target.value) })}
            />
          </label>
        </div>
        <div className="investment-rate-tiers">
          <h4>Tenure & rate tiers</h4>
          {form.rateTiers.map((tier, index) => (
            <div key={index} className="investment-rate-tier-row">
              <label className="field">
                <span>Preset</span>
                <select
                  value={tier.tenureDays}
                  onChange={(e) => updateTier(index, { tenureDays: Number(e.target.value) })}
                >
                  {INVESTMENT_TENURE_PRESETS.map((preset) => (
                    <option key={preset.tenureDays} value={preset.tenureDays}>
                      {preset.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Days</span>
                <input
                  type="number"
                  min={1}
                  value={tier.tenureDays}
                  onChange={(e) => updateTier(index, { tenureDays: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Rate (%)</span>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={tier.ratePercent}
                  onChange={(e) => updateTier(index, { ratePercent: Number(e.target.value) })}
                />
              </label>
              {form.rateTiers.length > 1 ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      rateTiers: prev.rateTiers.filter((_, i) => i !== index)
                    }))
                  }
                >
                  Remove
                </button>
              ) : null}
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            onClick={() =>
              setForm((prev) => ({
                ...prev,
                rateTiers: [...prev.rateTiers, { ...emptyTier(), sortOrder: prev.rateTiers.length }]
              }))
            }
          >
            + Add tier
          </button>
        </div>
      </form>
    </Modal>
  );
}
