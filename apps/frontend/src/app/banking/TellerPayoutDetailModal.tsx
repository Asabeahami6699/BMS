import type { BalanceDisclosure } from "../api";
import { isManualPartnerWithdrawal } from "@bms/shared";
import { Modal } from "../../components/Modal";
import { formatWorkspaceMoney } from "../stores/roleWorkspaceStore";

export type TellerPayoutRow = BalanceDisclosure & {
  workflowData?: Record<string, unknown>;
  bankProductId?: string;
  bankProductName?: string;
  bankLabel?: string;
  csApprovedAt?: string;
  csApprovedBy?: string;
};

type Props = {
  open: boolean;
  row: TellerPayoutRow | null;
  busy: boolean;
  onClose: () => void;
  onPay: () => void;
};

function fulfillmentLabel(mode?: BalanceDisclosure["fulfillmentMode"]): string {
  if (mode === "momo") return "MoMo";
  if (mode === "agent_next_day") return "Agent cash";
  return "Cash at branch";
}

function customerCategoryLabel(row: TellerPayoutRow): string {
  return isManualPartnerWithdrawal(row) ? "Non-BMS walk-in" : "BMS member";
}

function humanizeWorkflowKey(key: string): string {
  return key
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatWorkflowValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "—";
  return String(value);
}

function formatDateTime(value?: string): string {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function TellerPayoutDetailModal({ open, row, busy, onClose, onPay }: Props) {
  if (!row) {
    return null;
  }

  const workflow = row.workflowData ?? {};
  const workflowEntries = Object.entries(workflow).filter(
    ([key, value]) => key !== "manual_partner_account" && value != null && value !== ""
  );
  const partnerAccount =
    typeof workflow.account_number === "string" ? workflow.account_number : undefined;
  const bankProduct =
    row.bankLabel && row.bankProductName
      ? `${row.bankLabel} — ${row.bankProductName}`
      : row.bankProductName ?? row.bankLabel ?? "—";

  return (
    <Modal
      open={open}
      title="Withdrawal details"
      subtitle="Review all details before paying cash at the till."
      onClose={onClose}
      panelClassName="modal-panel--70"
      footer={
        <>
          <button type="button" className="button secondary" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" disabled={busy} onClick={onPay}>
            {busy ? "Paying…" : "Pay cash"}
          </button>
        </>
      }
    >
      <dl className="teller-payout-detail__grid">
        <div>
          <dt>Transaction type</dt>
          <dd>Withdrawal</dd>
        </div>
        <div>
          <dt>Customer category</dt>
          <dd>{customerCategoryLabel(row)}</dd>
        </div>
        <div>
          <dt>Fulfillment</dt>
          <dd>{fulfillmentLabel(row.fulfillmentMode)}</dd>
        </div>
        <div>
          <dt>Amount</dt>
          <dd>{formatWorkspaceMoney(row.withdrawalAmount ?? 0)}</dd>
        </div>
        <div>
          <dt>Customer</dt>
          <dd>{row.customerName ?? "—"}</dd>
        </div>
        <div>
          <dt>Partner account</dt>
          <dd>{partnerAccount ?? "—"}</dd>
        </div>
        <div>
          <dt>Bank product</dt>
          <dd>{bankProduct}</dd>
        </div>
        <div>
          <dt>Reason</dt>
          <dd>{row.requestReason?.trim() || "—"}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>{formatDateTime(row.requestedAt)}</dd>
        </div>
        <div>
          <dt>CS verified</dt>
          <dd>
            {row.csApprovedAt
              ? formatDateTime(row.csApprovedAt)
              : isManualPartnerWithdrawal(row)
                ? "Skipped (walk-in)"
                : "—"}
          </dd>
        </div>
        <div>
          <dt>Request ID</dt>
          <dd className="teller-payout-detail__mono">{row.id}</dd>
        </div>
      </dl>

      {workflowEntries.length > 0 ? (
        <section className="teller-payout-detail__workflow">
          <h3>Capture details</h3>
          <dl className="teller-payout-detail__grid teller-payout-detail__grid--workflow">
            {workflowEntries.map(([key, value]) => (
              <div key={key}>
                <dt>{humanizeWorkflowKey(key)}</dt>
                <dd>{formatWorkflowValue(value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
    </Modal>
  );
}
