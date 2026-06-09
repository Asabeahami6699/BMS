export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes("fetch") || msg.includes("network") || msg.includes("failed to fetch");
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return msg.includes("no internet connection") || msg.includes("network");
  }
  return false;
}

export function toUserFacingError(error: unknown, fallback: string): string {
  if (isNetworkError(error) || (typeof navigator !== "undefined" && !navigator.onLine)) {
    return "No internet connection. Check your network and try again.";
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

const DEFAULT_NETWORK_RETRY_MS = 10_000;
const DEFAULT_NETWORK_RETRY_INTERVAL_MS = 1_500;

/** Retry flaky requests for a short window when the connection drops or is slow. */
export async function withNetworkRetry<T>(
  fn: () => Promise<T>,
  options?: { maxMs?: number; intervalMs?: number }
): Promise<T> {
  const maxMs = options?.maxMs ?? DEFAULT_NETWORK_RETRY_MS;
  const intervalMs = options?.intervalMs ?? DEFAULT_NETWORK_RETRY_INTERVAL_MS;
  const started = Date.now();
  let lastError: unknown;

  while (true) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const offline = typeof navigator !== "undefined" && !navigator.onLine;
      if (!isNetworkError(error) && !offline) {
        throw error;
      }
      if (Date.now() - started >= maxMs) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(toUserFacingError(lastError, "Request failed"));
}
