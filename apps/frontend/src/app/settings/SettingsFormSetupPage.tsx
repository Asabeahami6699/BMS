import { useEffect, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  defaultRegistrationFormSetup,
  type RegistrationAccountForm,
  type RegistrationFieldRequirement,
  type RegistrationFormFields,
  type RegistrationFormSetup
} from "@bms/shared";
import { useToast } from "../../components/Toast";
import { useSettingsWorkspaceStore } from "../stores/settingsWorkspaceStore";
import {
  downloadDefaultRegistrationForm,
  downloadRegistrationForm,
  downloadSimplifiedKycRegistrationForm,
  printDefaultRegistrationForm,
  printRegistrationForm,
  printSimplifiedKycRegistrationForm,
  type RegistrationFormPrintContext
} from "../registrationFormPrint";
import { downloadDailyTallySheet, printDailyTallySheet } from "../dailyTallySheetPrint";
import {
  downloadWalkInDepositSlipSheet,
  printWalkInDepositSlipSheet
} from "../walkInDepositSlipPrint";

const FIELD_ROWS: { key: keyof RegistrationFormFields; label: string; hint: string }[] = [
  { key: "email", label: "Email", hint: "Default is optional." },
  { key: "houseNumber", label: "House number", hint: "Default is required." },
  { key: "dateOfBirth", label: "Date of birth", hint: "Default is required." },
  { key: "occupation", label: "Occupation", hint: "Default is required." },
  { key: "idCardNumber", label: "ID card number", hint: "Default is required." },
  { key: "idCardPhoto", label: "ID card photo", hint: "Default is required." },
  { key: "customerPhoto", label: "Customer photo", hint: "Default is optional." },
  { key: "nextOfKin", label: "Next of kin", hint: "Default is required." },
  {
    key: "dailyContribution",
    label: "Daily savings / contribution",
    hint: "Susu accounts always show the daily savings amount. Normal Savings accounts have no fixed daily amount."
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
  const {
    setup,
    openingFee,
    printContext,
    dailyAmounts,
    loading,
    saving,
    lastFetchedAt,
    error,
    hydrateSection,
    startLiveSync,
    stopLiveSync,
    setFormSetup,
    setOpeningFee,
    setDailyAmounts,
    saveFormSetup
  } = useSettingsWorkspaceStore(
    useShallow((s) => ({
      setup: s.formSetup,
      openingFee: s.openingFee,
      printContext: s.formSetupPrintContext,
      dailyAmounts: s.dailyAmounts,
      loading: s.section.formSetup.loading,
      saving: s.savingFormSetup,
      lastFetchedAt: s.section.formSetup.lastFetchedAt,
      error: s.section.formSetup.error,
      hydrateSection: s.hydrateSection,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync,
      setFormSetup: s.setFormSetup,
      setOpeningFee: s.setOpeningFee,
      setDailyAmounts: s.setDailyAmounts,
      saveFormSetup: s.saveFormSetup
    }))
  );

  useEffect(() => {
    hydrateSection("formSetup");
    startLiveSync("formSetup");
    return () => stopLiveSync();
  }, [hydrateSection, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (error) {
      showToast(error, "error");
    }
  }, [error, showToast]);

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

  function handlePrintSimplifiedKycForm() {
    try {
      printSimplifiedKycRegistrationForm(setup, printContext);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open the print dialog", "error");
    }
  }

  function handleDownloadSimplifiedKycForm() {
    try {
      downloadSimplifiedKycRegistrationForm(setup, printContext);
      showToast("Simplified KYC registration form downloaded", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not download the Simplified KYC form", "error");
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

  function handlePrintWalkInDepositSlips() {
    try {
      printWalkInDepositSlipSheet({
        companyName: printContext.companyName,
        companyLogoUrl: printContext.companyLogoUrl,
        companyPhone: printContext.companyPhone
      });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open the print dialog", "error");
    }
  }

  function handleDownloadWalkInDepositSlips() {
    try {
      downloadWalkInDepositSlipSheet({
        companyName: printContext.companyName,
        companyLogoUrl: printContext.companyLogoUrl,
        companyPhone: printContext.companyPhone
      });
      showToast("Walk-in deposit slip sheet downloaded", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not download the deposit slips", "error");
    }
  }

  function patchForm(id: RegistrationAccountForm["id"], patch: Partial<RegistrationAccountForm>) {
    setFormSetup({
      ...setup,
      forms: setup.forms.map((form) => (form.id === id ? { ...form, ...patch } : form))
    });
  }

  function patchField(key: keyof RegistrationFormFields, requirement: RegistrationFieldRequirement) {
    setFormSetup({
      ...setup,
      fields: { ...setup.fields, [key]: requirement }
    });
  }

  function patchSimplifiedKyc(patch: Partial<RegistrationFormSetup["simplifiedKyc"]>) {
    setFormSetup({
      ...setup,
      simplifiedKyc: {
        ...setup.simplifiedKyc,
        ...patch
      }
    });
  }

  function restoreForm(id: RegistrationAccountForm["id"]) {
    const baseline = defaultRegistrationFormSetup().forms.find((form) => form.id === id);
    if (!baseline) {
      return;
    }
    if (id === "savings") {
      setOpeningFee("20.00");
      setFormSetup({
        ...setup,
        savingsOpeningFeeHandling: "both",
        forms: setup.forms.map((form) => (form.id === id ? { ...form, ...baseline } : form))
      });
    } else {
      patchForm(id, baseline);
    }
    setDailyAmounts({
      ...dailyAmounts,
      [id]: baseline.defaultDailyContributionGhs.toFixed(2)
    });
  }

  function restoreAll() {
    const defaults = defaultRegistrationFormSetup();
    setFormSetup(defaults);
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
    try {
      await saveFormSetup(next);
      showToast("Form setup saved", "success");
    } catch (err) {
      showToast(err instanceof Error ? err.message : "Failed to save form setup", "error");
    }
  }

  if (loading && lastFetchedAt == null) {
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

      <section className="form-setup-print" aria-label="Simplified KYC paper registration form">
        <div>
          <h3>Simplified KYC (Tier 1) paper form — No National ID</h3>
          <p className="muted">
            Dedicated single-page A4 form for foreign residents or customers without a national ID. Includes
            nationality, customer declaration, and the mandatory Ghana Card local introducer attestation &amp;
            signature block.
          </p>
        </div>
        <div className="form-setup-print__actions">
          <button
            type="button"
            className="button"
            disabled={!setup.simplifiedKyc.enabled}
            onClick={handlePrintSimplifiedKycForm}
          >
            Print Simplified KYC form
          </button>
          <button
            type="button"
            className="button secondary"
            disabled={!setup.simplifiedKyc.enabled}
            onClick={handleDownloadSimplifiedKycForm}
          >
            Download Simplified KYC form
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

      <section className="form-setup-print" aria-label="Walk-in deposit slips">
        <div>
          <h3>Walk-in deposit slip (6 per A4 sheet)</h3>
          <p className="muted">
            2 across × 3 down (6 cut-out slips on one upright A4 portrait sheet) with company name &amp; logo, account
            number, account name, amount in words, amount in figures, and signature or thumbprint.
          </p>
        </div>
        <div className="form-setup-print__actions">
          <button type="button" className="button" onClick={handlePrintWalkInDepositSlips}>
            Print walk-in slips
          </button>
          <button type="button" className="button secondary" onClick={handleDownloadWalkInDepositSlips}>
            Download walk-in slips
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
            {form.id !== "savings" ? (
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
                    setDailyAmounts({ ...dailyAmounts, [form.id]: value });
                    patchForm(form.id, {
                      defaultDailyContributionGhs: value === "" || value === "." ? 0 : Number(value)
                    });
                  }}
                />
              </label>
            ) : null}
            {form.id === "savings" ? (
              <label className="field">
                <span>Minimum locked balance / initial deposit floor (GHS)</span>
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
                  Admin-configured minimum locked balance. New Savings initial deposits must be at
                  least this amount; full deposit credits on approval, and Commission Settings
                  (<em>When to deduct</em>) controls whether the locked minimum applies on approval
                  or on first withdrawal.
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
          setFormSetup({
            ...setup,
            fields: defaultRegistrationFormSetup().fields
          })
        }
      >
        Use default fields
      </button>

      <section className="form-setup-kyc-card" aria-label="Simplified KYC policy">
        <div className="form-setup-kyc-card__head">
          <div>
            <h3>Tier 1 · Simplified KYC (Foreigner / No-ID Susu accounts)</h3>
            <p className="muted">
              BoG risk-based onboarding for customers without a national ID. Requires a live customer face photo,
              nationality, and a local introducer with a valid Ghana Card. Loans and investments remain locked until
              upgraded to Full KYC.
            </p>
          </div>
          <span className="status-pill status-pill--pending">BoG Tier 1</span>
        </div>

        <div className="form-setup-kyc-card__controls">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={setup.simplifiedKyc.enabled}
              onChange={(event) => patchSimplifiedKyc({ enabled: event.target.checked })}
            />
            <span>
              <strong>Allow Simplified KYC registration (No National ID + Local Introducer)</strong>
            </span>
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={setup.simplifiedKyc.allowFieldAgentWithdrawalRequest}
              disabled={!setup.simplifiedKyc.enabled}
              onChange={(event) =>
                patchSimplifiedKyc({ allowFieldAgentWithdrawalRequest: event.target.checked })
              }
            />
            <span>
              <strong>Allow field agent withdrawal requests for Simplified KYC accounts</strong>
              <small className="muted" style={{ display: "block" }}>
                When off (default), Simplified KYC customers must withdraw in person at the branch with face
                verification. Turn on to let field agents submit withdrawal requests for coordinator approval.
              </small>
            </span>
          </label>

          <label className="field" style={{ maxWidth: "280px" }}>
            <span>Maximum account balance cap (GHS)</span>
            <input
              type="number"
              min="0"
              step="100"
              inputMode="decimal"
              disabled={!setup.simplifiedKyc.enabled}
              value={String(setup.simplifiedKyc.maxBalanceGhs ?? 5000)}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === "") {
                  patchSimplifiedKyc({ maxBalanceGhs: 0 });
                  return;
                }
                const num = Number(raw);
                if (Number.isFinite(num) && num >= 0) {
                  patchSimplifiedKyc({ maxBalanceGhs: Math.round(num * 100) / 100 });
                }
              }}
            />
            <p className="muted">
              Default is GHS 5,000. Set to 0 for no balance cap. Deposits above this cap are blocked until upgraded
              to Full KYC.
            </p>
          </label>
        </div>
      </section>

      <div className="form-actions">
        <button type="button" className="button" disabled={saving} onClick={() => void handleSave()}>
          {saving ? "Saving…" : "Save form setup"}
        </button>
      </div>
    </article>
  );
}
