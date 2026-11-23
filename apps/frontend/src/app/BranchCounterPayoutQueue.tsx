import { formatAccountAmount, formatGhs, type Permission } from "@bms/shared";
import { useState } from "react";
import type { BalanceDisclosure } from "./api";
import { useToast } from "../components/Toast";
import { useAuth } from "../auth/AuthContext";
import { useTransactionPin } from "../auth/TransactionPinProvider";
import { ensureTransactionStepUpForRole } from "../lib/ensureTransactionStepUp";
import { toUserFacingError } from "../lib/networkError";
import { useBranchCounterStore } from "./stores/branchCounterStore";

type Props = {
  permissions?: Permission[];
};

export function BranchCounterPayoutQueue({ permissions }: Props) {
  const { user } = useAuth();
  const { requestStepUp } = useTransactionPin();
  const { showToast } = useToast();
  const pendingFieldPayouts = useBranchCounterStore((s) => s.pendingFieldPayouts);
  const customers = useBranchCounterStore((s) => s.customers);
  const payingPayoutId = useBranchCounterStore((s) => s.payingPayoutId);
  const payFieldPayout = useBranchCounterStore((s) => s.payFieldPayout);
  const floatSummary = useBranchCounterStore((s) => s.floatSummary);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const canPay =
    user?.role === "admin" ||
    user?.role === "teller" ||
    Boolean(permissions?.includes("agency.withdrawals.pay")) ||
    Boolean(permissions?.includes("transactions.create.withdrawal"));

  if (!canPay) {
    return null;
  }

  function accountNumberFor(row: BalanceDisclosure): string {
    if (row.customerAccountNumber?.trim()) {
      return row.customerAccountNumber.trim();
    }
    const fromCatalog = customers.find((c) => c.id === row.customerId)?.accountNumber;
    return fromCatalog?.trim() || "—";
  }

  async function handlePay(row: BalanceDisclosure) {
    try {
      await ensureTransactionStepUpForRole(user?.role, requestStepUp);
      await payFieldPayout(row.id);
      setConfirmId(null);
      showToast(
        row.fulfillmentMode === "momo"
          ? `Paid ${formatGhs(row.withdrawalAmount ?? 0)} (MoMo)`
          : `Paid ${formatGhs(row.withdrawalAmount ?? 0)}`,
        "success"
      );
    } catch (error) {
      showToast(toUserFacingError(error, "Pay now failed"), "error");
    }
  }

  return (
    <article className="card branch-counter-payout-queue">
      <header className="branch-counter-payout-queue__head">
        <div>
          <h3>Field withdrawals — Pay now</h3>
          
        </div>
        <span className="status-pill status-pill--pending">{pendingFieldPayouts.length} ready</span>
      </header>

      {pendingFieldPayouts.length === 0 ? (
        <p className="muted">No field withdrawals waiting for payout.</p>
      ) : (
        <ul className="branch-counter-payout-queue__list">
          {pendingFieldPayouts.map((row) => {
            const amount = Number(row.withdrawalAmount ?? 0);
            const isMomo = row.fulfillmentMode === "momo";
            const cashOk =
              floatSummary?.canTransact &&
              (floatSummary.expectedCash ?? 0) + 1e-9 >= amount;
            const confirming = confirmId === row.id;
            return (
              <li key={row.id} className="branch-counter-payout-queue__item">
                <div className="branch-counter-payout-queue__info">
                  <div className="branch-counter-payout-queue__row">
                    <strong>{row.customerName ?? row.customerId}</strong>
                    <span className="branch-counter-payout-queue__acct muted">
                      {accountNumberFor(row)}
                    </span>
                    {isMomo ? (
                      <span className="status-pill status-pill--active branch-counter-payout-queue__momo-pill">
                        MoMo
                      </span>
                    ) : null}
                    <span className="branch-counter-payout-queue__amount">
                      {formatGhs(amount)}
                    </span>
                  </div>
                  {isMomo ? (
                    <small className="branch-counter-payout-queue__momo-meta">
                      MoMo: {row.momoAccountName || "—"} · {row.momoNumber || "—"}
                    </small>
                  ) : null}
                  {!cashOk ? (
                    <small className="branch-counter-payout-queue__warn">
                      Need GHS {formatAccountAmount(amount)} till cash
                      {floatSummary?.canTransact
                        ? ` (have ${formatAccountAmount(floatSummary.expectedCash ?? 0)}) — collect Extra cash`
                        : " — open till first"}
                    </small>
                  ) : null}
                </div>
                <div className="platform-actions-buttons">
                  {confirming ? (
                    <>
                      <button
                        type="button"
                        className="button"
                        disabled={payingPayoutId === row.id || !cashOk}
                        onClick={() => void handlePay(row)}
                      >
                        {payingPayoutId === row.id ? "Paying…" : "Confirm pay"}
                      </button>
                      <button
                        type="button"
                        className="button secondary"
                        disabled={payingPayoutId === row.id}
                        onClick={() => setConfirmId(null)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="button"
                      disabled={payingPayoutId !== null || !cashOk}
                      onClick={() => setConfirmId(row.id)}
                    >
                      Pay now
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
}
