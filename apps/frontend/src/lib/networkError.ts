export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) {
    const msg = error.message.toLowerCase();
    return msg.includes("fetch") || msg.includes("network") || msg.includes("failed to fetch");
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
