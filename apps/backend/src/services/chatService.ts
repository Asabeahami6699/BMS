import {
  sendChatMessageSchema,
  startChatThreadSchema,
  type ChatMessage,
  type ChatThread
} from "@bms/shared";
import { getSupabaseAdminClient } from "../config/supabaseClient.js";
import {
  appendMessage,
  createThread,
  getThread,
  hydrateThread,
  listMessages,
  listThreadsForAdmin,
  markThreadRead,
  type StoredThread
} from "./chatStore.js";
import { generatePublicChatReply } from "./ai/aiService.js";

function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

async function persistChatMessage(message: ChatMessage, unreadForAdmin?: number): Promise<void> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return;
  }

  const { error: insertError } = await supabase.from("live_chat_messages").insert({
    id: message.id,
    thread_id: message.threadId,
    sender_type: message.senderType,
    body: message.body
  });
  if (insertError) {
    console.warn(`[chat] Supabase message insert failed: ${insertError.message}`);
    return;
  }

  const thread = getThread(message.threadId);
  await supabase
    .from("live_chat_threads")
    .update({
      updated_at: message.createdAt,
      unread_for_admin: unreadForAdmin ?? thread?.unreadForAdmin ?? 0
    })
    .eq("id", message.threadId);
}

async function maybeReplyWithAssistant(threadId: string, visitorMessage: string): Promise<ChatMessage | null> {
  const history = listMessages(threadId);
  const ai = await generatePublicChatReply({
    visitorMessage,
    history
  });

  if (!ai?.reply) {
    return null;
  }

  let body = ai.reply;
  if (ai.escalated) {
    body = `${body}\n\nA platform team member will follow up with you here or by email if needed.`;
  }

  const message: ChatMessage = {
    id: newId("msg_ai"),
    threadId,
    senderType: "admin",
    body,
    createdAt: new Date().toISOString()
  };

  appendMessage(message);

  const thread = getThread(threadId);
  if (thread && ai.escalated) {
    thread.unreadForAdmin += 1;
  }

  await persistChatMessage(message, getThread(threadId)?.unreadForAdmin);

  return message;
}

function mapMessageRow(row: {
  id: string;
  thread_id: string;
  sender_type: string;
  body: string;
  created_at: string;
}): ChatMessage {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderType: row.sender_type as ChatMessage["senderType"],
    body: row.body,
    createdAt: row.created_at
  };
}

async function hydrateThreadFromSupabase(threadId: string): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  if (!supabase) {
    return false;
  }

  const { data: row, error: threadError } = await supabase
    .from("live_chat_threads")
    .select("*")
    .eq("id", threadId)
    .maybeSingle();

  if (threadError || !row) {
    return false;
  }

  const { data: messageRows, error: messagesError } = await supabase
    .from("live_chat_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });

  if (messagesError) {
    return false;
  }

  hydrateThread(
    {
      id: row.id,
      visitorName: row.visitor_name,
      companyName: row.company_name,
      visitorEmail: row.visitor_email,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      unreadForAdmin: row.unread_for_admin ?? 0
    },
    (messageRows ?? []).map(mapMessageRow)
  );

  return true;
}

async function ensureThread(threadId: string): Promise<StoredThread | undefined> {
  const existing = getThread(threadId);
  if (existing) {
    return existing;
  }
  const hydrated = await hydrateThreadFromSupabase(threadId);
  if (!hydrated) {
    return undefined;
  }
  return getThread(threadId);
}

export async function startVisitorThread(raw: unknown): Promise<{ thread: ChatThread; messages: ChatMessage[] }> {
  const parsed = startChatThreadSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid chat registration details");
  }

  const now = new Date().toISOString();
  const threadId = newId("chat");
  const thread = createThread({
    id: threadId,
    visitorName: parsed.data.visitorName,
    companyName: parsed.data.companyName,
    visitorEmail: parsed.data.visitorEmail,
    createdAt: now,
    updatedAt: now
  });

  const welcome: ChatMessage = {
    id: newId("msg"),
    threadId,
    senderType: "admin",
    body: `Hello! Thanks for your interest in BMS (Banking Management System). How can we help with your company registration? You can also reach us at asabeahami6699@gmail.com.`,
    createdAt: now
  };

  const visitorMsg: ChatMessage = {
    id: newId("msg"),
    threadId,
    senderType: "visitor",
    body: parsed.data.message,
    createdAt: new Date(Date.now() + 1).toISOString()
  };

  appendMessage(welcome);
  appendMessage(visitorMsg);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error: threadError } = await supabase.from("live_chat_threads").insert({
      id: threadId,
      visitor_name: parsed.data.visitorName,
      company_name: parsed.data.companyName,
      visitor_email: parsed.data.visitorEmail,
      unread_for_admin: 2
    });
    if (threadError) {
      console.warn(`[chat] Supabase thread insert failed: ${threadError.message}`);
    } else {
      const { error: messagesError } = await supabase.from("live_chat_messages").insert([
        { id: welcome.id, thread_id: threadId, sender_type: "admin", body: welcome.body },
        { id: visitorMsg.id, thread_id: threadId, sender_type: "visitor", body: visitorMsg.body }
      ]);
      if (messagesError) {
        console.warn(`[chat] Supabase messages insert failed: ${messagesError.message}`);
      }
    }
  }

  await maybeReplyWithAssistant(threadId, parsed.data.message);

  const allMessages = listMessages(threadId);
  const last = allMessages[allMessages.length - 1];
  return { thread: { ...thread, lastMessage: last?.body ?? visitorMsg.body }, messages: allMessages };
}

export async function getVisitorMessages(threadId: string, since?: string): Promise<ChatMessage[]> {
  const thread = await ensureThread(threadId);
  if (!thread) {
    throw new Error("Chat thread not found");
  }
  return listMessages(threadId, since);
}

export async function sendVisitorMessage(threadId: string, raw: unknown): Promise<ChatMessage> {
  const parsed = sendChatMessageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid message");
  }

  const thread = await ensureThread(threadId);
  if (!thread) {
    throw new Error("Chat thread not found");
  }

  const message: ChatMessage = {
    id: newId("msg"),
    threadId,
    senderType: "visitor",
    body: parsed.data.message,
    createdAt: new Date().toISOString()
  };

  appendMessage(message);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error: insertError } = await supabase.from("live_chat_messages").insert({
      id: message.id,
      thread_id: threadId,
      sender_type: "visitor",
      body: message.body
    });
    if (insertError) {
      console.warn(`[chat] Supabase message insert failed: ${insertError.message}`);
    } else {
      await supabase
        .from("live_chat_threads")
        .update({ updated_at: message.createdAt, unread_for_admin: getThread(threadId)?.unreadForAdmin ?? 1 })
        .eq("id", threadId);
    }
  }

  await maybeReplyWithAssistant(threadId, parsed.data.message);

  return message;
}

export async function listAdminInbox(): Promise<ChatThread[]> {
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { data: threadRows, error } = await supabase.from("live_chat_threads").select("id");
    if (error) {
      console.warn(`[chat] Supabase inbox load failed: ${error.message}`);
    } else {
      for (const row of threadRows ?? []) {
        await hydrateThreadFromSupabase(row.id);
      }
    }
  }

  return listThreadsForAdmin();
}

export async function getAdminThreadMessages(threadId: string, since?: string): Promise<ChatMessage[]> {
  const thread = await ensureThread(threadId);
  if (!thread) {
    throw new Error("Chat thread not found");
  }
  return listMessages(threadId, since);
}

export async function sendAdminReply(threadId: string, raw: unknown): Promise<ChatMessage> {
  const parsed = sendChatMessageSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("Invalid message");
  }

  const thread = await ensureThread(threadId);
  if (!thread) {
    throw new Error("Chat thread not found");
  }

  const message: ChatMessage = {
    id: newId("msg"),
    threadId,
    senderType: "admin",
    body: parsed.data.message,
    createdAt: new Date().toISOString()
  };

  appendMessage(message);
  markThreadRead(threadId);

  const supabase = getSupabaseAdminClient();
  if (supabase) {
    const { error: insertError } = await supabase.from("live_chat_messages").insert({
      id: message.id,
      thread_id: threadId,
      sender_type: "admin",
      body: message.body
    });
    if (insertError) {
      console.warn(`[chat] Supabase admin reply insert failed: ${insertError.message}`);
    } else {
      await supabase
        .from("live_chat_threads")
        .update({ updated_at: message.createdAt, unread_for_admin: 0 })
        .eq("id", threadId);
    }
  }

  return message;
}

export async function markAdminThreadRead(threadId: string): Promise<void> {
  await ensureThread(threadId);
  markThreadRead(threadId);
  const supabase = getSupabaseAdminClient();
  if (supabase) {
    await supabase.from("live_chat_threads").update({ unread_for_admin: 0 }).eq("id", threadId);
  }
}
