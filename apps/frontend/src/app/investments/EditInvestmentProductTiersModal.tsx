import { useEffect, useState } from "react";
import { formatInvestmentTenureLabel, type InvestmentProduct, type InvestmentRateTier } from "@bms/shared";
import { updateInvestmentProductApi } from "../api";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { useInvestmentStore } from "../stores/investmentStore";

type Props = {
  open: boolean;
  product: InvestmentProduct | null;
  onClose: () => void;
  onSaved: () => void;
};

export function EditInvestmentProductTiersModal({ open, product, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const [tiers, setTiers] = useState<InvestmentRateTier[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!product) {
      return;
    }
    const existing = product.rateTiers ?? [];
    setTiers(
      existing.length
        ? existing.map((tier, index) => ({ ...tier, sortOrder: index }))
        : [{ tenureDays: product.defaultTenureDays, ratePercent: product.defaultRatePercent, sortOrder: 0 }]
    );
  }, [product]);

  if (!product) {
    return null;
  }

  async function handleSave() {
    if (tiers.length === 0) {
      showToast("Add at least one tier", "error");
      return;
    }
    const first = tiers[0];
    setSubmitting(true);
    try {
      const updated = await updateInvestmentProductApi(product!.id, {
        rateTiers: tiers.map((tier, index) => ({
          ...tier,
          label: tier.label ?? `${formatInvestmentTenureLabel(tier.tenureDays)} · ${tier.ratePercent}%`,
          sortOrder: index
        })),
        defaultRatePercent: first.ratePercent,
        defaultTenureDays: first.tenureDays
      });
      useInvestmentStore.getState().upsertProduct(updated);
      showToast("Rate tiers updated", "success");
      onSaved();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update tiers", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title="Edit rate tiers"
      subtitle={product.name}
      onClose={onClose}
      panelClassName="modal-panel--60"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="button primary" onClick={() => void handleSave()} disabled={submitting}>
            {submitting ? "Saving…" : "Save tiers"}
          </button>
        </>
      }
    >
      <div className="investment-rate-tiers">
        {tiers.map((tier, index) => (
          <div key={index} className="investment-rate-tier-row">
            <label className="field">
              <span>Days</span>
              <input
                type="number"
                min={1}
                value={tier.tenureDays}
                onChange={(e) =>
                  setTiers((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, tenureDays: Number(e.target.value) } : row))
                  )
                }
              />
            </label>
            <label className="field">
              <span>Rate (%)</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={tier.ratePercent}
                onChange={(e) =>
                  setTiers((rows) =>
                    rows.map((row, i) => (i === index ? { ...row, ratePercent: Number(e.target.value) } : row))
                  )
                }
              />
            </label>
            {tiers.length > 1 ? (
              <button
                type="button"
                className="button secondary"
                onClick={() => setTiers((rows) => rows.filter((_, i) => i !== index))}
              >
                Remove
              </button>
            ) : null}
          </div>
        ))}
        <button
          type="button"
          className="button secondary"
          onClick={() => setTiers((rows) => [...rows, { tenureDays: 90, ratePercent: 2, sortOrder: rows.length }])}
        >
          + Add tier
        </button>
      </div>
    </Modal>
  );
}
