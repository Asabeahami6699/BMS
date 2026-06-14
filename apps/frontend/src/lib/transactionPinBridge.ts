import {
  clearCachedTransactionStepUpToken,
  getCachedTransactionStepUpToken,
  setCachedTransactionStepUpToken
} from "./transactionPinSession";

type RequestStepUpFn = () => Promise<string>;

let requestStepUpFn: RequestStepUpFn | null = null;

export function registerTransactionStepUpRequest(fn: RequestStepUpFn | null): void {
  requestStepUpFn = fn;
}

export function isTransactionStepUpRequiredError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("transaction pin verification required") ||
    message.includes("transaction pin required")
  );
}

export async function withTransactionStepUp<T>(run: (token: string) => Promise<T>): Promise<T> {
  if (!requestStepUpFn) {
    return run("");
  }

  let token = getCachedTransactionStepUpToken();
  if (!token) {
    token = await requestStepUpFn();
  }

  const activeToken = token || getCachedTransactionStepUpToken() || "";
  try {
    return await run(activeToken);
  } catch (error) {
    if (isTransactionStepUpRequiredError(error)) {
      clearCachedTransactionStepUpToken();
      const nextToken = await requestStepUpFn();
      return run(nextToken || getCachedTransactionStepUpToken() || "");
    }
    throw error;
  }
}

export function storeVerifiedStepUpToken(token: string, expiresAt: string): void {
  if (token) {
    setCachedTransactionStepUpToken(token, expiresAt);
  }
}
