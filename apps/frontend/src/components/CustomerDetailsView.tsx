import { useEffect, useState, type ReactNode } from "react";
import { SAVINGS_INITIAL_DEPOSIT_GHS } from "@bms/shared";
import type { AccountType, Customer, LedgerEntry } from "../app/api";
import { getCustomerLedger } from "../app/api";
import { downloadCustomerLedgerCsv } from "../lib/customerLedgerCsv";
import { formatFieldAgent } from "../lib/formatFieldAgent";
import { useToast } from "./Toast";

const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  susu: "Susu",
  savings: "Savings",
  group: "Group",
  meba_daakye: "Meba Daakye"
};

const STATUS_LABELS: Record<Customer["status"], string> = {
  pending_activation: "Pending approval",
  active: "Active",
  rejected: "Rejected",
  suspended: "Suspended",
  closed: "Closed"
};

const STATUS_PILL: Record<Customer["status"], string> = {
  pending_activation: "pending",
  active: "active",
  rejected: "inactive",
  suspended: "inactive",
  closed: "inactive"
};

function InfoRow({ label, value, fullWidth }: { label: string; value: ReactNode; fullWidth?: boolean }) {
  return (
    <div className={`cif-row${fullWidth ? " cif-row--full" : ""}`}>
      <span className="cif-row__label">{label}</span>
      <span className="cif-row__value">{value ?? "—"}</span>
    </div>
  );
}

function Section({
  icon,
  title,
  children
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="cif-block">
      <header className="cif-block__head">
        <span className="cif-block__icon" aria-hidden>
          {icon}
        </span>
        <h3 className="cif-block__title">{title}</h3>
      </header>
      <div className="cif-block__body">{children}</div>
    </section>
  );
}

type Props = {
  customer: Customer;
  branchLabel?: string;
  agentLabel?: string;
  statusLabel?: string;
  /** Load balance and ledger in the main column (not footer actions). Default: active customers only. */
  showFinancials?: boolean;
};

const LEDGER_PAGE_SIZE = 7;

function formatLedgerDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return iso;
  }
}

export function CustomerDetailsView({
  customer,
  branchLabel,
  agentLabel,
  statusLabel,
  showFinancials = customer.status === "active"
}: Props) {
  const { showToast } = useToast();
  const [idLightbox, setIdLightbox] = useState(false);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [ledgerLoading, setLedgerLoading] = useState(false);
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [ledgerVisibleCount, setLedgerVisibleCount] = useState(LEDGER_PAGE_SIZE);

  const accountLabel = customer.accountType
    ? (ACCOUNT_TYPE_LABELS[customer.accountType] ?? customer.accountType)
    : "—";
  const status = statusLabel ?? STATUS_LABELS[customer.status] ?? customer.status;
  const address = [customer.location, customer.houseNumber].filter(Boolean).join(", ") || "—";
  const isSavings = customer.accountType === "savings";
  const hasKyc = Boolean(customer.photoUrl && customer.idCardPhotoUrl);
  const initials = customer.fullName
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p.charAt(0))
    .join("")
    .toUpperCase();

  useEffect(() => {
    if (!idLightbox) {
      return;
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIdLightbox(false);
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [idLightbox]);

  useEffect(() => {
    if (!showFinancials) {
      setLedger([]);
      setLedgerError(null);
      return;
    }
    let cancelled = false;
    setLedgerLoading(true);
    setLedgerError(null);
    void getCustomerLedger(customer.id)
      .then((entries) => {
        if (!cancelled) {
          setLedger(entries);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setLedger([]);
          setLedgerError(err instanceof Error ? err.message : "Could not load ledger");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLedgerLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [customer.id, showFinancials]);

  useEffect(() => {
    setLedgerVisibleCount(LEDGER_PAGE_SIZE);
  }, [customer.id]);

  const accountBalance =
    ledger.length > 0 ? ledger[ledger.length - 1]!.balanceAfter : 0;
  const lockedAmount = isSavings ? (customer.lockedBalance ?? SAVINGS_INITIAL_DEPOSIT_GHS) : 0;
  const withdrawableBalance = isSavings
    ? Math.max(0, accountBalance - lockedAmount)
    : accountBalance;
  const ledgerNewestFirst = [...ledger].reverse();
  const displayedLedger = ledgerNewestFirst.slice(0, ledgerVisibleCount);
  const olderEntriesCount = Math.max(0, ledgerNewestFirst.length - ledgerVisibleCount);

  function handleDownloadLedger() {
    if (ledger.length === 0) {
      return;
    }
    try {
      downloadCustomerLedgerCsv(customer, ledger);
      showToast("Ledger CSV downloaded", "success");
    } catch {
      showToast("Failed to download ledger CSV", "error");
    }
  }

  function handleShowOlderLedger() {
    setLedgerVisibleCount((count) =>
      Math.min(count + LEDGER_PAGE_SIZE, ledgerNewestFirst.length)
    );
  }

  return (
    <>
      <div className="cif">
        <main className="cif-main">
          <article className="cif-account-card">
            <div className="cif-account-card__chip" aria-hidden />
            <div className="cif-account-card__content">
              <p className="cif-account-card__eyebrow">BMS · Customer account</p>
              <p className="cif-account-card__number">
                {customer.accountNumber ?? "Pending assignment"}
              </p>
              <p className="cif-account-card__meta">
                <span>{accountLabel}</span>
                <span className="cif-account-card__dot" aria-hidden>
                  ·
                </span>
                <span>{branchLabel ?? customer.homeBranchId}</span>
              </p>
            </div>
            <span className={`status-pill status-pill--${STATUS_PILL[customer.status]} cif-account-card__status`}>
              {status}
            </span>
          </article>

          {showFinancials ? (
            <Section
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </svg>
              }
              title="Account balance & ledger"
            >
              <div className="cif-financial">
                <div className="cif-financial__balances">
                  <div className="cif-financial__balance cif-financial__balance--primary">
                    <span className="cif-financial__balance-label">Account balance</span>
                    <strong className="cif-financial__balance-value">
                      {ledgerLoading ? "…" : `GHS ${accountBalance.toFixed(2)}`}
                    </strong>
                  </div>
                  {isSavings ? (
                    <>
                      <div className="cif-financial__balance">
                        <span className="cif-financial__balance-label">Withdrawable</span>
                        <strong className="cif-financial__balance-value">
                          {ledgerLoading ? "…" : `GHS ${withdrawableBalance.toFixed(2)}`}
                        </strong>
                      </div>
                      <div className="cif-financial__balance">
                        <span className="cif-financial__balance-label">Locked</span>
                        <strong className="cif-financial__balance-value">
                          GHS {lockedAmount.toFixed(2)}
                        </strong>
                      </div>
                    </>
                  ) : null}
                </div>

                {ledgerError ? (
                  <p className="cif-empty muted" role="status">
                    {ledgerError}
                  </p>
                ) : ledgerLoading ? (
                  <p className="cif-empty muted">Loading ledger…</p>
                ) : (
                  <>
                    <div className="cif-ledger-toolbar">
                      <span className="muted cif-ledger-toolbar__hint">
                        {ledgerNewestFirst.length === 0
                          ? "No ledger entries yet"
                          : `Showing ${displayedLedger.length} of ${ledgerNewestFirst.length} entries (newest first)`}
                      </span>
                      <button
                        type="button"
                        className="button secondary cif-ledger-toolbar__download"
                        disabled={ledgerLoading || ledger.length === 0}
                        onClick={handleDownloadLedger}
                      >
                        Download CSV
                      </button>
                    </div>
                    {ledgerNewestFirst.length === 0 ? null : (
                      <>
                    <div className="cif-ledger" role="table" aria-label="Recent ledger entries">
                      <div className="cif-ledger__head cif-ledger__head--bold" role="row">
                        <span role="columnheader">
                          <strong>Date</strong>
                        </span>
                        <span role="columnheader">
                          <strong>Type</strong>
                        </span>
                        <span role="columnheader">
                          <strong>Amount</strong>
                        </span>
                        <span role="columnheader">
                          <strong>Recorded by</strong>
                        </span>
                        <span role="columnheader">
                          <strong>Balance after</strong>
                        </span>
                      </div>
                      {displayedLedger.map((entry) => (
                        <div className="cif-ledger__row" role="row" key={entry.id}>
                          <span>{formatLedgerDate(entry.createdAt)}</span>
                          <span className={`cif-ledger__type--${entry.entryType}`}>
                            {entry.entryType === "credit" ? "Credit" : "Debit"}
                          </span>
                          <span>GHS {entry.amount.toFixed(2)}</span>
                          <span
                            className="cif-ledger__by"
                            title={entry.performedByName ?? entry.recordedByName ?? undefined}
                          >
                            {entry.performedByName ?? entry.recordedByName ?? "—"}
                          </span>
                          <span>GHS {entry.balanceAfter.toFixed(2)}</span>
                        </div>
                      ))}
                    </div>
                    {olderEntriesCount > 0 ? (
                      <button
                        type="button"
                        className="button secondary cif-ledger__more"
                        onClick={handleShowOlderLedger}
                      >
                        Show older entries ({olderEntriesCount} more)
                      </button>
                    ) : null}
                      </>
                    )}
                  </>
                )}
                <p className="cif-footnote muted">
                  Post deposits or withdrawals from Susu → Branch counter.
                </p>
              </div>
            </Section>
          ) : null}

          <div className="cif-metrics" role="list">
            <div className="cif-metric" role="listitem">
              <span className="cif-metric__label">Daily plan</span>
              <strong className="cif-metric__value">
                {customer.dailyContributionAmount > 0
                  ? `GHS ${Number(customer.dailyContributionAmount).toFixed(2)}`
                  : "—"}
              </strong>
            </div>
            <div className="cif-metric" role="listitem">
              <span className="cif-metric__label">KYC</span>
              <strong className={`cif-metric__value${hasKyc ? " cif-metric__value--ok" : ""}`}>
                {hasKyc ? "Complete" : "Incomplete"}
              </strong>
            </div>
            <div className="cif-metric" role="listitem">
              <span className="cif-metric__label">Field agent</span>
              <strong className="cif-metric__value cif-metric__value--truncate">
                {agentLabel ?? formatFieldAgent(customer)}
              </strong>
            </div>
          </div>

          {customer.status === "pending_activation" ? (
            <div className="cif-alert cif-alert--info" role="status">
              Awaiting coordinator approval — confirm portrait and ID on the right before you approve.
            </div>
          ) : null}

          {customer.rejectionReason ? (
            <div className="cif-alert cif-alert--danger" role="status">
              <strong>Rejected</strong> — {customer.rejectionReason}
            </div>
          ) : null}

          <div className="cif-blocks">
            <Section
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              }
              title="Personal details"
            >
              <div className="cif-grid">
                <InfoRow label="Full legal name" value={customer.fullName} fullWidth />
                <InfoRow label="Mobile" value={customer.phone} />
                <InfoRow label="Email" value={customer.email || "—"} />
                <InfoRow label="Ghana Card / ID" value={customer.idCardNumber} />
                <InfoRow label="Address" value={address} fullWidth />
              </div>
            </Section>

            <Section
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <path d="M2 10h20" />
                </svg>
              }
              title="Account & product"
            >
              <div className="cif-grid">
                <InfoRow label="Product type" value={accountLabel} />
                <InfoRow
                  label="Contribution"
                  value={
                    customer.dailyContributionAmount > 0
                      ? `GHS ${Number(customer.dailyContributionAmount).toFixed(2)} / day`
                      : "Not configured"
                  }
                />
                {isSavings ? (
                  <>
                    <InfoRow
                      label="Locked balance"
                      value={`GHS ${(customer.lockedBalance ?? SAVINGS_INITIAL_DEPOSIT_GHS).toFixed(2)}`}
                    />
                    <InfoRow
                      label="Opening fee"
                      value={
                        customer.savingsOpeningFeeCollected === true
                          ? "Cash collected"
                          : customer.savingsOpeningFeeCollected === false
                            ? "Deduct from deposits"
                            : "—"
                      }
                    />
                    <p className="cif-footnote muted">
                      Locked amount cannot be withdrawn by the customer.
                    </p>
                  </>
                ) : null}
              </div>
            </Section>

            <Section
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              }
              title="Next of kin"
            >
              {customer.nextOfKin ? (
                <div className="cif-grid">
                  <InfoRow label="Name" value={customer.nextOfKin.fullName} fullWidth />
                  <InfoRow label="Phone" value={customer.nextOfKin.phone} />
                  <InfoRow
                    label="Address"
                    value={
                      [customer.nextOfKin.location, customer.nextOfKin.houseNumber]
                        .filter(Boolean)
                        .join(", ") || "—"
                    }
                    fullWidth
                  />
                </div>
              ) : (
                <p className="cif-empty muted">No next of kin recorded.</p>
              )}
            </Section>

            <Section
              icon={
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              }
              title="Branch & servicing"
            >
              <div className="cif-grid">
                <InfoRow label="Home branch" value={branchLabel ?? customer.homeBranchId} fullWidth />
                <InfoRow label="Assigned agent" value={agentLabel ?? formatFieldAgent(customer)} fullWidth />
                {customer.createdByFieldAgentName &&
                customer.createdByFieldAgentName !== customer.assignedFieldAgentName ? (
                  <InfoRow label="Registered by" value={customer.createdByFieldAgentName} fullWidth />
                ) : null}
              </div>
            </Section>
          </div>
        </main>

        <aside className="cif-rail" aria-label="Identity verification">
          <div className="cif-portrait">
            <div className="cif-portrait__frame">
              {customer.photoUrl ? (
                <img src={customer.photoUrl} alt="" className="cif-portrait__img" />
              ) : (
                <div className="cif-portrait__fallback" aria-hidden>
                  {initials}
                </div>
              )}
              {customer.status === "active" ? (
                <span className="cif-portrait__badge" title="Active account">
                  ✓
                </span>
              ) : null}
            </div>
            <p className="cif-portrait__name">{customer.fullName}</p>
            <p className="cif-portrait__role muted">{accountLabel} customer</p>
          </div>

          <div className="cif-kyc">
            <div className="cif-kyc__head">
              <span className="cif-kyc__title">ID verification</span>
              {customer.idCardPhotoUrl ? (
                <button type="button" className="cif-kyc__view" onClick={() => setIdLightbox(true)}>
                  View full
                </button>
              ) : null}
            </div>
            {customer.idCardPhotoUrl ? (
              <button
                type="button"
                className="cif-kyc__preview"
                onClick={() => setIdLightbox(true)}
                aria-label="Open ID document full size"
              >
                <img src={customer.idCardPhotoUrl} alt="" />
              </button>
            ) : (
              <div className="cif-kyc__missing">
                <span aria-hidden>🪪</span>
                <p className="muted">No ID scan on file</p>
              </div>
            )}
          </div>
        </aside>
      </div>

      {idLightbox && customer.idCardPhotoUrl ? (
        <div
          className="cif-lightbox"
          role="dialog"
          aria-label="ID document"
          onClick={() => setIdLightbox(false)}
        >
          <div className="cif-lightbox__panel" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="cif-lightbox__close"
              onClick={() => setIdLightbox(false)}
              aria-label="Close"
            >
              ✕
            </button>
            <img src={customer.idCardPhotoUrl} alt={`ID document for ${customer.fullName}`} />
            <p className="cif-lightbox__caption muted">
              {customer.idCardNumber} · {customer.fullName}
            </p>
          </div>
        </div>
      ) : null}
    </>
  );
}
