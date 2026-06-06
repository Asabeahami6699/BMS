import { FormEvent, useEffect, useRef, useState } from "react";
import { askAiHelp, getAiStatus } from "../app/aiApi";
import { toUserFacingError } from "../lib/networkError";

type ChatLine = { role: "user" | "assistant"; text: string };

export function AiHelpPanel() {
  const [open, setOpen] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [model, setModel] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>([
    {
      role: "assistant",
      text: "Ask how to use BMS — Susu collections, loans, groups, permissions, and reports. Powered by local Ollama (free)."
    }
  ]);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void getAiStatus()
      .then((status) => {
        setAvailable(status.available);
        setModel(status.model);
      })
      .catch(() => setAvailable(false));
  }, []);

  useEffect(() => {
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
  }, [lines, open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || busy) {
      return;
    }

    setDraft("");
    setLines((prev) => [...prev, { role: "user", text: message }]);
    setBusy(true);
    try {
      const result = await askAiHelp(message);
      setLines((prev) => [...prev, { role: "assistant", text: result.reply }]);
      setAvailable(true);
      setModel(result.model);
    } catch (error) {
      setLines((prev) => [
        ...prev,
        {
          role: "assistant",
          text: toUserFacingError(
            error,
            "AI assistant unavailable. Start Ollama and run: ollama pull llama3.2:3b"
          )
        }
      ]);
      setAvailable(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className="ai-help-fab"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={open ? "Close BMS assistant" : "Open BMS assistant"}
        title="BMS AI help (local Ollama)"
      >
        {open ? "✕" : "✨"}
      </button>

      {open ? (
        <section className="ai-help-panel" aria-label="BMS workspace assistant">
          <header className="ai-help-panel__header">
            <div>
              <p className="ai-help-panel__title">BMS Assistant</p>
              <p className="ai-help-panel__sub">
                {available
                  ? `Local AI · ${model || "Ollama"}`
                  : "Ollama offline — install locally for free AI"}
              </p>
            </div>
            <span className={`ai-help-panel__dot${available ? " ai-help-panel__dot--on" : ""}`} />
          </header>

          <div className="ai-help-panel__messages" ref={listRef}>
            {lines.map((line, index) => (
              <div
                key={`${index}-${line.role}`}
                className={`ai-help-panel__bubble ai-help-panel__bubble--${line.role}`}
              >
                {line.text}
              </div>
            ))}
          </div>

          <form className="ai-help-panel__compose" onSubmit={handleSubmit}>
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Ask about Susu, loans, roles…"
              disabled={busy}
            />
            <button type="submit" className="button" disabled={busy || !draft.trim()}>
              {busy ? "…" : "Ask"}
            </button>
          </form>
        </section>
      ) : null}
    </>
  );
}
