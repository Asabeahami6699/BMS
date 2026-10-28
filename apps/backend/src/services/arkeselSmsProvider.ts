import { getArkeselSmsConfig, hasArkeselSmsConfig } from "../config/env.js";

export type ArkeselSendResult = {
  messageId?: string;
  status?: string;
  raw: unknown;
};

export class ArkeselSmsError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly body?: unknown
  ) {
    super(message);
    this.name = "ArkeselSmsError";
  }
}

function toArkeselRecipient(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  return digits ? `+${digits}` : phone;
}

function extractMessageId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }
  const record = body as Record<string, unknown>;
  const data = record.data;
  if (Array.isArray(data)) {
    for (const item of data) {
      if (item && typeof item === "object" && typeof (item as Record<string, unknown>).id === "string") {
        return (item as Record<string, unknown>).id as string;
      }
    }
    return undefined;
  }
  if (data && typeof data === "object" && typeof (data as Record<string, unknown>).id === "string") {
    return (data as Record<string, unknown>).id as string;
  }
  return typeof record.id === "string" ? record.id : undefined;
}

export async function sendArkeselSms(input: {
  to: string;
  content: string;
  from?: string;
}): Promise<ArkeselSendResult> {
  if (!hasArkeselSmsConfig()) {
    throw new ArkeselSmsError(
      "Arkesel SMS is not configured. Set ARKESEL_API_KEY in apps/backend/.env"
    );
  }

  const config = getArkeselSmsConfig();
  const sender = (input.from?.trim() || config.senderId).slice(0, 11);
  if (!sender) {
    throw new ArkeselSmsError(
      "Set a Sender ID under Settings → Notification Settings. That name is what customers see on the SMS."
    );
  }
  const response = await fetch(`${config.baseUrl}/api/v2/sms/send`, {
    method: "POST",
    headers: {
      "api-key": config.apiKey,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify({
      sender,
      message: input.content,
      recipients: [toArkeselRecipient(input.to)]
    }),
    signal: AbortSignal.timeout(15_000)
  });

  const text = await response.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* keep raw text */
  }

  const record = body && typeof body === "object" ? (body as Record<string, unknown>) : undefined;
  const status = record ? String(record.status ?? "") : "";
  if (!response.ok || status.toLowerCase() === "error") {
    const detail =
      record && typeof record.message === "string" ? record.message : `Arkesel SMS failed (${response.status})`;
    throw new ArkeselSmsError(detail, response.status, body);
  }

  return {
    messageId: extractMessageId(body),
    status: status || "success",
    raw: body
  };
}
