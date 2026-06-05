import { CUSTOMER_ACCOUNT_NUMBER_LENGTH, formatAccountNumberPreview } from "@bms/shared";
import { useEffect, useMemo, useState } from "react";
import type { AppRole, AccountNumberPolicy } from "./api";
import { getAccountNumberPolicy, updateAccountNumberPolicy } from "./api";
import { useToast } from "../components/Toast";

type Props = {
  role: AppRole;
};

export function AccountNumberPolicyCard({ role }: Props) {
  const { showToast } = useToast();
  const [policy, setPolicy] = useState<AccountNumberPolicy | null>(null);
  const [prefixInput, setPrefixInput] = useState("");
  const [loading, setLoading] = useState(true);

  const canEdit = role === "admin";

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const data = await getAccountNumberPolicy();
        setPolicy(data);
        setPrefixInput(data.prefix);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Failed to load policy", "error");
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [showToast]);

  const suffixLength = useMemo(() => {
    const digits = prefixInput.replace(/\D/g, "");
    return Math.max(0, CUSTOMER_ACCOUNT_NUMBER_LENGTH - digits.length);
  }, [prefixInput]);

  const preview = useMemo(() => {
    const digits = prefixInput.replace(/\D/g, "");
    if (digits.length === 0 || digits.length >= CUSTOMER_ACCOUNT_NUMBER_LENGTH) {
      return null;
    }
    return formatAccountNumberPreview(digits);
  }, [prefixInput]);

  async function handleSave() {
    const digits = prefixInput.replace(/\D/g, "");
    if (digits.length === 0) {
      showToast("Enter a numeric prefix", "error");
      return;
    }
    if (digits.length >= CUSTOMER_ACCOUNT_NUMBER_LENGTH) {
      showToast(`Prefix must be shorter than ${CUSTOMER_ACCOUNT_NUMBER_LENGTH} digits`, "error");
      return;
    }

    try {
      const updated = await updateAccountNumberPolicy({ prefix: digits });
      setPolicy(updated);
      setPrefixInput(updated.prefix);
      showToast("Account number prefix saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save", "error");
    }
  }

  if (loading) {
    return (
      <section className="card">
        <h2>Account numbers</h2>
        <p className="muted">Loading…</p>
      </section>
    );
  }

  return (
    <section className="card">
      <h2>Account numbers</h2>
      <p className="muted">
        Customer accounts are <strong>{CUSTOMER_ACCOUNT_NUMBER_LENGTH} digits</strong>. Set your
        company prefix; the system appends random digits when a coordinator or admin approves a
        registration.
      </p>

      <label className="field">
        <span>Company prefix (digits only)</span>
        <input
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={CUSTOMER_ACCOUNT_NUMBER_LENGTH - 1}
          value={prefixInput}
          disabled={!canEdit}
          placeholder="e.g. 233000"
          onChange={(e) => setPrefixInput(e.target.value.replace(/\D/g, ""))}
        />
        <p className="muted" style={{ margin: "0.35rem 0 0", fontSize: "0.85rem" }}>
          {suffixLength > 0
            ? `${suffixLength} random digit${suffixLength === 1 ? "" : "s"} added on approval.`
            : "Prefix is too long."}
        </p>
      </label>

      {preview ? (
        <div className="credentials-panel" style={{ marginTop: "0.75rem" }}>
          <p className="credentials-panel-title">Example after approval</p>
          <code className="credentials-value">{preview}</code>
          <p className="muted" style={{ margin: "0.5rem 0 0", fontSize: "0.85rem" }}>
            Pattern: <strong>{prefixInput.replace(/\D/g, "")}</strong> + random suffix (e.g.{" "}
            {preview.slice(prefixInput.replace(/\D/g, "").length)})
          </p>
        </div>
      ) : null}

      {policy ? (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Current saved prefix: <strong>{policy.prefix}</strong>
        </p>
      ) : null}

      {canEdit ? (
        <button type="button" className="button" style={{ marginTop: "1rem" }} onClick={() => void handleSave()}>
          Save prefix
        </button>
      ) : (
        <p className="muted" style={{ marginTop: "0.75rem" }}>
          Only company admins can change the prefix.
        </p>
      )}
    </section>
  );
}
