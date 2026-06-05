import { FormEvent, useEffect, useState } from "react";
import type { Customer } from "../app/api";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { submitCollectionOnlineOrQueue } from "./agentSync";
import { useAgentCollectionStore } from "./stores/agentCollectionStore";
import { toUserFacingError } from "../lib/networkError";

type Props = {
  open: boolean;
  customer: Customer | null;
  topUp?: boolean;
  priorAmount?: number;
  onClose: () => void;
  onSaved: (customer: Customer | null, amount: number) => void;
};

export function CollectionModal({ open, customer, topUp, priorAmount = 0, onClose, onSaved }: Props) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [amountText, setAmountText] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (customer) {
      setAmountText("");
      setNotes("");
    }
  }, [customer]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!customer) {
      return;
    }
    if (customer.status !== "active") {
      showToast("This customer is not active yet. Wait for coordinator approval.", "error");
      return;
    }
    if (!useAgentCollectionStore.getState().canRecordCollections()) {
      showToast("Collections are locked until the coordinator posts or rejects today's batch.", "error");
      return;
    }
    const parsed = Number(amountText);
    const amount =
      amountText.trim() === "" || Number.isNaN(parsed) || parsed <= 0
        ? customer.dailyContributionAmount
        : parsed;
    const transactionBranchId = user?.branchId ?? customer.homeBranchId;
    if (!transactionBranchId) {
      showToast("No branch assigned to your account. Contact your administrator.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const result = await submitCollectionOnlineOrQueue({
        customerId: customer.id,
        amount,
        transactionBranchId,
        notes:
          notes.trim() ||
          (topUp ? "Additional contribution same day" : undefined)
      });
      if (result.mode === "offline") {
        showToast("Collection saved offline. Will sync when online.", "info");
      } else {
        showToast(
          topUp ? "Additional amount saved to today's batch" : "Collection saved — pending approval after call-over",
          "success"
        );
      }
      onSaved(customer, amount);
      onClose();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to record collection"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  const suggested = customer?.dailyContributionAmount ?? 0;

  return (
    <Modal
      open={open}
      title={topUp ? "Top up" : "Daily collection"}
      subtitle={
        customer
          ? topUp
            ? `${customer.fullName} — already GHS ${priorAmount.toFixed(2)} today`
            : `${customer.fullName}${customer.accountNumber ? ` · ${customer.accountNumber}` : ""}`
          : undefined
      }
      onClose={onClose}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="agent-collection-form"
            className="button"
            disabled={submitting || !customer}
          >
            {submitting ? "Saving…" : topUp ? "Add amount" : "Record collection"}
          </button>
        </>
      }
    >
      <form id="agent-collection-form" className="stack-form agent-form" onSubmit={handleSubmit}>
        {topUp ? (
          <p className="muted agent-amount-hint">
            Customer changed their mind or paid more? Enter the extra amount — it adds to today&apos;s
            total (not a duplicate error).
          </p>
        ) : null}
        <label className="field">
          <span>{topUp ? "Additional amount (GHS)" : "Amount (GHS)"}</span>
          <input
            type="number"
            min={0.01}
            step={0.01}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            placeholder={suggested > 0 ? String(suggested) : "0"}
            required={amountText.trim() !== ""}
          />
          {!topUp && suggested > 0 ? (
            <p className="muted agent-amount-hint">Leave empty to use default GHS {suggested.toFixed(2)}</p>
          ) : null}
        </label>
        <label className="field">
          <span>Notes (optional)</span>
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={topUp ? "e.g. customer added to contribution" : "—"}
          />
        </label>
      </form>
    </Modal>
  );
}
