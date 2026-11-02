import { useEffect, useState } from "react";
import {
  defaultRegistrationFormSetup,
  type RegistrationAccountForm,
  type RegistrationFieldRequirement,
  type RegistrationFormFields,
  type RegistrationFormSetup
} from "@bms/shared";
import { useToast } from "../../components/Toast";
import { getCompanyProfile, getRegistrationFormSetup, updateRegistrationFormSetup } from "../api";
import {
  downloadDefaultRegistrationForm,
  downloadRegistrationForm,
  printDefaultRegistrationForm,
  printRegistrationForm,
  type RegistrationFormPrintContext
} from "../registrationFormPrint";
import { downloadDailyTallySheet, printDailyTallySheet } from "../dailyTallySheetPrint";

const FIELD_ROWS: { key: keyof RegistrationFormFields; label: string; hint: string }[] = [
  { key: "email", label: "Email", hint: "Default is optional." },
  { key: "houseNumber", label: "House number", hint: "Default is required." },
  { key: "idCardNumber", label: "ID card number", hint: "Default is required." },
  { key: "idCardPhoto", label: "ID card photo", hint: "Default is required." },
  { key: "customerPhoto", label: "Customer photo", hint: "Default is optional." },
  { key: "nextOfKin", label: "Next of kin", hint: "Default is required." },
  {
    key: "dailyContribution",
    label: "Daily contribution",
    hint: "Required means the amount must be more than zero. Default is optional."
  }
];

function moneyInput(value: string): boolean {
  return /^\d*\.?\d{0,2}$/.test(value);
}

function formMatchesDefault(form: RegistrationAccountForm): boolean {
  const baseline = defaultRegistrationFormSetup().forms.find((item) => item.id === form.id);
  if (!baseline) {
    return false;
  }
  return (
    form.enabled === baseline.enabled &&
    form.label === baseline.label &&
    form.hint === baseline.hint &&
    form.defaultDailyContributionGhs === baseline.defaultDailyContributionGhs
  );
}

export function SettingsFormSetupPage() {
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [setup, setSetup] = useState<RegistrationFormSetup>(() => defaultRegistrationFormSetup());
  const [openingFee, setOpeningFee] = useState("20.00");
  const [printContext, setPrintContext] = useState<RegistrationFormPrintContext>({});
  const [dailyAmounts, setDailyAmounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      defaultRegistrationFormSetup().forms.map((form) => [form.id, form.defaultDailyContributionGhs.toFixed(2)])
    )
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [loaded, profile] = await Promise.all([
          getRegistrationFormSetup(),
          getCompanyProfile().catch(() => null)
        ]);
        if (cancelled) {
          return;
        }
        setSetup(loaded);
        setOpeningFee(loaded.savingsOpeningFeeGhs.toFixed(2));
        setDailyAmounts(
          Object.fromEntries(loaded.forms.map((form) => [form.id, form.defaultDailyContributionGhs.toFixed(2)]))
        );
        if (profile) {
          setPrintContext({
            companyName: profile.name,
            companyPhone: profile.phone,
            companyAddress: profile.address
          });
        }
      } catch (error) {
        if (!cancelled) {
          showToast(error instanceof Error ? error.message : "Failed to load form setup", "error");
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

  function currentSetupForPrint(): RegistrationFormSetup {
    const fee = Number(openingFee);
    return {
      ...setup,
      savingsOpeningFeeGhs: Number.isFinite(fee) && fee >= 0 ? Math.round(fee * 100) / 100 : setup.savingsOpeningFeeGhs,
      forms: setup.forms.map((form) => ({
        ...form,
        defaultDailyContributionGhs: Number(dailyAmounts[form.id] === "" ? 0 : dailyAmounts[form.id]) || 0
      }))
    };
  }

  function handlePrintCompanyForm() {
    try {
      printRegistrationForm(currentSetupForPrint(), printContext);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open the print dialog", "error");
    }
  }

  function handleDownloadCompanyForm() {
    try {
      downloadRegistrationForm(currentSetupForPrint(), printContext);
      showToast("Registration form downloaded", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not download the form", "error");
    }
  }

  function handlePrintDefaultForm() {
    try {
      printDefaultRegistrationForm(printContext);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open the print dialog", "error");
    }
  }

  function handleDownloadDefaultForm() {
    try {
      downloadDefaultRegistrationForm(printContext);
      showToast("Default registration form downloaded", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not download the default form", "error");
    }
  }

  function handlePrintTallySheet() {
    try {
      printDailyTallySheet({
        companyName: printContext.companyName,
        dateLabel: ""
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open the print dialog", "error");
    }
  }

  function handleDownloadTallySheet() {
    try {
      downloadDailyTallySheet({
        companyName: printContext.companyName,
        dateLabel: ""
      });
      showToast("Daily tally sheet downloaded", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not download the tally sheet", "error");
    }
  }

  function patchForm(id: RegistrationAccountForm["id"], patch: Partial<RegistrationAccountForm>) {
    setSetup((current) => ({
      ...current,
      forms: current.forms.map((form) => (form.id === id ? { ...form, ...patch } : form))
    }));
  }

  function patchField(key: keyof RegistrationFormFields, requirement: RegistrationFieldRequirement) {
    setSetup((current) => ({
      ...current,
      fields: { ...current.fields, [key]: requirement }
    }));
  }

  function restoreForm(id: RegistrationAccountForm["id"]) {
    const baseline = defaultRegistrationFormSetup().forms.find((form) => form.id === id);
    if (!baseline) {
      return;
    }
    patchForm(id, baseline);
    setDailyAmounts((current) => ({
      ...current,
      [id]: baseline.defaultDailyContributionGhs.toFixed(2)
    }));
    if (id === "savings") {
      setOpeningFee("20.00");
    }
  }

  function restoreAll() {
    const defaults = defaultRegistrationFormSetup();
    setSetup(defaults);
    setOpeningFee("20.00");
    setDailyAmounts(
      Object.fromEntries(defaults.forms.map((form) => [form.id, form.defaultDailyContributionGhs.toFixed(2)]))
    );
  }

  async function handleSave() {
    const fee = Number(openingFee);
    if (!Number.isFinite(fee) || fee < 0) {
      showToast("Enter a savings opening amount of zero or more", "error");
      return;
    }
    if (
      setup.forms.some((form) => {
        const daily = Number(dailyAmounts[form.id]);
        return !Number.isFinite(daily) || daily < 0;
      })
    ) {
      showToast("Enter a daily contribution of zero or more on each form", "error");
      return;
    }
    const next: RegistrationFormSetup = {
      ...setup,
      savingsOpeningFeeGhs: Math.round(fee * 100) / 100,
      forms: setup.forms.map((form) => ({
        ...form,
        defaultDailyContributionGhs: Number(dailyAmounts[form.id] === "" ? 0 : dailyAmounts[form.id])
      }))
    };
    setSaving(true);
    try {
      const saved = await updateRegistrationFormSetup(next);
      setSetup(saved);
      setOpeningFee(saved.savingsOpeningFeeGhs.toFixed(2));
      showToast("Form setup saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save form setup", "error");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <article className="card">
        <h2>Form setup</h2>
        <p className="muted">Loading…</p>
      </article>
    );
  }

  return (
    <article className="card">
      <div className="form-setup__head">
        <div>
          <h2>Form setup</h2>
          <p className="muted">
            Set the account registration forms for this company, or keep the defaults. Full name, phone, and
            location stay on every form. Accounts already opened keep the savings amount they were opened with.
            After setup, download or print a blank paper form for field and branch registration.
          </p>
        </div>
        <button type="button" className="button secondary" onClick={restoreAll}>
          Restore defaults
        </button>
      </div>

      <section className="form-setup-print" aria-label="Downloadable registration forms">
        <div>
          <h3>Paper registration form</h3>
          <p className="muted">
            Print or download a blank form that matches this setup, or use the built-in default layout.
          </p>
        </div>
        <div className="form-setup-print__actions">
          <button type="button" className="button" onClick={handlePrintCompanyForm}>
            Print company form
          </button>
          <button type="button" className="button secondary" onClick={handleDownloadCompanyForm}>
            Download company form
          </button>
          <button type="button" className="button secondary" onClick={handlePrintDefaultForm}>
            Print default form
          </button>
          <button type="button" className="button secondary" onClick={handleDownloadDefaultForm}>
            Download default form
          </button>
        </div>
      </section>

      <section className="form-setup-print" aria-label="Daily tally sheet">
        <div>
          <h3>Daily tally sheet</h3>
          <p className="muted">
            Blank backup sheet for mobilizers: company header, mobilizer name, date, 40 collection rows on one A4 page,
            and a grand total.
          </p>
        </div>
        <div className="form-setup-print__actions">
          <button type="button" className="button" onClick={handlePrintTallySheet}>
            Print tally sheet
          </button>
          <button type="button" className="button secondary" onClick={handleDownloadTallySheet}>
            Download tally sheet
          </button>
        </div>
      </section>

      <div className="form-setup-grid">
        {setup.forms.map((form) => (
          <section key={form.id} className="form-setup-card">
            <div className="form-setup-card__head">
              <h3>{form.label.trim() || "Account form"}</h3>
              <span className="muted">
              {formMatchesDefault(form) && (form.id !== "savings" || Number(openingFee) === 20) ? "Default" : "Custom"}
            </span>
            </div>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => patchForm(form.id, { enabled: event.target.checked })}
              />
              <span>Offer this form</span>
            </label>
            <label className="field">
              <span>Form name</span>
              <input
                value={form.label}
                maxLength={80}
                disabled={!form.enabled}
                onChange={(event) => patchForm(form.id, { label: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Short description</span>
              <input
                value={form.hint}
                maxLength={240}
                disabled={!form.enabled}
                onChange={(event) => patchForm(form.id, { hint: event.target.value })}
              />
            </label>
            <label className="field">
              <span>Default daily contribution (GHS)</span>
              <input
                inputMode="decimal"
                value={dailyAmounts[form.id] ?? ""}
                disabled={!form.enabled}
                onChange={(event) => {
                  const value = event.target.value;
                  if (!moneyInput(value)) {
                    return;
                  }
                  setDailyAmounts((current) => ({ ...current, [form.id]: value }));
                  patchForm(form.id, {
                    defaultDailyContributionGhs: value === "" || value === "." ? 0 : Number(value)
                  });
                }}
              />
            </label>
            {form.id === "savings" ? (
              <label className="field">
                <span>Savings opening amount (GHS)</span>
                <input
                  inputMode="decimal"
                  value={openingFee}
                  disabled={!form.enabled}
                  onChange={(event) => {
                    if (moneyInput(event.target.value)) {
                      setOpeningFee(event.target.value);
                    }
                  }}
                />
                <p className="muted">
                  Cash taken when a savings account is opened. It is credited on approval and stays locked.
                </p>
              </label>
            ) : null}
            <button type="button" className="button secondary" onClick={() => restoreForm(form.id)}>
              Use default
            </button>
          </section>
        ))}
      </div>

      <h3 className="settings-section-title">Fields on every registration form</h3>
      <p className="muted">Choose what staff must fill in. Hidden fields are left off the form.</p>
      <div className="form-setup-fields">
        {FIELD_ROWS.map((row) => (
          <label key={row.key} className="field">
            <span>{row.label}</span>
            <select
              value={setup.fields[row.key]}
              onChange={(event) => patchField(row.key, event.target.value as RegistrationFieldRequirement)}
            >
              <option value="required">Required</option>
              <option value="optional">Optional</option>
              <option value="hidden">Hidden</option>
            </select>
            <p className="muted">{row.hint}</p>
          </label>
        ))}
      </div>
      <button
        type="button"
        className="button secondary"
        onClick={() =>
          setSetup((current) => ({
            ...current,
            fields: defaultRegistrationFormSetup().fields
          }))
        }
      >
        Use default fields
      </button>

      <div className="form-actions">
        <button type="button" className="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? "Saving…" : "Save form setup"}
        </button>
      </div>
    </article>
  );
}
