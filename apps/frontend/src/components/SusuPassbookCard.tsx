import { useEffect, useMemo, useState } from "react";
import type { SusuPassbookBox, SusuPassbookCard as SusuPassbookCardModel } from "@bms/shared";
import { printSusuPassbookCard } from "../app/susuPassbookDocument";
import { useSusuCycleCommissionStore } from "../app/stores/susuCycleCommissionStore";
import { useToast } from "./Toast";

type Props = {
  customerId: string;
  customerName?: string;
  accountNumber?: string;
  compact?: boolean;
};

function formatShortMoney(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? rounded.toLocaleString() : rounded.toFixed(2);
}

function formatMoney(value: number): string {
  return `GHS ${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatShortDate(iso: string | null): string {
  if (!iso) {
    return "";
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return "";
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function cardStatusLabel(status: SusuPassbookCardModel["status"]): string {
  if (status === "matured") {
    return "Completed";
  }
  if (status === "closed") {
    return "Cancelled";
  }
  return "Active";
}

function boxTooltip(box: SusuPassbookBox, card: SusuPassbookCardModel): string {
  const parts = [`Page #${card.cycleNumber} · Box ${box.boxNumber} of ${card.cycleDays}`];
  if (box.isFeeBox) {
    parts.push("Institution commission box");
  } else {
    parts.push("Customer savings box");
  }
  if (box.status === "checked") {
    parts.push(`Checked (${formatMoney(box.filledAmount)})`);
  } else if (box.status === "partial") {
    parts.push(`Partial: ${formatMoney(box.filledAmount)} / ${formatMoney(box.targetAmount)}`);
  } else {
    parts.push(`Unfilled (${formatMoney(box.targetAmount)})`);
  }
  if (box.filledAt) {
    parts.push(`Updated ${new Date(box.filledAt).toLocaleString()}`);
  }
  return parts.join(" • ");
}

export function SusuPassbookCard({ customerId, customerName, accountNumber, compact = false }: Props) {
  const { showToast } = useToast();
  const summary = useSusuCycleCommissionStore((s) => s.summaryByCustomer[customerId] ?? null);
  const loading = useSusuCycleCommissionStore((s) => Boolean(s.summaryLoadingByCustomer[customerId]));
  const error = useSusuCycleCommissionStore((s) => s.summaryErrorByCustomer[customerId] ?? null);
  const ensureCustomerPassbook = useSusuCycleCommissionStore((s) => s.ensureCustomerPassbook);
  const startPassbookLiveSync = useSusuCycleCommissionStore((s) => s.startPassbookLiveSync);
  const stopPassbookLiveSync = useSusuCycleCommissionStore((s) => s.stopPassbookLiveSync);

  const [selectedCycleNumber, setSelectedCycleNumber] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    setSelectedCycleNumber(null);
    if (!customerId) {
      return;
    }
    void ensureCustomerPassbook(customerId);
    startPassbookLiveSync(customerId);
    return () => {
      stopPassbookLiveSync();
    };
  }, [customerId, ensureCustomerPassbook, startPassbookLiveSync, stopPassbookLiveSync]);

  const passbook = summary?.passbook ?? null;
  const cards = passbook?.cards ?? [];

  const activeCard = useMemo(() => {
    if (cards.length === 0) {
      return null;
    }
    if (selectedCycleNumber !== null) {
      const found = cards.find((c) => c.cycleNumber === selectedCycleNumber);
      if (found) {
        return found;
      }
    }
    const latestActive =
      cards.find((c) => c.cycleNumber === passbook?.activeCardNumber) ?? cards[cards.length - 1];
    return latestActive ?? null;
  }, [cards, passbook?.activeCardNumber, selectedCycleNumber]);

  const progressPct = useMemo(() => {
    if (!activeCard || activeCard.cycleDays <= 0) {
      return 0;
    }
    const partialFraction =
      activeCard.partialBoxAmount > 0 && activeCard.dailyContributionAmount > 0
        ? Math.min(0.99, activeCard.partialBoxAmount / activeCard.dailyContributionAmount)
        : 0;
    return Math.min(100, ((activeCard.checkedBoxes + partialFraction) / activeCard.cycleDays) * 100);
  }, [activeCard]);

  const handleRefresh = async () => {
    if (!customerId || refreshing) {
      return;
    }
    setRefreshing(true);
    try {
      await ensureCustomerPassbook(customerId, { force: true });
    } finally {
      setRefreshing(false);
    }
  };

  if (loading && !passbook) {
    return (
      <section className={`susu-passbook ${compact ? "is-compact" : ""}`} aria-label="Susu passbook">
        <div className="susu-passbook-head">
          <div>
            <h4 className="susu-passbook-title">Susu passbook</h4>
            <p className="susu-passbook-sub">Loading passbook pages...</p>
          </div>
        </div>
      </section>
    );
  }

  if (error && !passbook) {
    return (
      <section className={`susu-passbook ${compact ? "is-compact" : ""}`} aria-label="Susu passbook">
        <div className="susu-passbook-head">
          <div>
            <h4 className="susu-passbook-title">Susu passbook</h4>
            <p className="susu-passbook-sub">{error}</p>
          </div>
          <button
            type="button"
            className="button secondary susu-passbook-refresh"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
          >
            {refreshing ? "Refreshing..." : "Retry"}
          </button>
        </div>
      </section>
    );
  }

  if (!passbook || !activeCard) {
    return null;
  }

  const dailyPlan = activeCard.dailyContributionAmount;
  const feeBoxNum = activeCard.boxes.find((b) => b.isFeeBox)?.boxNumber ?? null;
  const latestCardNumber = cards[cards.length - 1]?.cycleNumber ?? activeCard.cycleNumber;
  const pendingNextDaily = passbook.pendingDailyContributionAmount ?? null;
  const isCancelledCard = Boolean(activeCard.cancelled || activeCard.status === "closed");
  const cardBbf = Number(activeCard.balanceBroughtForward ?? 0);
  const cardBbfRemaining = Number(activeCard.bbfRemaining ?? cardBbf);

  return (
    <section
      className={`susu-passbook ${compact ? "is-compact" : ""} ${isCancelledCard ? "is-cancelled-card" : ""}`}
      aria-label="Susu passbook"
    >
      <div className="susu-passbook-head">
        <div className="susu-passbook-title-group">
          <div className="susu-passbook-title-row">
            <h4 className="susu-passbook-title">Susu passbook</h4>
            <span
              className={`susu-passbook-status is-${activeCard.status}${isCancelledCard ? " is-cancelled" : ""}`}
            >
              {cardStatusLabel(activeCard.status)}
            </span>
          </div>
          <p className="susu-passbook-sub">
            {customerName ? `${customerName} · ` : ""}
            {dailyPlan > 0
              ? `GHS ${formatShortMoney(dailyPlan)} / box · ${activeCard.cycleDays}-day page`
              : `${activeCard.cycleDays}-day page · set daily contribution to track boxes`}
            {feeBoxNum ? ` · Box ${feeBoxNum} = Fee` : ""}
          </p>
          {pendingNextDaily && pendingNextDaily > 0 ? (
            <p className="susu-passbook-next-rate" role="status">
              Scheduled for Page #{latestCardNumber + 1}:{" "}
              <strong>GHS {formatShortMoney(pendingNextDaily)} / box</strong> (current page stays at{" "}
              GHS {formatShortMoney(dailyPlan)})
            </p>
          ) : null}
        </div>

        <div className="susu-passbook-actions">
          {cards.length > 1 ? (
            <div className="susu-passbook-switcher" role="tablist" aria-label="Susu passbook pages">
              {cards.map((card) => {
                const isSelected = card.cycleNumber === activeCard.cycleNumber;
                const tabCancelled = Boolean(card.cancelled || card.status === "closed");
                return (
                  <button
                    key={card.cycleNumber}
                    type="button"
                    role="tab"
                    aria-selected={isSelected}
                    className={`susu-passbook-tab ${isSelected ? "is-active" : ""} is-${card.status}${tabCancelled ? " is-cancelled" : ""}`}
                    onClick={() => setSelectedCycleNumber(card.cycleNumber)}
                  >
                    <span>Page #{card.cycleNumber}</span>
                    <span className="susu-passbook-tab-count">
                      {card.checkedBoxes}/{card.cycleDays}
                    </span>
                    {!tabCancelled && (card.bbfRemaining ?? 0) > 0.005 ? (
                      <span
                        className="susu-passbook-tab-bbf"
                        title={`Balance brought forward: ${formatMoney(card.bbfRemaining ?? 0)}`}
                      >
                        BBF
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <span className="susu-passbook-card-pill">Page #{activeCard.cycleNumber}</span>
          )}

          <button
            type="button"
            className="button secondary susu-passbook-refresh"
            onClick={() => {
              void printSusuPassbookCard({
                card: activeCard,
                customerName: customerName || "Customer",
                accountNumber
              }).catch((err) =>
                showToast(err instanceof Error ? err.message : "Could not print passbook", "error")
              );
            }}
            title="Print this Susu passbook card"
          >
            Print card
          </button>

          <button
            type="button"
            className="button secondary susu-passbook-refresh"
            onClick={() => void handleRefresh()}
            disabled={refreshing}
            title="Refresh Susu passbook"
          >
            {refreshing ? "..." : "Refresh"}
          </button>
        </div>
      </div>

      {cardBbf > 0.005 ? (
        <div className="susu-passbook-bbf" role="note">
          <div className="susu-passbook-bbf__main">
            <span className="susu-passbook-bbf__badge">BBF</span>
            <div>
              <strong>
                Balance brought forward: {formatMoney(cardBbfRemaining)}
                {cardBbfRemaining + 0.005 < cardBbf
                  ? ` (of ${formatMoney(cardBbf)} brought forward)`
                  : ""}
              </strong>
              <small>
                Carried over from previous cancelled page(s). Does not auto-mark boxes on Page #
                {activeCard.cycleNumber}; future withdrawals use BBF first with GHS 0 extra fee.
              </small>
            </div>
          </div>
        </div>
      ) : null}

      <div className="susu-passbook-progress">
        <div className="susu-passbook-progress-meta">
          <strong>
            {activeCard.checkedBoxes} / {activeCard.cycleDays} boxes checked
          </strong>
          {isCancelledCard ? (
            <span className="susu-passbook-cancelled-note">
              Cancelled · settled by withdrawal
              {activeCard.cancelledAt ? ` (${formatShortDate(activeCard.cancelledAt)})` : ""}
            </span>
          ) : activeCard.partialBoxNumber && activeCard.partialBoxAmount > 0 ? (
            <span className="susu-passbook-partial-note">
              Box {activeCard.partialBoxNumber}: GHS {formatShortMoney(activeCard.partialBoxAmount)} /{" "}
              {formatShortMoney(dailyPlan)} (partial)
            </span>
          ) : (
            <span className="susu-passbook-partial-note">
              {activeCard.status === "matured"
                ? "Page completed"
                : `${Math.max(0, activeCard.cycleDays - activeCard.checkedBoxes)} boxes remaining`}
            </span>
          )}
        </div>
        <div
          className="susu-passbook-progress-track"
          role="progressbar"
          aria-valuenow={Math.round(progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div className="susu-passbook-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>

      <div className="susu-passbook-stats">
        <div className="susu-passbook-stat">
          <span>Page #{activeCard.cycleNumber} deposits</span>
          <strong>{formatMoney(activeCard.grossContributions)}</strong>
        </div>
        <div className="susu-passbook-stat">
          <span>Page #{activeCard.cycleNumber} credited</span>
          <strong>{formatMoney(activeCard.customerSavingsCredited)}</strong>
        </div>
        <div className="susu-passbook-stat">
          <span>Page #{activeCard.cycleNumber} fee</span>
          <strong>
            {formatMoney(activeCard.commissionCollected)}
            {!isCancelledCard && activeCard.commissionOutstanding > 0.005 ? (
              <small> ({formatMoney(activeCard.commissionOutstanding)} due)</small>
            ) : null}
          </strong>
        </div>
      </div>

      {typeof passbook.accountBalance === "number" &&
      typeof passbook.totalNetCredited === "number" ? (
        <div className="susu-passbook-tally" role="note">
          <span>
            All pages credited <strong>{formatMoney(passbook.totalNetCredited)}</strong>
          </span>
          {(passbook.otherCredits ?? 0) > 0.005 ? (
            <span>
              + Other credits <strong>{formatMoney(passbook.otherCredits ?? 0)}</strong>
            </span>
          ) : null}
          {(passbook.totalWithdrawalsAndCharges ?? 0) > 0.005 ? (
            <span>
              − Withdrawals &amp; charges{" "}
              <strong>{formatMoney(passbook.totalWithdrawalsAndCharges ?? 0)}</strong>
            </span>
          ) : null}
          <span className="susu-passbook-tally-eq">
            = Account balance <strong>{formatMoney(passbook.accountBalance)}</strong>
          </span>
        </div>
      ) : null}

      <div className={`susu-passbook-grid-wrap${isCancelledCard ? " is-cancelled" : ""}`}>
        <div
          className={`susu-passbook-grid ${compact ? "is-compact" : ""}`}
          role="list"
          aria-label={`Page #${activeCard.cycleNumber} contribution boxes`}
        >
          {activeCard.boxes.map((box) => {
          const fillPct =
            box.targetAmount > 0
              ? Math.min(100, Math.round((box.filledAmount / box.targetAmount) * 100))
              : box.status === "checked"
                ? 100
                : 0;
          return (
            <div
              key={box.boxNumber}
              role="listitem"
              className={`susu-passbook-box is-${box.status} ${box.isFeeBox ? "is-fee" : ""}`}
              title={boxTooltip(box, activeCard)}
            >
              <div className="susu-passbook-box-top">
                <span className="susu-passbook-box-num">{box.boxNumber}</span>
                {box.isFeeBox ? (
                  <span className="susu-passbook-fee-badge">Fee</span>
                ) : box.status === "checked" ? (
                  <span className="susu-passbook-check" aria-label="Checked">
                    <svg viewBox="0 0 16 16" width="12" height="12" fill="none" aria-hidden="true">
                      <path
                        d="M3.2 8.4L6.4 11.6L12.8 4.8"
                        stroke="currentColor"
                        strokeWidth="2.2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                ) : null}
              </div>

              {box.status === "checked" ? (
                <div className="susu-passbook-box-body">
                  <div className="susu-passbook-box-checked-row">
                    {box.isFeeBox ? (
                      <span className="susu-passbook-check" aria-label="Checked">
                        <svg viewBox="0 0 16 16" width="11" height="11" fill="none" aria-hidden="true">
                          <path
                            d="M3.2 8.4L6.4 11.6L12.8 4.8"
                            stroke="currentColor"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </span>
                    ) : null}
                    <span className="susu-passbook-box-amt">{formatShortMoney(box.filledAmount)}</span>
                  </div>
                  <span className="susu-passbook-box-date">{formatShortDate(box.filledAt) || "Paid"}</span>
                </div>
              ) : box.status === "partial" ? (
                <div className="susu-passbook-box-body">
                  <span className="susu-passbook-box-partial">
                    {formatShortMoney(box.filledAmount)}/{formatShortMoney(box.targetAmount)}
                  </span>
                  <div className="susu-passbook-box-bar">
                    <span style={{ width: `${fillPct}%` }} />
                  </div>
                </div>
              ) : (
                <div className="susu-passbook-box-body is-empty">
                  <span className="susu-passbook-box-empty-dash">—</span>
                </div>
              )}
            </div>
          );
        })}
        </div>
        {isCancelledCard ? (
          <div className="susu-passbook-cancel-overlay" aria-hidden="true">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none">
              <line x1="2" y1="98" x2="98" y2="2" stroke="currentColor" strokeWidth="1.6" />
              <line x1="2" y1="2" x2="98" y2="98" stroke="currentColor" strokeWidth="0.9" strokeOpacity="0.45" />
            </svg>
            <span className="susu-passbook-cancel-stamp">Cancelled</span>
          </div>
        ) : null}
      </div>

      <div className="susu-passbook-legend">
        <span className="susu-passbook-legend-item">
          <i className="susu-passbook-dot is-checked" /> Checked
        </span>
        <span className="susu-passbook-legend-item">
          <i className="susu-passbook-dot is-partial" /> Partial
        </span>
        <span className="susu-passbook-legend-item">
          <i className="susu-passbook-dot is-fee" /> Fee box
        </span>
        <span className="susu-passbook-legend-item">
          <i className="susu-passbook-dot is-empty" /> Open box
        </span>
        {isCancelledCard ? (
          <span className="susu-passbook-legend-item susu-passbook-legend-item--cancelled">
            <i className="susu-passbook-dot is-cancelled" /> Cancelled page
          </span>
        ) : null}
      </div>
    </section>
  );
}
