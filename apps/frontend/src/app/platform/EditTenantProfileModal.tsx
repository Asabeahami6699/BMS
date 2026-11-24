import { FormEvent, useEffect, useRef, useState } from "react";
import { tenantHasSusuAndLoans } from "@bms/shared";
import type { TenantRecord } from "../api";
import { getPlatformTenantProfile, updatePlatformTenantProfile } from "../api";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { compressImageDataUrl, isDataUrlWithinLimit } from "../../lib/imageCompress";

type Props = {
  open: boolean;
  tenant: TenantRecord | null;
  onClose: () => void;
  onUpdated: () => void;
};

const DEFAULT_BRAND = "#3d5afe";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "CO").toUpperCase();
}

export function EditTenantProfileModal({ open, tenant, onClose, onUpdated }: Props) {
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | undefined>();
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND);
  const [savingsOpeningFeeGhs, setSavingsOpeningFeeGhs] = useState("20");
  const [susuLoanBridgeEnabled, setSusuLoanBridgeEnabled] = useState(false);

  const canConfigureBridge = tenant ? tenantHasSusuAndLoans(tenant.subscribedModules) : false;

  useEffect(() => {
    if (!open || !tenant) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setName(tenant.name);
    setPhone("");
    setEmail("");
    setAddress("");
    setTaxId("");
    setLogoUrl(undefined);
    setBrandColor(DEFAULT_BRAND);
    setSavingsOpeningFeeGhs("20");
    setSusuLoanBridgeEnabled(false);

    void getPlatformTenantProfile(tenant.id)
      .then((profile) => {
        if (cancelled) return;
        setName(profile.name || tenant.name);
        setPhone(profile.phone ?? "");
        setEmail(profile.email ?? "");
        setAddress(profile.address ?? "");
        setTaxId(profile.taxId ?? "");
        setLogoUrl(profile.logoUrl);
        setBrandColor(profile.brandColor ?? DEFAULT_BRAND);
        setSavingsOpeningFeeGhs(String(profile.savingsOpeningFeeGhs ?? 20));
        setSusuLoanBridgeEnabled(Boolean(profile.susuLoanBridgeEnabled));
      })
      .catch((error) => {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "Failed to load company profile", "error");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, tenant, showToast]);

  function onLogoFile(file: File) {
    if (!file.type.startsWith("image/")) {
      showToast("Choose a JPEG, PNG, or WebP logo.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        if (typeof reader.result !== "string") return;
        try {
          const compressed = await compressImageDataUrl(reader.result);
          if (!isDataUrlWithinLimit(compressed)) {
            showToast("Could not compress the logo enough. Try a smaller image.", "error");
            return;
          }
          setLogoUrl(compressed);
        } catch {
          showToast("Could not read that image.", "error");
        }
      })();
    };
    reader.readAsDataURL(file);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!tenant) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      showToast("Company name is required", "error");
      return;
    }
    const feeNum = Number(savingsOpeningFeeGhs);
    if (!Number.isFinite(feeNum) || feeNum < 0) {
      showToast("Savings opening fee must be 0 or greater", "error");
      return;
    }

    setSaving(true);
    try {
      await updatePlatformTenantProfile(tenant.id, {
        name: trimmedName,
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        taxId: taxId.trim() || null,
        logoUrl: logoUrl ?? null,
        brandColor: /^#[0-9A-Fa-f]{6}$/.test(brandColor) ? brandColor : DEFAULT_BRAND,
        savingsOpeningFeeGhs: Math.round(feeNum * 100) / 100,
        ...(canConfigureBridge ? { susuLoanBridgeEnabled } : {})
      });
      showToast(`Updated profile for ${trimmedName}`, "success");
      onUpdated();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save company profile", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      open={open && Boolean(tenant)}
      onClose={() => !saving && onClose()}
      title={`Edit company profile${tenant ? ` · ${tenant.name}` : ""}`}
      subtitle="Update company details, logo, and brand color used on their subdomain, sidebar, receipts, and statements."
      panelClassName="modal-panel--wide"
      footer={
        <>
          <button type="button" className="button secondary" disabled={saving} onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="platform-edit-tenant-profile-form"
            className="button"
            disabled={loading || saving}
          >
            {saving ? "Saving…" : "Save profile"}
          </button>
        </>
      }
    >
      {loading ? (
        <p className="muted">Loading company profile…</p>
      ) : (
        <form
          id="platform-edit-tenant-profile-form"
          className="form-grid"
          onSubmit={(e) => void handleSubmit(e)}
        >
          <div className="platform-profile-brand-row">
            <div className="company-profile-mark" style={{ background: brandColor }}>
              {logoUrl ? <img src={logoUrl} alt="" /> : <span>{initials(name || "Company")}</span>}
            </div>
            <div className="platform-profile-brand-actions">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) onLogoFile(f);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                className="button secondary"
                onClick={() => fileRef.current?.click()}
              >
                {logoUrl ? "Change logo" : "Upload logo"}
              </button>
              {logoUrl ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setLogoUrl(undefined)}
                >
                  Remove logo
                </button>
              ) : null}
              <label className="platform-profile-color">
                <span className="muted">Brand color</span>
                <input
                  type="color"
                  value={/^#[0-9A-Fa-f]{6}$/.test(brandColor) ? brandColor : DEFAULT_BRAND}
                  onChange={(e) => setBrandColor(e.target.value)}
                />
                <input
                  type="text"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  placeholder="#3d5afe"
                  maxLength={7}
                  style={{ width: "6.5rem" }}
                />
              </label>
            </div>
          </div>

          <label className="field">
            <span>Company name *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </label>

          <label className="field">
            <span>Phone</span>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+233 …"
            />
          </label>

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="info@company.com"
            />
          </label>

          <label className="field">
            <span>Tax ID / Registration no.</span>
            <input
              type="text"
              value={taxId}
              onChange={(e) => setTaxId(e.target.value)}
              placeholder="Optional"
            />
          </label>

          <label className="field field--full">
            <span>Address</span>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Head office street & city"
            />
          </label>

          <label className="field">
            <span>Savings opening fee (GHS)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={savingsOpeningFeeGhs}
              onChange={(e) => setSavingsOpeningFeeGhs(e.target.value)}
            />
          </label>

          {canConfigureBridge ? (
            <label className="commission-toggle-row field--full">
              <span>
                <strong>Susu–Loans Bridge</strong>
                <small className="muted">
                  Allow Susu savings to qualify customers for loans, liens, and auto-debit repayments.
                </small>
              </span>
              <input
                type="checkbox"
                checked={susuLoanBridgeEnabled}
                onChange={(e) => setSusuLoanBridgeEnabled(e.target.checked)}
              />
            </label>
          ) : null}
        </form>
      )}
    </Modal>
  );
}
