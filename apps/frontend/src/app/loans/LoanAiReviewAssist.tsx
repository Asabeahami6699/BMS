import { useState } from "react";
import type { LoanReviewSnapshot } from "./loanDocument";
import { reviewLoanApplicationWithAi } from "../aiApi";
import { loanReviewSnapshotToAiRequest } from "./loanAiReview";
import { toUserFacingError } from "../../lib/networkError";

type Props = {
  snapshot: LoanReviewSnapshot;
  loanType?: "individual" | "group_solidarity";
};

export function LoanAiReviewAssist({ snapshot, loanType }: Props) {
  const [reply, setReply] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function runReview() {
    setBusy(true);
    setError("");
    try {
      const result = await reviewLoanApplicationWithAi(
        loanReviewSnapshotToAiRequest(snapshot, { loanType })
      );
      setReply(result.reply);
    } catch (err) {
      setError(toUserFacingError(err, "AI review unavailable"));
      setReply(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="loans-ai-review card">
      <div className="loans-ai-review__head">
        <div>
          <h4>AI review assistant</h4>
          <p className="muted field-hint">
            Advisory notes only — does not approve or decline. Uses free local Ollama on your server.
          </p>
        </div>
        <button type="button" className="button secondary" disabled={busy} onClick={() => void runReview()}>
          {busy ? "Analyzing…" : reply ? "Refresh review" : "Generate review"}
        </button>
      </div>
      {error ? <p className="loans-field-error">{error}</p> : null}
      {reply ? <pre className="loans-ai-review__body">{reply}</pre> : null}
    </aside>
  );
}
