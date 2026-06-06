export function parseAccessTokenExpiryMs(token: string | undefined): number | null {
  if (!token || token.startsWith("sess_")) {
    return null;
  }
  try {
    const segment = token.split(".")[1];
    if (!segment) {
      return null;
    }
    const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    const payload = JSON.parse(atob(base64)) as { exp?: number };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, totalSeconds);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}
