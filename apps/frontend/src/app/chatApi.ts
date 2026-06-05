import { BMS_CONTACT_EMAIL } from "@bms/shared";
import { API_BASE_URL, authHeaders, getAuthSession } from "./api";

export { BMS_CONTACT_EMAIL };

export type ChatMessage = {
  id: string;
  threadId: string;
  senderType: "visitor" | "admin";
  body: string;
  createdAt: string;
};

export type ChatThread = {
  id: string;
  visitorName: string;
  companyName: string;
  visitorEmail: string;
  createdAt: string;
  updatedAt: string;
  lastMessage?: string;
  unreadForAdmin?: number;
};

const THREAD_STORAGE_KEY = "bms.chat.threadId";
const COMPANY_STORAGE_KEY = "bms.chat.companyName";

export function getStoredChatThreadId(): string | null {
  return localStorage.getItem(THREAD_STORAGE_KEY);
}

export function setStoredChatThreadId(threadId: string, companyName?: string): void {
  localStorage.setItem(THREAD_STORAGE_KEY, threadId);
  if (companyName) {
    localStorage.setItem(COMPANY_STORAGE_KEY, companyName);
  }
}

export function getStoredChatCompanyName(): string | null {
  return localStorage.getItem(COMPANY_STORAGE_KEY);
}

export function clearStoredChatThreadId(): void {
  localStorage.removeItem(THREAD_STORAGE_KEY);
  localStorage.removeItem(COMPANY_STORAGE_KEY);
}

export class ChatThreadNotFoundError extends Error {
  constructor() {
    super("Chat thread not found");
    this.name = "ChatThreadNotFoundError";
  }
}

export async function startChatThread(payload: {
  visitorName: string;
  companyName: string;
  visitorEmail: string;
  message: string;
}): Promise<{ thread: ChatThread; messages: ChatMessage[] }> {
  const response = await fetch(`${API_BASE_URL}/api/v1/chat/threads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to start chat");
  }
  const data = (await response.json()) as { thread: ChatThread; messages: ChatMessage[] };
  setStoredChatThreadId(data.thread.id, data.thread.companyName);
  return data;
}

async function parseChatError(response: Response, fallback: string): Promise<Error> {
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (response.status === 404 || body.error?.toLowerCase().includes("not found")) {
    return new ChatThreadNotFoundError();
  }
  return new Error(body.error ?? fallback);
}

export async function fetchVisitorMessages(threadId: string, since?: string): Promise<ChatMessage[]> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const response = await fetch(`${API_BASE_URL}/api/v1/chat/threads/${threadId}/messages${query}`);
  if (!response.ok) {
    throw await parseChatError(response, "Failed to load messages");
  }
  const data = (await response.json()) as { messages: ChatMessage[] };
  return data.messages;
}

export async function sendVisitorChatMessage(threadId: string, message: string): Promise<ChatMessage> {
  const response = await fetch(`${API_BASE_URL}/api/v1/chat/threads/${threadId}/messages`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message })
  });
  if (!response.ok) {
    throw await parseChatError(response, "Failed to send message");
  }
  return response.json() as Promise<ChatMessage>;
}

export async function fetchChatInbox(): Promise<ChatThread[]> {
  const session = getAuthSession();
  if (!session?.accessToken) {
    throw new Error("Not signed in");
  }
  const response = await fetch(`${API_BASE_URL}/api/v1/chat/inbox`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw new Error("Failed to load inbox");
  }
  return response.json() as Promise<ChatThread[]>;
}

export async function fetchInboxMessages(threadId: string, since?: string): Promise<ChatMessage[]> {
  const query = since ? `?since=${encodeURIComponent(since)}` : "";
  const response = await fetch(`${API_BASE_URL}/api/v1/chat/inbox/${threadId}/messages${query}`, {
    headers: authHeaders()
  });
  if (!response.ok) {
    throw await parseChatError(response, "Failed to load thread");
  }
  const data = (await response.json()) as { messages: ChatMessage[] };
  return data.messages;
}

export async function sendAdminChatReply(threadId: string, message: string): Promise<ChatMessage> {
  const response = await fetch(`${API_BASE_URL}/api/v1/chat/inbox/${threadId}/messages`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ message })
  });
  if (!response.ok) {
    throw await parseChatError(response, "Failed to send reply");
  }
  return response.json() as Promise<ChatMessage>;
}
