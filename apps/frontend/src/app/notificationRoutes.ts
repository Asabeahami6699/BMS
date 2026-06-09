import type { AgentNotification } from "./api";

/** Resolve in-app navigation target for a staff notification. */
export function notificationTargetPath(notification: AgentNotification): string | null {
  switch (notification.kind) {
    case "deposit_pending_bank":
    case "deposit_pending_accountant":
    case "deposit_completed":
    case "back_office_ecash_requested":
    case "back_office_ecash_approved":
      return "/app/banking/back-office";
    case "withdrawal_ready_for_teller":
    case "withdrawal_cs_approved":
    case "float_allocated":
      return "/app/banking/teller";
    case "withdrawal_request_pending":
    case "balance_request_pending":
    case "withdrawal_momo_sent":
      return "/app/banking/withdrawals";
    case "registration_pending":
      return "/app/susu/group-savings";
    case "registration_approved":
    case "registration_rejected":
      return notification.customerId
        ? `/app/susu/group-savings?customer=${encodeURIComponent(notification.customerId)}`
        : "/app/susu/group-savings";
    case "balance_disclosure_approved":
    case "balance_disclosure_rejected":
      return "/app/susu/withdrawals";
    case "withdrawal_request_approved":
    case "withdrawal_request_rejected":
      return "/app/susu/withdrawals";
    case "float_requested":
    case "float_closed_pending_settlement":
      return "/app/susu/till-float";
    case "collection_batch_pending":
    case "collection_batch_posted":
      return "/app/susu/callover-batches";
    case "workspace_activity":
      break;
    default:
      break;
  }

  const haystack = `${notification.title} ${notification.body}`.toLowerCase();
  if (haystack.includes("teller") || haystack.includes("pay cash") || haystack.includes("payout")) {
    return "/app/banking/teller";
  }
  if (haystack.includes("back office") || haystack.includes("bank execution") || haystack.includes("deposit")) {
    return "/app/banking/back-office";
  }
  if (haystack.includes("withdrawal") || haystack.includes("customer service")) {
    return "/app/banking/withdrawals";
  }
  if (haystack.includes("float")) {
    return "/app/susu/till-float";
  }
  if (haystack.includes("registration")) {
    return "/app/susu/group-savings";
  }
  return null;
}
