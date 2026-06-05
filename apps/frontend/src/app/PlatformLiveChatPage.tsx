import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import {
  ChatThreadNotFoundError,
  fetchChatInbox,
  fetchInboxMessages,
  sendAdminChatReply,
  type ChatMessage,
  type ChatThread
} from "./chatApi";

const POLL_MS = 2500;

function dedupeMessages(list: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return list.filter((msg) => {
    if (seen.has(msg.id)) {
      return false;
    }
    seen.add(msg.id);
    return true;
  });
}

function formatThreadTime(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function PlatformLiveChatPage() {
  const [inbox, setInbox] = useState<ChatThread[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("Loading conversations...");
  const [sending, setSending] = useState(false);
  const [search, setSearch] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const listRef = useRef<HTMLDivElement>(null);
  const activeThreadRef = useRef<string | null>(null);
  const messagesCacheRef = useRef<Map<string, ChatMessage[]>>(new Map());

  const selected = inbox.find((t) => t.id === selectedId) ?? null;

  const filteredInbox = inbox.filter((thread) => {
    if (unreadOnly && (thread.unreadForAdmin ?? 0) <= 0) {
      return false;
    }
    if (!search.trim()) {
      return true;
    }
    const q = search.toLowerCase();
    return (
      thread.companyName.toLowerCase().includes(q) ||
      thread.visitorName.toLowerCase().includes(q) ||
      thread.visitorEmail.toLowerCase().includes(q) ||
      thread.id.toLowerCase().includes(q)
    );
  });

  const totalUnread = inbox.reduce((sum, t) => sum + (t.unreadForAdmin ?? 0), 0);

  const loadInbox = useCallback(async () => {
    try {
      const threads = await fetchChatInbox();
      setInbox(threads);
      setStatus(threads.length === 0 ? "No registration chats yet." : "");
      return threads;
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to load inbox");
      return [];
    }
  }, []);

  const refreshMessages = useCallback(async (threadId: string, fullReload: boolean) => {
    if (activeThreadRef.current !== threadId) {
      return;
    }

    try {
      const cached = messagesCacheRef.current.get(threadId) ?? [];
      const since = fullReload ? undefined : cached[cached.length - 1]?.createdAt;
      const incoming = await fetchInboxMessages(threadId, since);
      const forThread = incoming.filter((msg) => msg.threadId === threadId);

      if (activeThreadRef.current !== threadId) {
        return;
      }

      const merged = fullReload
        ? dedupeMessages(forThread)
        : dedupeMessages([...cached, ...forThread]);

      messagesCacheRef.current.set(threadId, merged);

      if (activeThreadRef.current === threadId) {
        setMessages(merged);
      }
    } catch (error) {
      if (activeThreadRef.current !== threadId) {
        return;
      }
      if (error instanceof ChatThreadNotFoundError) {
        messagesCacheRef.current.delete(threadId);
        setSelectedId(null);
        setMessages([]);
        await loadInbox();
        setStatus("Conversation was removed or expired. Select another company.");
        return;
      }
      setStatus(error instanceof Error ? error.message : "Failed to load messages");
    }
  }, [loadInbox]);

  function selectThread(threadId: string) {
    activeThreadRef.current = threadId;
    setSelectedId(threadId);
    setReply("");
    setStatus("");

    const cached = messagesCacheRef.current.get(threadId);
    setMessages(cached ?? []);

    void refreshMessages(threadId, !cached || cached.length === 0);
  }

  useEffect(() => {
    void loadInbox().then((threads) => {
      if (threads.length > 0 && !selectedId) {
        selectThread(threads[0].id);
      }
    });
    const timer = setInterval(() => void loadInbox(), POLL_MS * 2);
    return () => clearInterval(timer);
  }, [loadInbox]);

  useEffect(() => {
    if (!selectedId) {
      activeThreadRef.current = null;
      setMessages([]);
      return;
    }

    activeThreadRef.current = selectedId;

    const cached = messagesCacheRef.current.get(selectedId);
    if (cached) {
      setMessages(cached);
    } else {
      setMessages([]);
    }

    void refreshMessages(selectedId, true);

    const timer = setInterval(() => {
      void refreshMessages(selectedId, false);
    }, POLL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [selectedId, refreshMessages]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, selectedId]);

  async function handleReply(event: FormEvent) {
    event.preventDefault();
    if (!selectedId || !selected || !reply.trim()) {
      return;
    }

    const threadId = selectedId;
    setSending(true);
    try {
      const sent = await sendAdminChatReply(threadId, reply.trim());
      if (activeThreadRef.current !== threadId) {
        return;
      }

      const next = dedupeMessages([...(messagesCacheRef.current.get(threadId) ?? []), sent]);
      messagesCacheRef.current.set(threadId, next);
      setMessages(next);
      setReply("");
      await loadInbox();
      setStatus(`Reply sent to ${selected.companyName} only.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Failed to send reply");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="livechat-admin">
      <article className="card livechat-admin-inbox">
        <div className="livechat-inbox-head">
          <div>
            <h2>Company conversations</h2>
            <p className="muted">Each company has its own thread — messages never mix.</p>
          </div>
          {totalUnread > 0 ? <span className="livechat-inbox-badge">{totalUnread} unread</span> : null}
        </div>

        <label className="field livechat-inbox-search">
          <span>Search company</span>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Company name, contact, or email..."
          />
        </label>

        <label className="livechat-filter-unread">
          <input type="checkbox" checked={unreadOnly} onChange={(e) => setUnreadOnly(e.target.checked)} />
          Show unread only
        </label>

        <div className="livechat-thread-list" role="list">
          {filteredInbox.length === 0 ? (
            <p className="muted livechat-empty-inbox">
              {inbox.length === 0 ? status : "No companies match your search."}
            </p>
          ) : (
            filteredInbox.map((thread) => (
              <button
                key={thread.id}
                type="button"
                role="listitem"
                className={`livechat-thread-item${selectedId === thread.id ? " active" : ""}${
                  (thread.unreadForAdmin ?? 0) > 0 ? " has-unread" : ""
                }`}
                onClick={() => selectThread(thread.id)}
              >
                <div className="livechat-thread-item-top">
                  <strong>{thread.companyName}</strong>
                  <time>{formatThreadTime(thread.updatedAt)}</time>
                </div>
                <small className="livechat-thread-contact">
                  {thread.visitorName} · {thread.visitorEmail}
                </small>
                <small className="livechat-thread-id">Thread: {thread.id}</small>
                {thread.lastMessage ? <p className="livechat-thread-preview">{thread.lastMessage}</p> : null}
                {(thread.unreadForAdmin ?? 0) > 0 ? (
                  <span className="livechat-unread" title="Unread from this company">
                    {thread.unreadForAdmin}
                  </span>
                ) : null}
              </button>
            ))
          )}
        </div>
      </article>

      <article className="card livechat-admin-thread">
        {selected ? (
          <>
            <div className="livechat-active-banner">
              <div>
                <p className="livechat-active-label">Attending conversation</p>
                <h2>{selected.companyName}</h2>
                <p className="muted">
                  {selected.visitorName} —{" "}
                  <a href={`mailto:${selected.visitorEmail}`}>{selected.visitorEmail}</a>
                </p>
                <p className="livechat-thread-id-banner">Thread ID: {selected.id}</p>
              </div>
              <span className="livechat-live-dot">Live</span>
            </div>

            <p className="livechat-isolation-note">
              Replies below go only to <strong>{selected.companyName}</strong>. Switch companies using the list on
              the left.
            </p>

            <div className="livechat-messages livechat-messages--tall" ref={listRef}>
              {messages
                .filter((msg) => msg.threadId === selected.id)
                .map((msg) => (
                  <div
                    key={msg.id}
                    className={`livechat-bubble livechat-bubble--${msg.senderType === "admin" ? "admin" : "visitor"}`}
                  >
                    <p className="livechat-bubble-sender">
                      {msg.senderType === "admin"
                        ? "You · Platform support"
                        : `${selected.visitorName} · ${selected.companyName}`}
                    </p>
                    <p>{msg.body}</p>
                    <time>{new Date(msg.createdAt).toLocaleString()}</time>
                  </div>
                ))}
            </div>

            <form className="livechat-compose" onSubmit={handleReply}>
              <input
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={`Reply to ${selected.companyName}...`}
                disabled={sending}
              />
              <button type="submit" className="button" disabled={sending || !reply.trim()}>
                Send to {selected.companyName}
              </button>
            </form>

            {status ? <p className="livechat-status livechat-status--ok">{status}</p> : null}
          </>
        ) : (
          <div className="livechat-no-selection">
            <h2>Select a company</h2>
            <p className="muted">
              Choose one conversation from the left. Each registration chat is kept separate so messages from
              different companies never conflict.
            </p>
          </div>
        )}
      </article>
    </div>
  );
}
