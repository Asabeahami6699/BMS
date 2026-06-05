import type { ChatMessage, ChatThread } from "@bms/shared";

export type StoredThread = ChatThread & {
  unreadForAdmin: number;
};

const threads = new Map<string, StoredThread>();
const messagesByThread = new Map<string, ChatMessage[]>();

export function createThread(input: Omit<StoredThread, "lastMessage" | "unreadForAdmin"> & { unreadForAdmin?: number }): StoredThread {
  const thread: StoredThread = {
    ...input,
    unreadForAdmin: input.unreadForAdmin ?? 1
  };
  threads.set(thread.id, thread);
  if (!messagesByThread.has(thread.id)) {
    messagesByThread.set(thread.id, []);
  }
  return thread;
}

export function hydrateThread(thread: StoredThread, messages: ChatMessage[]): StoredThread {
  const last = messages[messages.length - 1];
  const stored: StoredThread = {
    ...thread,
    lastMessage: last?.body,
    unreadForAdmin: thread.unreadForAdmin ?? 0
  };
  threads.set(stored.id, stored);
  messagesByThread.set(stored.id, [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt)));
  return stored;
}

export function getThread(threadId: string): StoredThread | undefined {
  return threads.get(threadId);
}

export function listThreadsForAdmin(): StoredThread[] {
  return [...threads.values()]
    .map((thread) => {
      const msgs = messagesByThread.get(thread.id) ?? [];
      const last = msgs[msgs.length - 1];
      return {
        ...thread,
        lastMessage: last?.body
      };
    })
    .sort((a, b) => {
      const unreadDiff = (b.unreadForAdmin ?? 0) - (a.unreadForAdmin ?? 0);
      if (unreadDiff !== 0) {
        return unreadDiff;
      }
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

export function appendMessage(message: ChatMessage): ChatMessage {
  const list = messagesByThread.get(message.threadId) ?? [];
  list.push(message);
  messagesByThread.set(message.threadId, list);

  const thread = threads.get(message.threadId);
  if (thread) {
    thread.updatedAt = message.createdAt;
    thread.lastMessage = message.body;
    if (message.senderType === "visitor") {
      thread.unreadForAdmin += 1;
    }
    threads.set(thread.id, thread);
  }

  return message;
}

export function listMessages(threadId: string, since?: string): ChatMessage[] {
  const list = messagesByThread.get(threadId) ?? [];
  if (!since) {
    return [...list];
  }
  return list.filter((msg) => msg.createdAt > since);
}

export function markThreadRead(threadId: string): void {
  const thread = threads.get(threadId);
  if (!thread) {
    return;
  }
  thread.unreadForAdmin = 0;
  threads.set(threadId, thread);
}
