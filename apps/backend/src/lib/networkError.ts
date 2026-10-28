function isNetworkTypeError(error: TypeError): boolean {
  const message = error.message.toLowerCase();
  if (message.includes("fetch failed") || message.includes("network")) {
    return true;
  }
  const cause = (error as TypeError & { cause?: { code?: string } }).cause;
  return (
    cause?.code === "UND_ERR_CONNECT_TIMEOUT" ||
    cause?.code === "ECONNREFUSED" ||
    cause?.code === "ENOTFOUND" ||
    cause?.code === "ETIMEDOUT"
  );
}

export function isSupabaseAuthNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    return isNetworkTypeError(error);
  }
  return false;
}

/** True when Supabase HTTP calls fail due to DNS, timeout, or connection errors. */
export function isSupabaseConnectivityError(error: unknown): boolean {
  if (isSupabaseAuthNetworkError(error)) {
    return true;
  }
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("fetch failed") || message.includes("network")) {
      return true;
    }
    if (error.cause !== undefined) {
      return isSupabaseConnectivityError(error.cause);
    }
  }
  return false;
}
