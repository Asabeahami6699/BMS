import { formatAccountAmount } from "@bms/shared";
import { useEffect, useState } from "react";
import type { Customer, LedgerEntry } from "./api";
import { printCustomerAccountStatement } from "./customerAccountStatement";
import {
  selectLedgerForCustomer,
  useCustomerLedgerStore
} from "./stores/customerLedgerStore";
import { downloadCustomerLedgerCsv } from "../lib/customerLedgerCsv";
import { useAuth } from "../auth/AuthContext";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";

type Props = {
  open: boolean;
  customer: Customer | null;
  onClose: () => void;
};

const LEDGER_PAGE_SIZE = 10;

function todayIsoDate(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysAgoIsoDate(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

function entryTypeLabel(entry: LedgerEntry): string {
  if (entry.transactionType === "susu_reversal") {
    return "Reversal";
  }
  const reasonOrNotes = `${entry.reason ?? ""} ${entry.notes ?? ""}`.toLowerCase();
  if (reasonOrNotes.includes("loan repayment")) {
    return "Loan repayment";
  }
  if (reasonOrNotes.includes("settled shortage")) {
    return "Settled shortage";
  }
  return entry.entryType === "credit" ? "Credit" : "Debit";
}

function entryReason(entry: LedgerEntry): string {
  if (entry.reason?.trim()) {
    return entry.reason.trim();
  }
  if (entry.notes?.toLowerCase().includes("loan repayment")) {
    return entry.notes.replace(/\s*·\s*loan_repay:[0-9a-f-]+/gi, "").trim();
  }
  return "—";
}

export function CustomerAccountStatementModal({ open, customer, onClose }: Props) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const [statementFromDate, setStatementFromDate] = useState(() => daysAgoIsoDate(30));
  const [statementToDate, setStatementToDate] = useState(() => todayIsoDate());
  const [ledgerVisibleCount, setLedgerVisibleCount] = useState(LEDGER_PAGE_SIZE);
  const [printBusy, setPrintBusy] = useState(false);

  const customerId = customer?.id ?? "";
  const ledger = useCustomerLedgerStore((s) => selectLedgerForCustomer(s, customerId));
  const ledgerLoading = useCustomerLedgerStore((s) =>
    customerId ? Boolean(s.loadingByCustomer[customerId]) : false
  );
  const ledgerError = useCustomerLedgerStore((s) =>
    customerId ? (s.errorByCustomer[customerId] ?? null) : null
  );

  useEffect(() => {
    if (!open || !customerId) {
      return;
    }
    setStatementFromDate(daysAgoIsoDate(30));
    setStatementToDate(todayIsoDate());
    setLedgerVisibleCount(LEDGER_PAGE_SIZE);
    const store = useCustomerLedgerStore.getState();
    void store.ensureLedger(customerId, { force: true });
    store.startLiveSync();
    return () => useCustomerLedgerStore.getState().stopLiveSync();
  }, [open, customerId]);

  if (!customer) {
    return null;
  }

  const activeCustomer = customer;
  const accountBalance = ledger.length > 0 ? ledger[ledger.length - 1]!.balanceAfter : 0;
  const ledgerNewestFirst = [...ledger].reverse();
  const displayedLedger = ledgerNewestFirst.slice(0, ledgerVisibleCount);
  const olderEntriesCount = Math.max(0, ledgerNewestFirst.length - ledgerVisibleCount);

  const subtitle = [
    activeCustomer.accountNumber ? `Acct ${activeCustomer.accountNumber}` : null,
    activeCustomer.accountType?.replace(/_/g, " "),
    activeCustomer.status.replace(/_/g, " ")
  ]
    .filter(Boolean)
    .join(" · ");

  function handleDownloadLedger() {
    if (ledger.length === 0) {
      return;
    }
    try {
      downloadCustomerLedgerCsv(activeCustomer, ledger);
      showToast("Ledger CSV downloaded", "success");
    } catch {
      showToast("Failed to download ledger CSV", "error");
    }
  }

  async function handlePrintStatement() {
    if (ledger.length === 0 || printBusy) {
      return;
    }
    setPrintBusy(true);
    try {
      showToast("Preparing statement PDF…", "info");
      await printCustomerAccountStatement({
        customer: activeCustomer,
        ledger,
        companyName: user?.tenantName,
        fromDate: statementFromDate,
        toDate: statementToDate
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not print statement", "error");
    } finally {
      setPrintBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Account statement — ${activeCustomer.fullName}`}
      subtitle={subtitle || "Account history"}
      onClose={onClose}
      panelClassName="modal-panel--70 modal-panel--customer modal-panel--statement"
      footer={
        <button type="button" className="button secondary" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="cif account-statement-modal">
        <div className="cif-financial">
          <div className="cif-financial__balances">
            <div className="cif-financial__balance cif-financial__balance--primary">
              <span className="cif-financial__balance-label">Account balance</span>
              <strong className="cif-financial__balance-value">
                {ledgerLoading && ledger.length === 0 ? "…" : `GHS ${formatAccountAmount(accountBalance)}`}
              </strong>
            </div>
          </div>

          {ledgerError ? (
            <p className="cif-empty muted" role="status">
              {ledgerError}
            </p>
          ) : ledgerLoading && ledger.length === 0 ? (
            <p className="cif-empty muted">Loading account history…</p>
          ) : (
            <>
              <div className="cif-ledger-toolbar">
                <span className="muted cif-ledger-toolbar__hint">
                  {ledgerNewestFirst.length === 0
                    ? "No ledger entries yet"
                    : `Showing ${displayedLedger.length} of ${ledgerNewestFirst.length} entries (newest first)`}
                </span>
                <div className="cif-ledger-toolbar__actions">
                  <label className="field cif-ledger-toolbar__date">
                    <span>From</span>
                    <input
                      type="date"
                      value={statementFromDate}
                      max={statementToDate || undefined}
                      onChange={(e) => setStatementFromDate(e.target.value)}
                    />
                  </label>
                  <label className="field cif-ledger-toolbar__date">
                    <span>To</span>
                    <input
                      type="date"
                      value={statementToDate}
                      min={statementFromDate || undefined}
                      onChange={(e) => setStatementToDate(e.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className="button secondary cif-ledger-toolbar__download"
                    disabled={ledgerLoading || ledger.length === 0 || printBusy}
                    onClick={() => void handlePrintStatement()}
                  >
                    {printBusy ? "Preparing…" : "Print statement"}
                  </button>
                  <button
                    type="button"
                    className="button secondary cif-ledger-toolbar__download"
                    disabled={ledgerLoading || ledger.length === 0}
                    onClick={handleDownloadLedger}
                  >
                    Download CSV
                  </button>
                </div>
              </div>

              {ledgerNewestFirst.length === 0 ? null : (
                <>
                  <div className="cif-ledger" role="table" aria-label="Account statement entries">
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
                        <strong>Reason</strong>
                      </span>
                      <span role="columnheader">
                        <strong>Recorded by</strong>
                      </span>
                      <span role="columnheader">
                        <strong>Balance after</strong>
                      </span>
                    </div>
                    {displayedLedger.map((entry) => {
                      const typeLabel = entryTypeLabel(entry);
                      const reason = entryReason(entry);
                      return (
                        <div className="cif-ledger__row cif-ledger__row--with-reason" role="row" key={entry.id}>
                          <span>{formatLedgerDate(entry.createdAt)}</span>
                          <span
                            className={`cif-ledger__type--${entry.entryType}`}
                            title={entry.notes ?? undefined}
                          >
                            {typeLabel}
                            {entry.reversalStatus === "reversed" ? " · Reversed" : ""}
                          </span>
                          <span>GHS {formatAccountAmount(entry.amount)}</span>
                          <span className="cif-ledger__reason" title={reason !== "—" ? reason : undefined}>
                            {reason}
                          </span>
                          <span
                            className="cif-ledger__by"
                            title={entry.performedByName ?? entry.recordedByName ?? undefined}
                          >
                            {entry.performedByName ?? entry.recordedByName ?? "—"}
                          </span>
                          <span>GHS {formatAccountAmount(entry.balanceAfter)}</span>
                        </div>
                      );
                    })}
                  </div>
                  {olderEntriesCount > 0 ? (
                    <button
                      type="button"
                      className="button secondary cif-ledger__more"
                      onClick={() =>
                        setLedgerVisibleCount((count) =>
                          Math.min(count + LEDGER_PAGE_SIZE, ledgerNewestFirst.length)
                        )
                      }
                    >
                      Show older entries ({olderEntriesCount} more)
                    </button>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
