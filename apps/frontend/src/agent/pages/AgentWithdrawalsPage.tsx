import { formatAccountAmount, formatGhs } from "@bms/shared";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { BalanceDisclosure } from "../../app/api";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { canConfirmDelivery, fulfillmentLabel, isAgentDelivered } from "../stores/agentBalanceStore";
import {
  selectDeliverableIds,
  selectTodayWithdrawals,
  selectWithdrawalActivityTotals,
  useAgentWithdrawalActivityStore,
  withdrawalStatusLabel,
  withdrawalStatusTone
} from "../stores/agentWithdrawalActivityStore";

type Tab = "today" | "deliver" | "all";

function money(amount: number): string {
  if (amount <= 0) {
    return "—";
  }
  return formatGhs(amount);
}

function formatWhen(iso: string): string {
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

function WithdrawalRow({
  row,
  busy,
  onDeliver
}: {
  row: BalanceDisclosure;
  busy: boolean;
  onDeliver: (id: string) => void;
}) {
  const amount = Number(row.withdrawalAmount ?? 0);
  const tone = withdrawalStatusTone(row);
  const deliverable = canConfirmDelivery(row);
  const delivered = isAgentDelivered(row);

  return (
    <article className={`agent-wd-card${deliverable ? " agent-wd-card--action" : ""}`}>
      <div className="agent-wd-card__top">
        <div className="agent-wd-card__identity">
          <strong>{row.customerName ?? "Customer"}</strong>
          <p className="muted">
            {row.customerAccountNumber ? `${row.customerAccountNumber} · ` : ""}
            {fulfillmentLabel(row.fulfillmentMode)}
          </p>
        </div>
        <div className="agent-wd-card__amount">
          <strong>{amount > 0 ? `GHS ${formatAccountAmount(amount)}` : "—"}</strong>
          <span className={`status-pill status-pill--${tone}`}>{withdrawalStatusLabel(row)}</span>
        </div>
      </div>

      <div className="agent-wd-card__meta muted">
        <span>Requested {formatWhen(row.requestedAt)}</span>
        {row.paidAt ? <span>Office paid {formatWhen(row.paidAt)}</span> : null}
        {row.agentDeliveredAt ? <span>Delivered {formatWhen(row.agentDeliveredAt)}</span> : null}
      </div>

      {row.status === "rejected" && row.rejectedReason ? (
        <p className="agent-wd-card__note muted">{row.rejectedReason}</p>
      ) : null}

      {deliverable ? (
        <button
          type="button"
          className="button agent-wd-card__deliver"
          disabled={busy}
          onClick={() => onDeliver(row.id)}
        >
          {busy ? "Confirming…" : "Mark delivered"}
        </button>
      ) : null}

      {delivered ? (
        <p className="agent-wd-card__done">Customer received — process complete</p>
      ) : null}
    </article>
  );
}

export function AgentWithdrawalsPage() {
  const { showToast } = useToast();
  const items = useAgentWithdrawalActivityStore((s) => s.items);
  const loading = useAgentWithdrawalActivityStore((s) => s.loading);
  const error = useAgentWithdrawalActivityStore((s) => s.error);
  const deliveringId = useAgentWithdrawalActivityStore((s) => s.deliveringId);
  const deliveringBulk = useAgentWithdrawalActivityStore((s) => s.deliveringBulk);
  const hydrate = useAgentWithdrawalActivityStore((s) => s.hydrate);
  const refresh = useAgentWithdrawalActivityStore((s) => s.refresh);
  const markDelivered = useAgentWithdrawalActivityStore((s) => s.markDelivered);
  const markAllDelivered = useAgentWithdrawalActivityStore((s) => s.markAllDelivered);
  const [tab, setTab] = useState<Tab>("today");

  useEffect(() => {
    hydrate({ force: true });
  }, [hydrate]);

  const todayRows = useMemo(() => selectTodayWithdrawals(items), [items]);
  const deliverRows = useMemo(() => items.filter((row) => canConfirmDelivery(row)), [items]);
  const totals = useMemo(() => selectWithdrawalActivityTotals(items), [items]);
  const deliverableIds = useMemo(() => selectDeliverableIds(items), [items]);

  const list =
    tab === "today" ? todayRows : tab === "deliver" ? deliverRows : items;

  async function handleDeliver(id: string) {
    try {
      await markDelivered(id);
      showToast("Marked as delivered — office notified", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not confirm delivery"), "error");
    }
  }

  async function handleDeliverAll() {
    if (deliverableIds.length === 0) {
      return;
    }
    try {
      const count = await markAllDelivered(deliverableIds);
      showToast(
        count === 1 ? "1 withdrawal marked delivered" : `${count} withdrawals marked delivered`,
        "success"
      );
      setTab("today");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not confirm deliveries"), "error");
    }
  }

  return (
    <div className="agent-page agent-wd-page">
      <header className="agent-wd-hero">
        <div className="agent-wd-hero__copy">
          <p className="muted agent-page-sub">
            <Link to="/app/agent/home">Home</Link>
            <span className="agent-page-sub__sep">·</span>
            Withdrawals
          </p>
          <h2>Withdrawal tracker</h2>
          <p className="muted">
            Follow each request from approval to office cash, then confirm delivery to the customer.
          </p>
        </div>
        <button
          type="button"
          className="button secondary agent-wd-hero__refresh"
          disabled={loading || deliveringBulk}
          onClick={() => void refresh()}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      <section className="agent-wd-kpis" aria-label="Today's withdrawal totals">
        <article className="agent-wd-kpi agent-wd-kpi--request">
          <span className="agent-wd-kpi__value">{money(totals.requestedAmount)}</span>
          <span className="agent-wd-kpi__label">Requested today</span>
          <span className="muted agent-wd-kpi__sub">
            {totals.requestedCount} request{totals.requestedCount === 1 ? "" : "s"}
            {totals.pendingCount > 0 ? ` · ${totals.pendingCount} pending` : ""}
          </span>
        </article>
        <article className="agent-wd-kpi agent-wd-kpi--approved">
          <span className="agent-wd-kpi__value">{money(totals.approvedAmount)}</span>
          <span className="agent-wd-kpi__label">Approved</span>
          <span className="muted agent-wd-kpi__sub">{totals.approvedCount} cleared</span>
        </article>
        <article className="agent-wd-kpi agent-wd-kpi--office">
          <span className="agent-wd-kpi__value">{money(totals.expectedOfficeCash)}</span>
          <span className="agent-wd-kpi__label">From office</span>
          <span className="muted agent-wd-kpi__sub">
            {totals.expectedOfficeCount} ready to collect
          </span>
        </article>
        <article className="agent-wd-kpi agent-wd-kpi--delivered">
          <span className="agent-wd-kpi__value">{money(totals.deliveredAmount)}</span>
          <span className="agent-wd-kpi__label">Delivered</span>
          <span className="muted agent-wd-kpi__sub">{totals.deliveredCount} to customers</span>
        </article>
      </section>

      {deliverableIds.length > 0 ? (
        <div className="agent-wd-bulk">
          <div>
            <strong>
              {deliverableIds.length} ready to mark delivered
            </strong>
            <p className="muted">
              Confirms the customer received cash. Admins and coordinators are notified.
            </p>
          </div>
          <button
            type="button"
            className="button"
            disabled={deliveringBulk || deliveringId !== null}
            onClick={() => void handleDeliverAll()}
          >
            {deliveringBulk ? "Marking…" : "Mark all delivered"}
          </button>
        </div>
      ) : null}

      {error ? <p className="form-error">{error}</p> : null}

      <div className="agent-filter-tabs agent-filter-tabs--wrap">
        <button
          type="button"
          className={`agent-filter-tab${tab === "today" ? " active" : ""}`}
          onClick={() => setTab("today")}
        >
          Today
          <span className="agent-filter-tab__count">{todayRows.length}</span>
        </button>
        <button
          type="button"
          className={`agent-filter-tab${tab === "deliver" ? " active" : ""}`}
          onClick={() => setTab("deliver")}
        >
          To deliver
          <span className="agent-filter-tab__count">{deliverRows.length}</span>
        </button>
        <button
          type="button"
          className={`agent-filter-tab${tab === "all" ? " active" : ""}`}
          onClick={() => setTab("all")}
        >
          All recent
          <span className="agent-filter-tab__count">{items.length}</span>
        </button>
      </div>

      {loading && list.length === 0 ? (
        <p className="muted">Loading withdrawal activity…</p>
      ) : list.length === 0 ? (
        <div className="agent-wd-empty">
          <strong>
            {tab === "deliver"
              ? "Nothing waiting to deliver"
              : tab === "today"
                ? "No withdrawals today"
                : "No withdrawal requests yet"}
          </strong>
          <p className="muted">
            {tab === "deliver"
              ? "After till Pay now, cash ready for delivery will show here."
              : "Request withdrawals from a customer card when you need office cash."}
          </p>
        </div>
      ) : (
        <div className="agent-wd-list">
          {list.map((row) => (
            <WithdrawalRow
              key={row.id}
              row={row}
              busy={deliveringId === row.id || deliveringBulk}
              onDeliver={(id) => void handleDeliver(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
