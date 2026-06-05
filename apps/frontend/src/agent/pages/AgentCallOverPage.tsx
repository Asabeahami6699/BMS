import { useEffect, useMemo, useState } from "react";
import type { Customer } from "../../app/api";
import { submitCollectionBatchForApproval, type CalloverReportLine } from "../../app/api";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { useNetworkStatus } from "../../lib/useNetworkStatus";
import { useAgentCollectionStore } from "../stores/agentCollectionStore";
import { useAgentCustomerStore } from "../stores/agentCustomerStore";
import {
  computeVariance,
  useAgentCalloverStore
} from "../stores/agentCalloverStore";

function parseAmount(text: string): number {
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function formatMoney(amount: number): string {
  return amount > 0 ? `GHS ${amount.toFixed(2)}` : "—";
}

export function AgentCallOverPage() {
  const { showToast } = useToast();
  const { online } = useNetworkStatus();
  const customers = useAgentCustomerStore((s) => s.customers);
  const items = useAgentCollectionStore((s) => s.items);
  const totalApp = useAgentCollectionStore((s) => s.totalAmount);
  const batchStatus = useAgentCollectionStore((s) => s.batchStatus);
  const refreshToday = useAgentCollectionStore((s) => s.refreshToday);
  const canSubmitCallover =
    !batchStatus || batchStatus === "draft" || batchStatus === "rejected";
  const discrepancies = useAgentCalloverStore((s) => s.discrepancies);
  const verifiedMatch = useAgentCalloverStore((s) => s.verifiedMatch);
  const checkedCustomerIds = useAgentCalloverStore((s) => s.checkedCustomerIds);
  const load = useAgentCalloverStore((s) => s.load);
  const isChecked = useAgentCalloverStore((s) => s.isChecked);
  const toggleChecked = useAgentCalloverStore((s) => s.toggleChecked);
  const markAllChecked = useAgentCalloverStore((s) => s.markAllChecked);
  const markAllMatch = useAgentCalloverStore((s) => s.markAllMatch);
  const addDiscrepancy = useAgentCalloverStore((s) => s.addDiscrepancy);
  const updateDiscrepancy = useAgentCalloverStore((s) => s.updateDiscrepancy);
  const removeDiscrepancy = useAgentCalloverStore((s) => s.removeDiscrepancy);

  const [submitting, setSubmitting] = useState(false);
  const [reportNotes, setReportNotes] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    void refreshToday();
  }, [refreshToday]);

  const activeById = useMemo(() => {
    const map = new Map<string, Customer>();
    for (const c of customers.filter((x) => x.status === "active")) {
      map.set(c.id, c);
    }
    return map;
  }, [customers]);

  const systemRows = useMemo(() => {
    return items.map((item) => {
      const customer = activeById.get(item.customerId);
      return {
        customerId: item.customerId,
        displayName: customer?.fullName ?? "Customer",
        accountHint: customer?.accountNumber ?? customer?.phone,
        item,
        count: item.entryCount ?? 1
      };
    });
  }, [items, activeById]);

  const collectedCustomerIds = useMemo(
    () => systemRows.map((r) => r.customerId),
    [systemRows]
  );

  const checkedCount = useMemo(
    () => collectedCustomerIds.filter((id) => checkedCustomerIds.includes(id)).length,
    [collectedCustomerIds, checkedCustomerIds]
  );

  const totalCheckTargets = systemRows.length;
  const allCollectedChecked =
    totalCheckTargets > 0 && checkedCount >= totalCheckTargets;
  const hasCollections = totalCheckTargets > 0 || totalApp > 0;

  const sendDisabledReason = useMemo(() => {
    if (submitting) {
      return "Sending…";
    }
    if (!online) {
      return "Connect to the internet to send for approval.";
    }
    if (batchStatus === "pending_approval") {
      return "This batch is already with the coordinator.";
    }
    if (batchStatus === "posted") {
      return "Today's collections are already posted.";
    }
    if (!canSubmitCallover) {
      return "This batch cannot be submitted right now.";
    }
    if (!hasCollections) {
      return "Record at least one collection before call-over.";
    }
    if (!allCollectedChecked) {
      return `Check all ${totalCheckTargets} collected customer${totalCheckTargets === 1 ? "" : "s"} first.`;
    }
    return null;
  }, [
    submitting,
    online,
    batchStatus,
    canSubmitCallover,
    hasCollections,
    allCollectedChecked,
    totalCheckTargets
  ]);

  const pickerResults = useMemo(() => {
    const q = pickerQuery.trim().toLowerCase();
    const used = new Set(discrepancies.map((d) => d.customerId));
    return systemRows
      .filter((row) => !used.has(row.customerId))
      .filter((row) => {
        if (!q) {
          return true;
        }
        return (
          row.displayName.toLowerCase().includes(q) ||
          (row.accountHint?.includes(q) ?? false)
        );
      })
      .slice(0, 12);
  }, [systemRows, discrepancies, pickerQuery]);

  async function submitForApproval(lines: CalloverReportLine[], allMatch: boolean) {
    if (!online) {
      showToast("Connect to the internet to send for approval.", "error");
      return;
    }
    if (totalApp <= 0) {
      showToast("Record at least one collection before sending for approval.", "error");
      return;
    }
    if (batchStatus === "pending_approval") {
      showToast("This batch is already awaiting coordinator approval.", "info");
      return;
    }
    if (batchStatus === "posted") {
      showToast("Today's collections are already posted.", "info");
      return;
    }
    setSubmitting(true);
    try {
      const totalGiven = lines.reduce((s, l) => s + l.documentAmount, 0);
      const totalAppLines = lines.reduce((s, l) => s + l.appAmount, 0);
      const result = await submitCollectionBatchForApproval({
        lines: allMatch
          ? [
              {
                customerId: "day-total",
                customerName: "Day call-over — all match",
                documentAmount: totalApp,
                appAmount: totalApp,
                varianceType: "match",
                notes: reportNotes.trim() || "Agent verified cash matches system"
              }
            ]
          : lines,
        summary: {
          totalDocument: allMatch ? totalApp : totalGiven,
          totalApp: allMatch ? totalApp : totalAppLines,
          totalVariance: allMatch ? 0 : Math.round((totalGiven - totalAppLines) * 100) / 100,
          unresolvedCount: allMatch
            ? 0
            : lines.filter((l) => l.varianceType !== "match").length
        },
        agentNotes: reportNotes.trim() || undefined
      });
      useAgentCollectionStore.getState().setBatchPendingApproval(result.batchId);
      showToast(
        allMatch ? "Sent for approval — awaiting coordinator" : "Difference report sent for approval",
        "success"
      );
      if (allMatch) {
        markAllMatch();
      } else {
        discrepancies.forEach((d) => removeDiscrepancy(d.id));
      }
      setReportNotes("");
      void useAgentCollectionStore.getState().refreshToday();
    } catch (error) {
      showToast(toUserFacingError(error, "Failed to submit"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  function handleReportDifferences() {
    const lines: CalloverReportLine[] = [];
    for (const d of discrepancies) {
      const given = parseAmount(d.givenAmount);
      const systemAmount = items.find((i) => i.customerId === d.customerId)?.amount ?? 0;
      if (given === 0) {
        showToast(`Enter what ${d.customerName} gave you for each difference.`, "error");
        return;
      }
      const variance = computeVariance(given, systemAmount);
      lines.push({
        customerId: d.customerId,
        customerName: d.customerName,
        documentAmount: given,
        appAmount: systemAmount,
        varianceType: variance.type === "match" ? "match" : variance.type,
        notes: d.notes || undefined
      });
    }
    if (lines.length === 0) {
      showToast("Add at least one difference to report.", "error");
      return;
    }
    void submitForApproval(lines, false);
  }

  function handleSendForApproval() {
    if (totalCheckTargets === 0) {
      showToast("Record at least one collection before call-over.", "error");
      return;
    }
    if (checkedCount < totalCheckTargets) {
      showToast("Check every collected customer before sending for approval.", "error");
      return;
    }
    markAllChecked(collectedCustomerIds);
    void submitForApproval([], true);
  }

  function renderCheckRow(
    customerId: string,
    displayName: string,
    subtitle: string,
    checked: boolean
  ) {
    return (
      <label key={customerId} className={`agent-callover-check-row${checked ? " checked" : ""}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => toggleChecked(customerId)}
        />
        <span className="agent-callover-check-row-body">
          <strong>{displayName}</strong>
          <span className="muted">{subtitle}</span>
        </span>
        {checked ? <span className="agent-callover-check-mark">✓</span> : null}
      </label>
    );
  }

  return (
    <div className="agent-page">
      <h2>Call over</h2>
      <p className="muted">
        Verify only customers you collected from today — customers who did not contribute are not part of call-over.
        When amounts match, send the batch for coordinator approval. Accounts are credited only after they post the
        batch.
      </p>

      {batchStatus === "pending_approval" ? (
        <article className="card">
          <p>
            <strong>Awaiting approval.</strong> Your collections are with the coordinator. Customer accounts will be
            credited after they post the batch.
          </p>
        </article>
      ) : null}
      {batchStatus === "posted" ? (
        <article className="card">
          <p>
            <strong>Posted.</strong> Today&apos;s collections were credited to customer accounts.
          </p>
        </article>
      ) : null}

      <article className="card agent-callover-check-card">
        <p className="agent-callover-check-title">In the system today</p>
        <p className="agent-callover-check-total">{formatMoney(totalApp)}</p>
        <p className="muted">
          Checked {checkedCount} of {totalCheckTargets || "—"}
          {verifiedMatch ? " · Sent for approval" : ""}
          {batchStatus === "pending_approval" ? " · Pending coordinator" : ""}
        </p>
      </article>

      <section className="agent-callover-checklist">
        <div className="agent-callover-checklist-head">
          <h3>Verify customers</h3>
          {totalCheckTargets > 0 ? (
            <button
              type="button"
              className="button secondary"
              onClick={() => markAllChecked(collectedCustomerIds)}
            >
              Check all
            </button>
          ) : null}
        </div>

        {systemRows.length > 0 ? (
          <>
            <p className="muted agent-callover-checklist-label">Collected today</p>
            <div className="agent-callover-check-list">
              {systemRows.map(({ customerId, displayName, item, count }) =>
                renderCheckRow(
                  customerId,
                  displayName,
                  `${formatMoney(item.amount)}${count > 1 ? ` · ${count} payments` : ""}`,
                  isChecked(customerId)
                )
              )}
            </div>
          </>
        ) : (
          <p className="muted">No collections recorded today. Record contributions first, then return here for call-over.</p>
        )}
      </section>

      <div className="agent-callover-actions">
        <button
          type="button"
          className="button"
          disabled={sendDisabledReason !== null}
          onClick={() => void handleSendForApproval()}
        >
          {submitting ? "Sending…" : "Send for approval"}
        </button>
        <button type="button" className="button secondary" onClick={() => setPickerOpen(true)}>
          + Report a difference
        </button>
      </div>
      {sendDisabledReason && canSubmitCallover ? (
        <p className="muted agent-callover-send-hint">{sendDisabledReason}</p>
      ) : null}
      {!online ? (
        <p className="muted">Offline — checking is saved on this device. Submit when online.</p>
      ) : null}

      {discrepancies.length > 0 ? (
        <section className="agent-callover-diff-section">
          <h3>Differences ({discrepancies.length})</h3>
          <div className="agent-list">
            {discrepancies.map((d) => {
              const systemAmount = items.find((i) => i.customerId === d.customerId)?.amount ?? 0;
              const given = parseAmount(d.givenAmount);
              const variance = computeVariance(given, systemAmount);
              return (
                <article key={d.id} className="agent-list-item agent-callover-card">
                  <div className="agent-customer-card-head">
                    <strong>{d.customerName}</strong>
                    <button type="button" className="button secondary" onClick={() => removeDiscrepancy(d.id)}>
                      Remove
                    </button>
                  </div>
                  <p className="muted">In system: {formatMoney(systemAmount)}</p>
                  <label className="field">
                    <span>Amount customer gave you (GHS)</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={d.givenAmount}
                      onChange={(e) => updateDiscrepancy(d.id, { givenAmount: e.target.value })}
                      placeholder="0"
                    />
                  </label>
                  {given > 0 ? (
                    <p className={`agent-callover-variance agent-callover-variance--${variance.type}`}>
                      {variance.type === "shortage"
                        ? `Shortage: GHS ${variance.delta.toFixed(2)}`
                        : variance.type === "overage"
                          ? `Overage: GHS ${variance.delta.toFixed(2)}`
                          : "Amounts match"}
                    </p>
                  ) : null}
                  <label className="field">
                    <span>Notes (optional)</span>
                    <input
                      value={d.notes}
                      onChange={(e) => updateDiscrepancy(d.id, { notes: e.target.value })}
                    />
                  </label>
                </article>
              );
            })}
          </div>
          <label className="field">
            <span>Notes for coordinator</span>
            <textarea
              rows={2}
              value={reportNotes}
              onChange={(e) => setReportNotes(e.target.value)}
            />
          </label>
          <button
            type="button"
            className="button"
            disabled={submitting || !online || !canSubmitCallover}
            onClick={handleReportDifferences}
          >
            {submitting ? "Submitting…" : "Send differences for approval"}
          </button>
        </section>
      ) : null}

      {pickerOpen ? (
        <div className="agent-drawer-backdrop" role="presentation" onClick={() => setPickerOpen(false)}>
          <aside
            className="agent-drawer agent-drawer--sheet"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
          >
            <header className="agent-drawer-head">
              <h2>Which customer?</h2>
              <button type="button" className="button secondary" onClick={() => setPickerOpen(false)}>
                ✕
              </button>
            </header>
            <input
              type="search"
              className="agent-callover-picker-search"
              value={pickerQuery}
              onChange={(e) => setPickerQuery(e.target.value)}
              placeholder="Search name or phone"
            />
            <div className="agent-list">
              {pickerResults.map((row) => (
                <button
                  key={row.customerId}
                  type="button"
                  className="agent-list-item agent-list-item--button"
                  onClick={() => {
                    addDiscrepancy(row.customerId, row.displayName);
                    setPickerOpen(false);
                    setPickerQuery("");
                  }}
                >
                  <strong>{row.displayName}</strong>
                  <p className="muted">System: {formatMoney(row.item.amount)}</p>
                </button>
              ))}
            </div>
          </aside>
        </div>
      ) : null}
    </div>
  );
}
