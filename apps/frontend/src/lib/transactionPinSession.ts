const STEP_UP_STORAGE_KEY = "bms:transaction-step-up";

type StoredStepUp = {
  token: string;
  expiresAt: string;
};

export function getCachedTransactionStepUpToken(): string | null {
  try {
    const raw = sessionStorage.getItem(STEP_UP_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredStepUp;
    if (!parsed.token || !parsed.expiresAt) {
      return null;
    }
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      sessionStorage.removeItem(STEP_UP_STORAGE_KEY);
      return null;
    }
    return parsed.token;
  } catch {
    return null;
  }
}

export function setCachedTransactionStepUpToken(token: string, expiresAt: string): void {
  const payload: StoredStepUp = { token, expiresAt };
  sessionStorage.setItem(STEP_UP_STORAGE_KEY, JSON.stringify(payload));
}

export function clearCachedTransactionStepUpToken(): void {
  sessionStorage.removeItem(STEP_UP_STORAGE_KEY);
}
