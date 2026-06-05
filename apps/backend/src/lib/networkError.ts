export function isSupabaseAuthNetworkError(error: unknown): boolean {
  if (!(error instanceof TypeError)) {
    return false;
  }
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
