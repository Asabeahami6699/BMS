import type { AgentNotification } from "../app/api";

/** Alerts that belong on the field-agent Alerts tab (not staff-desk noise). */
export const FIELD_AGENT_ALERT_KINDS = new Set<AgentNotification["kind"]>([
  "registration_approved",
  "registration_rejected",
  "registration_pending",
  "balance_disclosure_approved",
  "balance_disclosure_rejected",
  "balance_request_pending",
  "withdrawal_request_approved",
  "withdrawal_request_rejected",
  "withdrawal_request_pending",
  "withdrawal_momo_sent",
  "collection_batch_pending",
  "collection_batch_posted",
  "cash_shortage_opened",
  "cash_overage_opened",
  "cash_variance_settled",
  "float_requested",
  "float_allocated",
  "float_closed_pending_settlement"
]);

export function isFieldAgentAlert(kind: AgentNotification["kind"]): boolean {
  return FIELD_AGENT_ALERT_KINDS.has(kind);
}
