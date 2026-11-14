import type { AgentNotification } from "./api";

type NotificationRole = string | undefined;

/**
 * Resolve in-app navigation target for a staff notification.
 * Field-agent Susu cash/balance requests go to Pending approvals (coordinator),
 * not the agency banking withdrawals desk.
 */
export function notificationTargetPath(
  notification: AgentNotification,
  role?: NotificationRole
): string | null {
  const isTellerLike = role === "teller";
  const isCoordinatorLike = role === "coordinator" || role === "admin";

  switch (notification.kind) {
    case "deposit_pending_bank":
    case "deposit_pending_accountant":
    case "deposit_completed":
    case "back_office_ecash_requested":
    case "back_office_ecash_approved":
      return "/app/banking/back-office/deposits";
    case "withdrawal_ready_for_teller":
    case "withdrawal_cs_approved":
      // Susu field Pay now lives on Branch counter; banking tellers keep desk home.
      if (isTellerLike || isCoordinatorLike || role === "admin") {
        const hay = `${notification.title} ${notification.body}`.toLowerCase();
        if (
          hay.includes("branch counter") ||
          hay.includes("field withdrawal") ||
          hay.includes("pay now") ||
          hay.includes("next visit")
        ) {
          return "/app/susu/collections";
        }
      }
      return isTellerLike ? "/app/banking/teller" : "/app/susu/collections";
    case "withdrawal_request_pending":
    case "balance_request_pending":
      // Coordinator review queue (call customer → approve → teller Pay now).
      return "/app/susu/pending-approvals";
    case "withdrawal_momo_sent":
      return "/app/susu/pending-approvals";
    case "registration_pending":
      return "/app/susu/pending-approvals";
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
      // Staff: fulfillment / history. (Field agents use the agent app alerts.)
      return "/app/susu/withdrawals";
    case "float_requested":
    case "float_allocated":
    case "float_closed_pending_settlement":
      return "/app/susu/till-float";
    case "collection_batch_pending":
    case "collection_batch_posted":
      return "/app/susu/callover-batches";
    case "cash_shortage_opened":
    case "cash_overage_opened":
    case "cash_variance_settled": {
      const hay = `${notification.title} ${notification.body}`.toLowerCase();
      if (hay.includes("till") || hay.includes("teller")) {
        return "/app/susu/overages-shortages#os-branch-till";
      }
      return "/app/susu/overages-shortages#os-field-agents";
    }
    case "vault_opening_adjusted":
    case "vault_close_variance":
      return "/app/susu/closing-balances";
    case "loan_repayment_reserved":
    case "loan_auto_repayment":
    case "loan_auto_repayment_failed":
      return "/app/loans/customers";
    case "workspace_activity":
      break;
    default:
      break;
  }

  const haystack = `${notification.title} ${notification.body}`.toLowerCase();
  if (haystack.includes("pending approval") || haystack.includes("registration phone")) {
    return "/app/susu/pending-approvals";
  }
  if (
    haystack.includes("pay now") ||
    haystack.includes("branch counter") ||
    (haystack.includes("teller") && haystack.includes("field"))
  ) {
    return "/app/susu/collections";
  }
  if (haystack.includes("teller") || haystack.includes("pay cash") || haystack.includes("payout")) {
    return role === "teller" ? "/app/banking/teller" : "/app/susu/collections";
  }
  if (haystack.includes("back office") || haystack.includes("bank execution") || haystack.includes("deposit")) {
    return "/app/banking/back-office/deposits";
  }
  if (haystack.includes("withdrawal") || haystack.includes("balance request")) {
    return "/app/susu/pending-approvals";
  }
  if (haystack.includes("float")) {
    return "/app/susu/till-float";
  }
  if (haystack.includes("registration")) {
    return "/app/susu/pending-approvals";
  }
  return null;
}
