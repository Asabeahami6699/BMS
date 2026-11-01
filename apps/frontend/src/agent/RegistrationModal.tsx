import type { AccountType, CustomerRegistrationInput, RegistrationFormSetup } from "@bms/shared";
import {
  defaultRegistrationFormSetup,
  registrationFormIssue,
  registrationPayloadForSetup
} from "@bms/shared";
import type { Branch, Customer, FieldAgentOption } from "../app/api";
import { getRegistrationFormSetup, listFieldAgents, submitCustomerRegistration } from "../app/api";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AgentPhotoField } from "./components/AgentPhotoField";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { submitRegistrationOnlineOrQueue } from "./agentSync";
import { compressImageDataUrl, isDataUrlWithinLimit } from "../lib/imageCompress";
import { toUserFacingError } from "../lib/networkError";

function money(amount: number): string {
  return `GHS ${amount.toFixed(2)}`;
}

const EMPTY_FORM = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  houseNumber: "",
  accountType: "susu" as AccountType,
  idCardNumber: "",
  kinName: "",
  kinPhone: "",
  kinUseCustomerAddress: true,
  kinLocation: "",
  kinHouseNumber: "",
  dailyContributionAmount: "20"
};

function parseDailyContribution(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 0;
  }
  const amount = Number(trimmed);
  return Number.isFinite(amount) && amount >= 0 ? amount : 0;
}

function isValidDailyContributionInput(value: string): boolean {
  return value === "" || /^\d*\.?\d{0,2}$/.test(value);
}

type RegistrationVariant = "agent" | "office";

type Props = {
  open: boolean;
  onClose: () => void;
  onSubmitted: (customer?: Customer) => void;
  /** Field agent app (default) or branch walk-in registration on the customers page. */
  variant?: RegistrationVariant;
  defaultBranchId?: string;
  branches?: Branch[];
};

async function preparePhoto(dataUrl: string | undefined): Promise<string | undefined> {
  if (!dataUrl) {
    return undefined;
  }
  const compressed = await compressImageDataUrl(dataUrl);
  if (!isDataUrlWithinLimit(compressed)) {
    throw new Error("PHOTO_TOO_LARGE");
  }
  return compressed;
}

function RegistrationPreview({
  form,
  isOffice,
  isSavings,
  savingsOpeningFeeCollected,
  branchLabel,
  agentLabel,
  photoUrl,
  idCardPhotoUrl,
  openingFee,
  accountLabel,
  fields
}: {
  form: typeof EMPTY_FORM;
  isOffice: boolean;
  isSavings: boolean;
  savingsOpeningFeeCollected: boolean | null;
  branchLabel: string;
  agentLabel: string;
  photoUrl?: string;
  idCardPhotoUrl?: string;
  openingFee: number;
  accountLabel: string;
  fields: RegistrationFormSetup["fields"];
}) {
  const kinAddress = form.kinUseCustomerAddress
    ? [form.location, form.houseNumber].filter(Boolean).join(", ")
    : [form.kinLocation, form.kinHouseNumber].filter(Boolean).join(", ");
  return (
    <div className="agent-reg-preview">
      <dl>
        {isOffice ? (
          <>
            <dt>Home branch</dt>
            <dd>{branchLabel || "—"}</dd>
            <dt>Assigned field agent</dt>
            <dd>{agentLabel || "—"}</dd>
          </>
        ) : null}
        <dt>Full name</dt>
        <dd>{form.fullName}</dd>
        <dt>Phone</dt>
        <dd>{form.phone}</dd>
        {fields.email !== "hidden" && form.email ? (
          <>
            <dt>Email</dt>
            <dd>{form.email}</dd>
          </>
        ) : null}
        <dt>Address</dt>
        <dd>
          {[form.location, fields.houseNumber === "hidden" ? "" : form.houseNumber].filter(Boolean).join(", ") || "—"}
        </dd>
        <dt>Account type</dt>
        <dd>{accountLabel}</dd>
        {isSavings && openingFee > 0 ? (
          <>
            <dt>Opening fee</dt>
            <dd>
              {savingsOpeningFeeCollected
                ? `${money(openingFee)} collected now`
                : `Not collected — deduct up to ${money(openingFee)} later`}
            </dd>
          </>
        ) : null}
        {fields.idCardNumber !== "hidden" ? (
          <>
            <dt>ID card number</dt>
            <dd>{form.idCardNumber || "—"}</dd>
          </>
        ) : null}
        {fields.nextOfKin !== "hidden" ? (
          <>
            <dt>Next of kin</dt>
            <dd>
              {[form.kinName, form.kinPhone, kinAddress].filter(Boolean).join(" · ") || "—"}
            </dd>
          </>
        ) : null}
        {fields.dailyContribution !== "hidden" ? (
          <>
            <dt>Daily contribution</dt>
            <dd>GHS {parseDailyContribution(form.dailyContributionAmount).toFixed(2)}</dd>
          </>
        ) : null}
      </dl>
      <div className="agent-reg-preview__photos">
        {fields.idCardPhoto !== "hidden" && idCardPhotoUrl ? <img src={idCardPhotoUrl} alt="ID card preview" /> : null}
        {fields.customerPhoto !== "hidden" && photoUrl ? <img src={photoUrl} alt="Customer photo preview" /> : null}
      </div>
    </div>
  );
}

function FieldHint({ children, id }: { children: React.ReactNode; id?: string }) {
  return (
    <p className="field-hint muted" id={id}>
      {children}
    </p>
  );
}

export function RegistrationModal({
  open,
  onClose,
  onSubmitted,
  variant = "agent",
  defaultBranchId,
  branches: branchesProp = []
}: Props) {
  const { showToast } = useToast();
  const isOffice = variant === "office";
  const [submitting, setSubmitting] = useState(false);
  const [step, setStep] = useState<"form" | "preview">("form");
  const [form, setForm] = useState(EMPTY_FORM);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [photoName, setPhotoName] = useState<string | undefined>();
  const [idCardPhotoUrl, setIdCardPhotoUrl] = useState<string | undefined>();
  const [idCardPhotoName, setIdCardPhotoName] = useState<string | undefined>();
  const [savingsOpeningFeeCollected, setSavingsOpeningFeeCollected] = useState<boolean | null>(null);
  const [formSetup, setFormSetup] = useState<RegistrationFormSetup>(() => defaultRegistrationFormSetup());
  const appliedDailyKey = useRef("");
  const [homeBranchId, setHomeBranchId] = useState("");
  const [assignedFieldAgentId, setAssignedFieldAgentId] = useState("");
  const [agents, setAgents] = useState<FieldAgentOption[]>([]);

  const activeBranches = useMemo(
    () => branchesProp.filter((b) => b.status !== "inactive"),
    [branchesProp]
  );

  const agentsForBranch = useMemo(() => {
    if (!homeBranchId) {
      return agents.filter((a) => a.status === "active");
    }
    const matching = agents.filter(
      (a) => a.status === "active" && (!a.branchId || a.branchId === homeBranchId)
    );
    return matching.length > 0 ? matching : agents.filter((a) => a.status === "active");
  }, [agents, homeBranchId]);

  const isSavings = form.accountType === "savings";
  const openingFee = formSetup.savingsOpeningFeeGhs;
  const activeForm = formSetup.forms.find((item) => item.id === form.accountType);
  const offeredForms = formSetup.forms.filter((item) => item.enabled);
  const accountHint = isSavings
    ? `${money(openingFee)} opening fee. ${activeForm?.hint ?? ""}`.trim()
    : activeForm?.hint;

  useEffect(() => {
    if (!open || !isOffice) {
      return;
    }
    void listFieldAgents()
      .then((rows) => setAgents(rows))
      .catch(() => setAgents([]));
  }, [open, isOffice]);

  useEffect(() => {
    if (!open || !isOffice) {
      return;
    }
    setHomeBranchId((current) => {
      if (current && activeBranches.some((branch) => branch.id === current)) {
        return current;
      }
      return defaultBranchId ?? activeBranches[0]?.id ?? "";
    });
  }, [open, isOffice, defaultBranchId, activeBranches]);

  useEffect(() => {
    if (!isOffice || !homeBranchId) {
      return;
    }
    if (assignedFieldAgentId && agentsForBranch.some((a) => a.userId === assignedFieldAgentId)) {
      return;
    }
    setAssignedFieldAgentId(agentsForBranch[0]?.userId ?? "");
  }, [isOffice, homeBranchId, agentsForBranch, assignedFieldAgentId]);

  useEffect(() => {
    if (!open) {
      setStep("form");
      setForm(EMPTY_FORM);
      setPhotoUrl(undefined);
      setPhotoName(undefined);
      setIdCardPhotoUrl(undefined);
      setIdCardPhotoName(undefined);
      setSavingsOpeningFeeCollected(null);
      setHomeBranchId("");
      setAssignedFieldAgentId("");
    }
  }, [open]);

  useEffect(() => {
    if (form.accountType !== "savings") {
      setSavingsOpeningFeeCollected(null);
    }
  }, [form.accountType]);

  useEffect(() => {
    if (!open) {
      appliedDailyKey.current = "";
      return;
    }
    const selected = formSetup.forms.find((item) => item.id === form.accountType);
    const active = selected?.enabled ? selected : formSetup.forms.find((item) => item.enabled);
    if (!active) {
      return;
    }
    const key = `${active.id}:${active.defaultDailyContributionGhs}:${formSetup.fields.dailyContribution}:${formSetup.savingsOpeningFeeGhs}`;
    if (appliedDailyKey.current === key) {
      return;
    }
    appliedDailyKey.current = key;
    const daily =
      formSetup.fields.dailyContribution === "hidden" ? "0" : active.defaultDailyContributionGhs.toFixed(2);
    setForm((prev) => ({ ...prev, accountType: active.id, dailyContributionAmount: daily }));
  }, [open, form.accountType, formSetup]);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    void getRegistrationFormSetup()
      .then((setup) => {
        if (!cancelled) {
          setFormSetup(setup);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setFormSetup(defaultRegistrationFormSetup());
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  function updateField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function draftRegistration() {
    const askKin = formSetup.fields.nextOfKin !== "hidden";
    const kinStarted = Boolean(
      form.kinName.trim() ||
        form.kinPhone.trim() ||
        form.kinLocation.trim() ||
        form.kinHouseNumber.trim()
    );
    const includeKin = askKin && (formSetup.fields.nextOfKin === "required" || kinStarted);
    return {
      accountType: form.accountType,
      email: form.email,
      houseNumber: form.houseNumber,
      idCardNumber: form.idCardNumber,
      idCardPhotoUrl,
      photoUrl,
      nextOfKin: includeKin
        ? {
            fullName: form.kinName,
            phone: form.kinPhone,
            location: form.kinUseCustomerAddress ? form.location : form.kinLocation,
            houseNumber: form.kinUseCustomerAddress
              ? form.houseNumber || undefined
              : form.kinHouseNumber || undefined
          }
        : undefined,
      dailyContributionAmount: parseDailyContribution(form.dailyContributionAmount)
    };
  }

  function reviewError(): string | null {
    if (!form.fullName.trim() || !form.phone.trim() || !form.location.trim()) {
      return "Fill in the customer's name, phone, and location.";
    }
    const issue = registrationFormIssue(draftRegistration(), formSetup);
    if (issue) {
      return issue;
    }
    if (isSavings && openingFee > 0 && savingsOpeningFeeCollected === null) {
      return `Choose how the ${money(openingFee)} opening fee was handled.`;
    }
    if (isOffice) {
      if (activeBranches.length === 0) {
        return "Add an active branch before registering customers.";
      }
      if (!homeBranchId || !assignedFieldAgentId) {
        return "Select home branch and assigned field agent.";
      }
      if (agentsForBranch.length === 0) {
        return "Add an active field agent for this branch first.";
      }
    }
    return null;
  }

  function handleReview(event: FormEvent) {
    event.preventDefault();
    const error = reviewError();
    if (error) {
      showToast(error, "error");
      return;
    }
    setStep("preview");
  }

  async function handleSubmit() {
    const error = reviewError();
    if (error) {
      showToast(error, "error");
      setStep("form");
      return;
    }

    setSubmitting(true);
    try {
      const photoForSubmit = await preparePhoto(photoUrl);
      const idCardForSubmit = await preparePhoto(idCardPhotoUrl);
      const cleaned = registrationPayloadForSetup(
        {
          ...draftRegistration(),
          idCardPhotoUrl: idCardForSubmit,
          photoUrl: photoForSubmit
        },
        formSetup
      );
      const submitIssue = registrationFormIssue(cleaned, formSetup);
      if (submitIssue) {
        showToast(submitIssue, "error");
        setSubmitting(false);
        setStep("form");
        return;
      }

      const payload: CustomerRegistrationInput = {
        fullName: form.fullName,
        email: cleaned.email,
        phone: form.phone,
        location: form.location,
        houseNumber: cleaned.houseNumber,
        accountType: form.accountType,
        idCardNumber: cleaned.idCardNumber,
        photoUrl: cleaned.photoUrl,
        idCardPhotoUrl: cleaned.idCardPhotoUrl,
        savingsOpeningFeeCollected: isSavings ? openingFee <= 0 || savingsOpeningFeeCollected === true : undefined,
        nextOfKin: cleaned.nextOfKin?.fullName && cleaned.nextOfKin.phone && cleaned.nextOfKin.location
          ? {
              fullName: cleaned.nextOfKin.fullName,
              phone: cleaned.nextOfKin.phone,
              location: cleaned.nextOfKin.location,
              houseNumber: cleaned.nextOfKin.houseNumber
            }
          : undefined,
        dailyContributionAmount: cleaned.dailyContributionAmount ?? 0,
        ...(isOffice
          ? { homeBranchId, assignedFieldAgentId }
          : {})
      };
      if (isOffice) {
        const customer = await submitCustomerRegistration(payload);
        showToast("Registration submitted for coordinator approval", "success");
        onSubmitted(customer);
        onClose();
      } else {
        const result = await submitRegistrationOnlineOrQueue(payload);
        if (result.mode === "offline") {
          showToast("Saved offline. Will sync when online.", "info");
        } else {
          showToast("Registration submitted for approval", "success");
        }
        onSubmitted(result.customer);
        onClose();
      }
    } catch (error) {
      if (error instanceof Error && error.message === "PHOTO_TOO_LARGE") {
        showToast("Photo is too large after compression. Try another image.", "error");
      } else {
        showToast(toUserFacingError(error, "Failed to submit registration"), "error");
      }
    } finally {
      setSubmitting(false);
    }
  }

  const officeReady = activeBranches.length > 0 && agentsForBranch.length > 0;
  const previewBranch = activeBranches.find((branch) => branch.id === homeBranchId);
  const previewAgent = agentsForBranch.find((agent) => agent.userId === assignedFieldAgentId);

  return (
    <>
    <Modal
      open={open}
      title={isOffice ? "Register walk-in customer" : "Create new account"}
      subtitle={
        isOffice
          ? "Full registration at the branch — same as field agent onboarding. Account number after approval."
          : "Account number is assigned after coordinator approval."
      }
      onClose={onClose}
      panelClassName="modal-panel--70 modal-panel--registration"
      captureDismiss={step !== "preview"}
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            form="agent-registration-form"
            className="button"
            disabled={submitting || (isOffice && !officeReady)}
          >
            Review details
          </button>
        </>
      }
    >
      <form
        id="agent-registration-form"
        className="stack-form agent-form"
        onSubmit={handleReview}
        autoComplete="off"
      >
        {isOffice ? (
          <section className="agent-form__section">
            <h3 className="agent-form__section-title">Branch &amp; servicing</h3>
            {activeBranches.length === 0 ? (
              <p className="muted agent-form__section-note">No active branches. Add one under Settings → Branches.</p>
            ) : null}
            <div className="agent-form__grid">
              <label className="field">
                <span>Home branch</span>
                <select
                  value={homeBranchId}
                  onChange={(e) => setHomeBranchId(e.target.value)}
                  required
                >
                  <option value="">Select branch</option>
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} ({b.code})
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Assigned field agent</span>
                <select
                  value={assignedFieldAgentId}
                  onChange={(e) => setAssignedFieldAgentId(e.target.value)}
                  required
                >
                  <option value="">Select agent</option>
                  {agentsForBranch.map((a) => (
                    <option key={a.userId} value={a.userId}>
                      {a.fullName?.trim() || a.email || a.userId}
                    </option>
                  ))}
                </select>
                {agentsForBranch.length === 0 ? (
                  <FieldHint>No active field agents for this branch.</FieldHint>
                ) : null}
              </label>
            </div>
          </section>
        ) : null}

        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Personal details</h3>
          <div className="agent-form__grid">
            <label className="field agent-form__span-2">
              <span>Full name</span>
              <input
                value={form.fullName}
                onChange={(e) => updateField("fullName", e.target.value)}
                placeholder="e.g. Kwame Mensah"
                autoComplete="name"
                required
              />
            </label>

            {formSetup.fields.email !== "hidden" ? (
            <label className="field">
              <span>Email{formSetup.fields.email === "optional" ? " (optional)" : ""}</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="e.g. kwame@email.com"
                autoComplete="email"
                required={formSetup.fields.email === "required"}
              />
            </label>
            ) : null}

            <label className="field">
              <span>Phone</span>
              <input
                type="tel"
                inputMode="tel"
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                placeholder="e.g. 024 123 4567"
                autoComplete="tel"
                required
              />
            </label>

            <label className="field">
              <span>Location / area</span>
              <input
                value={form.location}
                onChange={(e) => updateField("location", e.target.value)}
                placeholder="e.g. Osu, Accra"
                required
              />
            </label>

            {formSetup.fields.houseNumber !== "hidden" ? (
            <label className="field">
              <span>House number{formSetup.fields.houseNumber === "optional" ? " (optional)" : ""}</span>
              <input
                value={form.houseNumber}
                onChange={(e) => updateField("houseNumber", e.target.value)}
                placeholder="e.g. H/12, Block B"
                required={formSetup.fields.houseNumber === "required"}
              />
            </label>
            ) : null}

            <label className="field agent-form__span-2">
              <span>Account type</span>
              <select
                value={form.accountType}
                onChange={(e) => updateField("accountType", e.target.value as AccountType)}
                aria-describedby="account-type-hint"
              >
                {(offeredForms.length > 0 ? offeredForms : formSetup.forms).map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.label}
                  </option>
                ))}
              </select>
              {accountHint ? (
                <FieldHint id="account-type-hint">{accountHint}</FieldHint>
              ) : null}
            </label>
          </div>
        </section>

        {isSavings && openingFee > 0 ? (
          <section className="agent-savings-panel agent-form__span-2" aria-labelledby="savings-opening-fee-title">
            <h3 id="savings-opening-fee-title" className="agent-savings-panel__title">
              Savings — {money(openingFee)} opening fee
            </h3>
            <ol className="agent-savings-panel__steps muted">
              <li>
                <strong>{money(openingFee)} cash from customer</strong> —{" "}
                {isOffice ? "collect at the branch" : "you collect this fee"} (choose an option below).
              </li>
              <li>
                <strong>{money(openingFee)} on the account</strong> — credited when approved; customer cannot
                withdraw this amount.
              </li>
            </ol>

            <p className="agent-savings-panel__prompt">
              How was the <strong>{money(openingFee)} opening fee</strong> handled?
            </p>

            <div className="agent-fee-choices" role="radiogroup" aria-label="Opening fee collection">
              <label
                className={`agent-fee-choice${savingsOpeningFeeCollected === true ? " agent-fee-choice--selected" : ""}`}
              >
                <input
                  type="radio"
                  name="savings-opening-fee"
                  checked={savingsOpeningFeeCollected === true}
                  onChange={() => setSavingsOpeningFeeCollected(true)}
                />
                <span className="agent-fee-choice__body">
                  <span className="agent-fee-choice__title">Cash collected now</span>
                  <span className="agent-fee-choice__detail muted">
                    {money(openingFee)} collected from the customer in cash.
                  </span>
                </span>
              </label>

              <label
                className={`agent-fee-choice${savingsOpeningFeeCollected === false ? " agent-fee-choice--selected" : ""}`}
              >
                <input
                  type="radio"
                  name="savings-opening-fee"
                  checked={savingsOpeningFeeCollected === false}
                  onChange={() => setSavingsOpeningFeeCollected(false)}
                />
                <span className="agent-fee-choice__body">
                  <span className="agent-fee-choice__title">Not collected — deduct later</span>
                  <span className="agent-fee-choice__detail muted">
                    Customer did not pay now. Up to {money(openingFee)} will be taken from their first
                    deposit(s) after approval.
                  </span>
                </span>
              </label>
            </div>
          </section>
        ) : null}

        {formSetup.fields.idCardNumber !== "hidden" ||
        formSetup.fields.idCardPhoto !== "hidden" ||
        formSetup.fields.customerPhoto !== "hidden" ? (
        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Identity &amp; KYC</h3>
          {formSetup.fields.idCardNumber !== "hidden" ? (
          <div className="agent-form__grid">
            <label className="field agent-form__span-2">
              <span>ID card number{formSetup.fields.idCardNumber === "optional" ? " (optional)" : ""}</span>
              <input
                value={form.idCardNumber}
                onChange={(e) => updateField("idCardNumber", e.target.value)}
                placeholder="e.g. GHA-123456789-0"
                required={formSetup.fields.idCardNumber === "required"}
              />
            </label>
          </div>
          ) : null}
          <div className="agent-form__photos">
            {formSetup.fields.idCardPhoto !== "hidden" ? (
            <AgentPhotoField
              label="ID card photo"
              hint="Capture the front of the Ghana Card or other ID — must be readable."
              captureGuide="Center the ID card in the frame"
              facingMode="environment"
              photoUrl={idCardPhotoUrl}
              photoName={idCardPhotoName}
              onPhotoChange={(url, name) => {
                setIdCardPhotoUrl(url);
                setIdCardPhotoName(name);
              }}
              required={formSetup.fields.idCardPhoto === "required"}
            />
            ) : null}

            {formSetup.fields.customerPhoto !== "hidden" ? (
            <AgentPhotoField
              label="Customer photo"
              hint="Face photo of the customer for the account file."
              captureGuide="Center the customer's face in the frame"
              facingMode="user"
              photoUrl={photoUrl}
              photoName={photoName}
              onPhotoChange={(url, name) => {
                setPhotoUrl(url);
                setPhotoName(name);
              }}
              required={formSetup.fields.customerPhoto === "required"}
            />
            ) : null}
          </div>
        </section>
        ) : null}

        {formSetup.fields.nextOfKin !== "hidden" ? (
        <fieldset className="agent-fieldset agent-form__section">
          <legend>Next of kin{formSetup.fields.nextOfKin === "optional" ? " (optional)" : ""}</legend>
          <div className="agent-form__grid">
            <label className="field">
              <span>Name</span>
              <input
                value={form.kinName}
                onChange={(e) => updateField("kinName", e.target.value)}
                placeholder="e.g. Ama Mensah"
                required={formSetup.fields.nextOfKin === "required"}
              />
            </label>
            <label className="field">
              <span>Phone number</span>
              <input
                type="tel"
                inputMode="tel"
                value={form.kinPhone}
                onChange={(e) => updateField("kinPhone", e.target.value)}
                placeholder="e.g. 055 987 6543"
                required={formSetup.fields.nextOfKin === "required"}
              />
            </label>
            <label className="field agent-field-checkbox agent-form__span-2">
              <input
                type="checkbox"
                checked={form.kinUseCustomerAddress}
                onChange={(e) => updateField("kinUseCustomerAddress", e.target.checked)}
              />
              <span>Next of kin uses same address as customer</span>
            </label>
            {form.kinUseCustomerAddress ? (
              <p className="muted agent-kin-address-preview agent-form__span-2">
                {form.location || form.houseNumber
                  ? `Address: ${[form.location, form.houseNumber].filter(Boolean).join(", ")}`
                  : "Will use the location and house number entered above."}
              </p>
            ) : (
              <>
                <label className="field">
                  <span>Next of kin location</span>
                  <input
                    value={form.kinLocation}
                    onChange={(e) => updateField("kinLocation", e.target.value)}
                    placeholder="e.g. Kumasi, Asokwa"
                    required={formSetup.fields.nextOfKin === "required"}
                  />
                </label>
                <label className="field">
                  <span>Next of kin house number (optional)</span>
                  <input
                    value={form.kinHouseNumber}
                    onChange={(e) => updateField("kinHouseNumber", e.target.value)}
                    placeholder="e.g. H/5"
                  />
                </label>
              </>
            )}
          </div>
        </fieldset>
        ) : null}

        {formSetup.fields.dailyContribution !== "hidden" ? (
        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Contribution plan</h3>
          <div className="agent-form__grid agent-form__grid--center">
            <label className="field agent-form__field--amount">
              <span>
                Daily contribution (GHS)
                {formSetup.fields.dailyContribution === "optional" ? " (optional)" : ""}
              </span>
              <input
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={form.dailyContributionAmount}
                onChange={(e) => {
                  const next = e.target.value;
                  if (isValidDailyContributionInput(next)) {
                    updateField("dailyContributionAmount", next);
                  }
                }}
                placeholder={(activeForm?.defaultDailyContributionGhs ?? 0).toFixed(2)}
                required={formSetup.fields.dailyContribution === "required"}
              />
              <FieldHint>
                {formSetup.fields.dailyContribution === "required"
                  ? "Amount the customer is expected to pay each collection day."
                  : "Enter 0.00 if the customer does not pay a fixed amount every day."}
              </FieldHint>
            </label>
          </div>
        </section>
        ) : null}

        <p className="muted agent-form__foot">Account number appears after approval.</p>
      </form>
    </Modal>
    <Modal
      open={open && step === "preview"}
      stacked
      title="Review registration"
      titleId="registration-preview-title"
      subtitle="Check these details, then confirm. Nothing is sent until you confirm."
      onClose={() => {
        if (!submitting) {
          setStep("form");
        }
      }}
      panelClassName="modal-panel--70 modal-panel--registration"
      footer={
        <>
          <button type="button" className="button secondary" onClick={() => setStep("form")} disabled={submitting}>
            Back
          </button>
          <button type="button" className="button" onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? "Submitting…" : "Confirm and submit"}
          </button>
        </>
      }
    >
      <RegistrationPreview
        form={form}
        isOffice={isOffice}
        isSavings={isSavings}
        savingsOpeningFeeCollected={savingsOpeningFeeCollected}
        branchLabel={previewBranch ? `${previewBranch.name} (${previewBranch.code})` : ""}
        agentLabel={previewAgent?.fullName?.trim() || previewAgent?.email || ""}
        photoUrl={photoUrl}
        idCardPhotoUrl={idCardPhotoUrl}
        openingFee={openingFee}
        accountLabel={activeForm?.label ?? form.accountType}
        fields={formSetup.fields}
      />
    </Modal>
    </>
  );
}
