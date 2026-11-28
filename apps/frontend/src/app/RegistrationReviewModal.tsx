import { useEffect, useState } from "react";
import {
  ROUTE_ASSIGNMENT_STRATEGY_LABELS,
  type ApprovalRouteRecommendation
} from "@bms/shared";
import type { Customer } from "./api";
import { approveCustomer, getApprovalRouteRecommendation, rejectCustomer } from "./api";
import { useRoutesStore } from "./stores/routesStore";
import { CustomerDetailsView } from "../components/CustomerDetailsView";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { toUserFacingError } from "../lib/networkError";

type Props = {
  open: boolean;
  customer: Customer | null;
  agentLabel?: string;
  branchLabel?: string;
  onClose: () => void;
  onDecided: () => void;
};

export function RegistrationReviewModal({
  open,
  customer,
  agentLabel,
  branchLabel,
  onClose,
  onDecided
}: Props) {
  const { showToast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [rejectMode, setRejectMode] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [recommendation, setRecommendation] = useState<ApprovalRouteRecommendation | null>(null);
  const [loadingRec, setLoadingRec] = useState(false);
  const [selectedRouteId, setSelectedRouteId] = useState<string>("__auto__");

  useEffect(() => {
    if (!open || !customer) {
      setRejectMode(false);
      setRejectReason("");
      setSubmitting(false);
      setRecommendation(null);
      setSelectedRouteId("__auto__");
      return;
    }
    let cancelled = false;
    setLoadingRec(true);
    setSelectedRouteId("__auto__");
    void getApprovalRouteRecommendation(customer.id)
      .then((rec) => {
        if (cancelled) {
          return;
        }
        setRecommendation(rec);
        if (rec.willAutoAssign && rec.recommendedRouteId) {
          setSelectedRouteId("__auto__");
        } else {
          setSelectedRouteId("__none__");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRecommendation(null);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingRec(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, customer?.id]);

  async function handleApprove() {
    if (!customer) {
      return;
    }
    setSubmitting(true);
    try {
      const options =
        selectedRouteId === "__auto__"
          ? undefined
          : selectedRouteId === "__none__"
            ? { routeId: null }
            : { routeId: selectedRouteId };
      const approved = await approveCustomer(customer.id, options);
      void useRoutesStore.getState().refreshSilent();
      showToast(`Approved — account ${approved.accountNumber}`, "success");
      onDecided();
      onClose();
    } catch (error) {
      showToast(toUserFacingError(error, "Approve failed"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRejectConfirm() {
    if (!customer) {
      return;
    }
    setSubmitting(true);
    try {
      await rejectCustomer(customer.id, rejectReason.trim() || undefined);
      showToast("Registration rejected", "success");
      onDecided();
      onClose();
    } catch (error) {
      showToast(toUserFacingError(error, "Reject failed"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!customer) {
    return null;
  }

  const branchRoutes = recommendation?.branchActiveRoutes ?? [];
  const candidateIds = new Set((recommendation?.candidateRoutes ?? []).map((r) => r.id));

  return (
    <Modal
      open={open}
      title="Review registration"
      subtitle="Verify identity, account details, and route assignment before approval."
      onClose={onClose}
      panelClassName="modal-panel--70 modal-panel--customer"
      footer={
        rejectMode ? (
          <>
            <button
              type="button"
              className="button secondary"
              onClick={() => setRejectMode(false)}
              disabled={submitting}
            >
              Back
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => void handleRejectConfirm()}
              disabled={submitting}
            >
              {submitting ? "Rejecting…" : "Confirm reject"}
            </button>
          </>
        ) : (
          <>
            <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>
              Close
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={() => setRejectMode(true)}
              disabled={submitting}
            >
              Reject
            </button>
            <button type="button" className="button" onClick={() => void handleApprove()} disabled={submitting}>
              {submitting ? "Approving…" : "Approve"}
            </button>
          </>
        )
      }
    >
      <CustomerDetailsView
        customer={customer}
        branchLabel={branchLabel}
        agentLabel={agentLabel}
        statusLabel="Pending approval"
        showFinancials={false}
      />

      {!rejectMode ? (
        <section className="approval-route-box" aria-label="Route assignment on approval">
          <div className="approval-route-box__head">
            <div>
              <strong>Route assignment on approval</strong>
              {recommendation ? (
                <span className="route-badge route-badge--primary">
                  {ROUTE_ASSIGNMENT_STRATEGY_LABELS[recommendation.strategy]} mode
                </span>
              ) : null}
            </div>
            {customer.location ? (
              <span className="route-location-tag">{customer.location}</span>
            ) : null}
          </div>

          {loadingRec ? (
            <p className="muted" style={{ margin: 0, fontSize: "0.84rem" }}>
              Checking branch routes…
            </p>
          ) : recommendation ? (
            <>
              <p className="muted" style={{ margin: 0, fontSize: "0.84rem", lineHeight: 1.5 }}>
                {recommendation.reason}
              </p>

              {branchRoutes.length > 0 ? (
                <label className="route-field" style={{ marginTop: "0.35rem" }}>
                  <span className="route-field__label">Operational route</span>
                  <select
                    className="route-select"
                    value={selectedRouteId}
                    disabled={submitting}
                    onChange={(e) => setSelectedRouteId(e.target.value)}
                  >
                    {recommendation.willAutoAssign && recommendation.recommendedRouteId ? (
                      <option value="__auto__">
                        Auto-assign: {recommendation.recommendedRouteName}
                        {recommendation.recommendedFieldAgentName
                          ? ` (${recommendation.recommendedFieldAgentName})`
                          : ""}
                      </option>
                    ) : null}
                    <option value="__none__">Leave unassigned (no route)</option>
                    {recommendation.candidateRoutes.length > 0 ? (
                      <optgroup label="Recommended / matching routes">
                        {recommendation.candidateRoutes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} · {r.area}
                            {r.assignedFieldAgentName ? ` (${r.assignedFieldAgentName})` : ""}
                          </option>
                        ))}
                      </optgroup>
                    ) : null}
                    {branchRoutes.some((r) => !candidateIds.has(r.id)) ? (
                      <optgroup label="Other active branch routes">
                        {branchRoutes
                          .filter((r) => !candidateIds.has(r.id))
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} · {r.area}
                              {r.assignedFieldAgentName ? ` (${r.assignedFieldAgentName})` : ""}
                            </option>
                          ))}
                      </optgroup>
                    ) : null}
                  </select>
                </label>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}

      {rejectMode ? (
        <div className="reject-box" style={{ marginTop: "1rem" }}>
          <label className="field">
            <span>Rejection reason (optional)</span>
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Explain what needs correction so the agent can resubmit…"
            />
          </label>
        </div>
      ) : null}
    </Modal>
  );
}
