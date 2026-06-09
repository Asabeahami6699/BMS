export function tellerDepositStatusLabel(status: string): string {
  switch (status) {
    case "pending_bank":
      return "Pending";
    case "pending_accountant":
      return "Awaiting accountant";
    case "completed":
      return "Done";
    case "failed":
      return "Failed";
    case "bank_executed":
      return "At bank";
    default:
      return status;
  }
}

export function tellerDepositStatusTone(
  status: string
): "pending" | "warning" | "success" | "danger" | "neutral" {
  switch (status) {
    case "pending_bank":
      return "pending";
    case "pending_accountant":
      return "warning";
    case "completed":
      return "success";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}
