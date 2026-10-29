import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { compressImageDataUrl, isDataUrlWithinLimit } from "../../lib/imageCompress";
import { getCompanyProfile, updateCompanyProfile, type CompanyProfile } from "../api";
import { applyTenantFontStep, clampFontSizeStep, FONT_SIZE_OPTIONS } from "../fontSize";

export const COMPANY_PROFILE_UPDATED_EVENT = "bms:company-profile-updated";

const DEFAULT_BRAND = "#3d5afe";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return (parts[0]?.slice(0, 2) ?? "CO").toUpperCase();
}

export function SettingsCompanyProfilePage() {
  const { showToast } = useToast();
  const { refreshMe } = useAuth();
  const fileRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [taxId, setTaxId] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | undefined>();
  const [brandColor, setBrandColor] = useState(DEFAULT_BRAND);
  const [fontSizeStep, setFontSizeStep] = useState(0);
  const savedFontStep = useRef(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const profile = await getCompanyProfile();
        if (cancelled) {
          return;
        }
        applyProfile(profile);
      } catch (error) {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "Failed to load company profile", "error");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showToast]);

  useEffect(() => {
    return () => {
      applyTenantFontStep(savedFontStep.current);
    };
  }, []);

  function applyProfile(profile: CompanyProfile) {
    setName(profile.name);
    setPhone(profile.phone ?? "");
    setEmail(profile.email ?? "");
    setAddress(profile.address ?? "");
    setTaxId(profile.taxId ?? "");
    setLogoUrl(profile.logoUrl);
    setBrandColor(profile.brandColor ?? DEFAULT_BRAND);
    const step = clampFontSizeStep(profile.fontSizeStep);
    savedFontStep.current = step;
    setFontSizeStep(step);
    applyTenantFontStep(step);
  }

  function onLogoFile(file: File) {
    if (!file.type.startsWith("image/")) {
      showToast("Choose a JPEG, PNG, or WebP logo.", "error");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      void (async () => {
        if (typeof reader.result !== "string") {
          return;
        }
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

  async function handleSave() {
    if (!name.trim()) {
      showToast("Enter the company name", "error");
      return;
    }
    setSaving(true);
    try {
      const saved = await updateCompanyProfile({
        name: name.trim(),
        phone: phone.trim() || null,
        email: email.trim() || null,
        address: address.trim() || null,
        taxId: taxId.trim() || null,
        logoUrl: logoUrl ?? null,
        brandColor,
        fontSizeStep
      });
      applyProfile(saved);
      window.dispatchEvent(new CustomEvent(COMPANY_PROFILE_UPDATED_EVENT, { detail: saved }));
      await refreshMe();
      showToast("Company profile saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save company profile", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <article className="card">
        <h2>Company Profile</h2>
        <p className="muted">Loading…</p>
      </article>
    );
  }

  return (
    <article className="card">
      <h2>Company Profile</h2>
      <p className="muted">Company name, logo, contact, address, tax, branding, and font size.</p>

      <div className="company-profile-layout">
        <div className="company-profile-form">
          <label className="field">
            <span>Company name</span>
            <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
          </label>

          <label className="field">
            <span>Phone</span>
            <input
              type="tel"
              value={phone}
              maxLength={30}
              placeholder="0244123456"
              onChange={(e) => setPhone(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              maxLength={120}
              placeholder="office@company.com"
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Address</span>
            <textarea
              value={address}
              maxLength={300}
              rows={3}
              onChange={(e) => setAddress(e.target.value)}
            />
          </label>

          <label className="field">
            <span>Tax identification number</span>
            <input value={taxId} maxLength={40} onChange={(e) => setTaxId(e.target.value)} />
          </label>

          <div className="field">
            <span>Logo</span>
            <div className="company-profile-logo-actions">
              <button type="button" className="button secondary" onClick={() => fileRef.current?.click()}>
                Upload logo
              </button>
              {logoUrl ? (
                <button type="button" className="button secondary" onClick={() => setLogoUrl(undefined)}>
                  Remove
                </button>
              ) : null}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) {
                  onLogoFile(file);
                }
              }}
            />
          </div>

          <label className="field">
            <span>Brand color</span>
            <span className="company-profile-color">
              <input
                type="color"
                value={brandColor}
                aria-label="Brand color"
                onChange={(e) => setBrandColor(e.target.value)}
              />
              <input
                value={brandColor}
                maxLength={7}
                onChange={(e) => {
                  const next = e.target.value;
                  if (/^#[0-9A-Fa-f]{0,6}$/.test(next)) {
                    setBrandColor(next);
                  }
                }}
                onBlur={() => {
                  if (!/^#[0-9A-Fa-f]{6}$/.test(brandColor)) {
                    setBrandColor(DEFAULT_BRAND);
                  }
                }}
              />
            </span>
          </label>

          <label className="field">
            <span>Font size</span>
            <select
              value={fontSizeStep}
              onChange={(e) => {
                const step = clampFontSizeStep(Number(e.target.value));
                setFontSizeStep(step);
                applyTenantFontStep(step);
              }}
            >
              {FONT_SIZE_OPTIONS.map((option) => (
                <option key={option.step} value={option.step}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="muted">Default keeps the current size. A larger step applies to everyone in this company.</p>
          </label>

          <div className="form-actions">
            <button type="button" className="button" disabled={saving} onClick={() => void handleSave()}>
              {saving ? "Saving…" : "Save company profile"}
            </button>
          </div>
        </div>

        <aside className="company-profile-preview" style={{ borderColor: brandColor }}>
          <div className="company-profile-mark" style={{ background: brandColor }}>
            {logoUrl ? <img src={logoUrl} alt="" /> : <span>{initials(name || "Company")}</span>}
          </div>
          <strong>{name.trim() || "Company name"}</strong>
          <p className="muted">{phone.trim() || "Phone"}</p>
          <p className="muted">{email.trim() || "Email"}</p>
          <p className="muted">{address.trim() || "Address"}</p>
          <p className="muted">{taxId.trim() ? `TIN ${taxId.trim()}` : "Tax identification number"}</p>
        </aside>
      </div>
    </article>
  );
}
