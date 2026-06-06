import { FormEvent, useEffect, useRef, useState } from "react";
import { isAiAssistantChatMessage } from "../app/aiApi";
import {
  BMS_CONTACT_EMAIL,
  ChatThreadNotFoundError,
  clearStoredChatThreadId,
  fetchVisitorMessages,
  getStoredChatCompanyName,
  getStoredChatThreadId,
  sendVisitorChatMessage,
  startChatThread,
  type ChatMessage
} from "../app/chatApi";

const POLL_MS = 2500;

export function LiveChatWidget() {
  const [open, setOpen] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(getStoredChatThreadId());
  const [activeCompany, setActiveCompany] = useState<string | null>(getStoredChatCompanyName());
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [sending, setSending] = useState(false);
  const [visitorName, setVisitorName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const [introMessage, setIntroMessage] = useState(
    "Hello, we are interested in registering our company on BMS."
  );
  const listRef = useRef<HTMLDivElement>(null);

  function resetStaleThread() {
    clearStoredChatThreadId();
    setThreadId(null);
    setActiveCompany(null);
    setMessages([]);
    setStatus("Previous chat session expired. Please start a new conversation.");
  }

  const activeThreadRef = useRef<string | null>(threadId);
  const messagesRef = useRef<ChatMessage[]>([]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (!open || !threadId) {
      return;
    }

    activeThreadRef.current = threadId;

    async function sync(fullReload: boolean) {
      const pollingId = threadId;
      if (!pollingId || activeThreadRef.current !== pollingId) {
        return;
      }
      try {
        const current = messagesRef.current.filter((m) => m.threadId === pollingId);
        const since = fullReload ? undefined : current[current.length - 1]?.createdAt;
        const incoming = await fetchVisitorMessages(pollingId, since);
        if (activeThreadRef.current !== pollingId) {
          return;
        }
        const filtered = incoming.filter((m) => m.threadId === pollingId);
        const base = fullReload ? [] : current;
        const ids = new Set(base.map((m) => m.id));
        const next = [...base, ...filtered.filter((m) => !ids.has(m.id))];
        messagesRef.current = next;
        setMessages(next);
      } catch (error) {
        if (error instanceof ChatThreadNotFoundError) {
          resetStaleThread();
        }
      }
    }

    void sync(true);
    const timer = setInterval(() => void sync(false), POLL_MS);
    return () => clearInterval(timer);
  }, [open, threadId]);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [messages, open]);

  async function handleStartChat(event: FormEvent) {
    event.preventDefault();
    setSending(true);
    setStatus("Connecting to support...");
    try {
      const result = await startChatThread({
        visitorName,
        companyName,
        visitorEmail,
        message: introMessage
      });
      activeThreadRef.current = result.thread.id;
      setThreadId(result.thread.id);
      setActiveCompany(result.thread.companyName);
      setMessages(result.messages.filter((m) => m.threadId === result.thread.id));
      setStatus(`Connected as ${result.thread.companyName} — only your company's messages appear here.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not start chat");
    } finally {
      setSending(false);
    }
  }

  async function handleSend(event: FormEvent) {
    event.preventDefault();
    if (!threadId || !draft.trim()) {
      return;
    }
    setSending(true);
    try {
      const sent = await sendVisitorChatMessage(threadId, draft.trim());
      if (sent.threadId !== threadId) {
        return;
      }
      setMessages((prev) => [...prev.filter((m) => m.threadId === threadId), sent]);
      setDraft("");
      setStatus("");
    } catch (error) {
      if (error instanceof ChatThreadNotFoundError) {
        resetStaleThread();
        return;
      }
      setStatus(error instanceof Error ? error.message : "Send failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="livechat-fab"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? "Close live chat" : "Open live chat"}
      >
        {open ? "✕" : "💬"}
        {!open ? <span className="livechat-fab-label">Ask about registration</span> : null}
      </button>

      {open ? (
        <section className="livechat-panel" aria-label="Live chat with BMS support">
          <header className="livechat-header">
            <div>
              <p className="livechat-title">
                {activeCompany ? `Chat · ${activeCompany}` : "Live chat — Registration"}
              </p>
              <p className="livechat-sub">
                {activeCompany
                  ? "Your company's private thread with BMS support"
                  : "Chat with our platform team in real time"}
              </p>
            </div>
            <span className="livechat-live-dot" title="Live">
              Live
            </span>
          </header>

          {!threadId ? (
            <form className="livechat-start-form" onSubmit={handleStartChat}>
              <p className="muted livechat-intro">
                Interested in onboarding your cooperative or MFI? Our free local AI assistant answers common
                questions instantly; a platform team member can follow up for registration details.
              </p>
              <label className="field">
                <span>Your name</span>
                <input value={visitorName} onChange={(e) => setVisitorName(e.target.value)} required />
              </label>
              <label className="field">
                <span>Company name</span>
                <input value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
              </label>
              <label className="field">
                <span>Email</span>
                <input
                  type="email"
                  value={visitorEmail}
                  onChange={(e) => setVisitorEmail(e.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>Your question</span>
                <textarea
                  rows={3}
                  value={introMessage}
                  onChange={(e) => setIntroMessage(e.target.value)}
                  required
                />
              </label>
              <button type="submit" className="button" disabled={sending}>
                {sending ? "Starting..." : "Start live chat"}
              </button>
              <p className="muted livechat-email">
                Or email us:{" "}
                <a href={`mailto:${BMS_CONTACT_EMAIL}`}>{BMS_CONTACT_EMAIL}</a>
              </p>
            </form>
          ) : (
            <>
              <div className="livechat-messages" ref={listRef}>
                {messages
                  .filter((msg) => !threadId || msg.threadId === threadId)
                  .map((msg) => (
                  <div
                    key={msg.id}
                    className={`livechat-bubble livechat-bubble--${msg.senderType === "visitor" ? "visitor" : "admin"}`}
                  >
                    <p className="livechat-bubble-sender">
                      {msg.senderType === "visitor"
                        ? "You"
                        : isAiAssistantChatMessage(msg.id)
                          ? "BMS AI Assistant"
                          : "BMS Platform support"}
                    </p>
                    <p>{msg.body}</p>
                    <time>{new Date(msg.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
                  </div>
                ))}
              </div>
              <form className="livechat-compose" onSubmit={handleSend}>
                <input
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Type your message..."
                  disabled={sending}
                />
                <button type="submit" className="button" disabled={sending || !draft.trim()}>
                  Send
                </button>
              </form>
            </>
          )}

          {status ? <p className="livechat-status">{status}</p> : null}
        </section>
      ) : null}
    </>
  );
}
