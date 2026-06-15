import { roleRequiresTransactionPin } from "@bms/shared";

export async function ensureTransactionStepUpForRole(
  role: string | undefined,
  requestStepUp: () => Promise<string>
): Promise<void> {
  if (!role || !roleRequiresTransactionPin(role)) {
    return;
  }
  await requestStepUp();
}
