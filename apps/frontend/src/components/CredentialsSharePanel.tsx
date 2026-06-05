import { useState } from "react";
import { useToast } from "./Toast";

export type CredentialField = {
  label: string;
  value: string;
  secret?: boolean;
};

type Props = {
  title: string;
  fields: CredentialField[];
  shareTitle?: string;
};

export function CredentialsSharePanel({ title, fields, shareTitle }: Props) {
  const { showToast } = useToast();
  const [revealed, setRevealed] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const loginUrl = typeof window !== "undefined" ? `${window.location.origin}/login` : "/login";

  function buildShareText(): string {
    const lines = [
      shareTitle ?? "BMS — Banking Management System",
      "",
      ...fields.map((f) => `${f.label}: ${f.value}`),
      `Sign-in URL: ${loginUrl}`,
      "",
      "Please sign in and change your password after first login."
    ];
    return lines.join("\n");
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(label);
      showToast(`${label} copied to clipboard`, "success");
      window.setTimeout(() => setCopiedKey(null), 2000);
    } catch {
      showToast("Could not copy — select and copy manually", "error");
    }
  }

  async function handleShare() {
    const text = buildShareText();
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle ?? "BMS login details", text });
        showToast("Share dialog opened", "success");
        return;
      } catch {
        /* user cancelled or unsupported */
      }
    }
    await copyText(text, "All details");
  }

  return (
    <div className="credentials-panel">
      <p className="credentials-panel-title">{title}</p>
      <div className="credentials-fields">
        {fields.map((field) => (
          <div className="credentials-row" key={field.label}>
            <div className="credentials-row-main">
              <span className="credentials-label">{field.label}</span>
              <code className="credentials-value">
                {field.secret && !revealed ? "••••••••••••" : field.value}
              </code>
            </div>
            <button
              type="button"
              className="button secondary credentials-copy-btn"
              onClick={() => copyText(field.value, field.label)}
            >
              {copiedKey === field.label ? "Copied" : "Copy"}
            </button>
          </div>
        ))}
        <div className="credentials-row">
          <div className="credentials-row-main">
            <span className="credentials-label">Sign-in URL</span>
            <code className="credentials-value">{loginUrl}</code>
          </div>
          <button
            type="button"
            className="button secondary credentials-copy-btn"
            onClick={() => copyText(loginUrl, "Sign-in URL")}
          >
            {copiedKey === "Sign-in URL" ? "Copied" : "Copy"}
          </button>
        </div>
      </div>

      {fields.some((f) => f.secret) ? (
        <button type="button" className="button secondary" onClick={() => setRevealed((v) => !v)}>
          {revealed ? "Hide password" : "Reveal password"}
        </button>
      ) : null}

      <div className="credentials-actions">
        <button type="button" className="button secondary" onClick={() => copyText(buildShareText(), "All details")}>
          Copy all details
        </button>
        <button type="button" className="button" onClick={handleShare}>
          Share with company
        </button>
      </div>
    </div>
  );
}
