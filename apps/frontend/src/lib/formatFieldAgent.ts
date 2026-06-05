import type { Customer } from "../app/api";

/** Display name for the field agent who submitted or owns the registration. */
export function formatFieldAgent(customer: Customer): string {
  return (
    customer.createdByFieldAgentName ??
    customer.assignedFieldAgentName ??
    customer.createdByFieldAgentId ??
    customer.assignedFieldAgentId ??
    "—"
  );
}
