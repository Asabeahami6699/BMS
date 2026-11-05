import type { Customer } from "../app/api";

function isUsableAgentLabel(value: string | undefined): value is string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return false;
  }
  // Reject raw user ids like user_d5d1918c when a real name was not resolved.
  if (/^user[_-]/i.test(trimmed)) {
    return false;
  }
  return true;
}

/** Display name for the assigned / registering field agent (never a raw user id). */
export function formatFieldAgent(customer: Customer): string {
  if (isUsableAgentLabel(customer.assignedFieldAgentName)) {
    return customer.assignedFieldAgentName.trim();
  }
  if (isUsableAgentLabel(customer.createdByFieldAgentName)) {
    return customer.createdByFieldAgentName.trim();
  }
  return "—";
}
