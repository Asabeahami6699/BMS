export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes("fetch") || msg.includes("network") || msg.includes("failed to fetch");
  }
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();
    return (
      msg.includes("no internet connection") ||
      msg.includes("cannot reach the api") ||
      msg.includes("network")
    );
  }
  return false;
}

function isLocalDevHost(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  const host = window.location.hostname;
  return host === "localhost" || host === "127.0.0.1" || host === "::1";
}

export function toUserFacingError(error: unknown, fallback: string): string {
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  if (offline) {
    return "No internet connection. Check your network and try again.";
  }
  if (isNetworkError(error)) {
    // Local Vite → API is usually http://localhost:4000; a dead API is not "no internet".
    if (isLocalDevHost()) {
      return "Cannot reach the API server on localhost:4000. Start the backend (npm run dev in apps/backend) and try again.";
    }
    return "Cannot reach the server. Check your connection and try again.";
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
