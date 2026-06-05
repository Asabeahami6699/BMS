import type { AccountType, CustomerRegistrationInput } from "@bms/shared";
import { SAVINGS_INITIAL_DEPOSIT_GHS } from "@bms/shared";
import type { Branch, Customer, FieldAgentOption } from "../app/api";
import { listFieldAgents, submitCustomerRegistration } from "../app/api";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { AgentPhotoField } from "./components/AgentPhotoField";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { submitRegistrationOnlineOrQueue } from "./agentSync";
import { compressImageDataUrl, isDataUrlWithinLimit } from "../lib/imageCompress";
import { toUserFacingError } from "../lib/networkError";

const OPENING_FEE = SAVINGS_INITIAL_DEPOSIT_GHS;

const ACCOUNT_TYPES: { value: AccountType; label: string; hint: string }[] = [
  { value: "susu", label: "Susu (daily collection)", hint: "Regular daily Susu contributions." },
  { value: "savings", label: "Savings", hint: "Fixed GHS 20 opening fee and locked minimum balance." },
  { value: "group", label: "Group", hint: "Group savings account." },
  { value: "meba_daakye", label: "Meba Daakye", hint: "Meba Daakye product." }
];

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
  const [form, setForm] = useState(EMPTY_FORM);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [photoName, setPhotoName] = useState<string | undefined>();
  const [idCardPhotoUrl, setIdCardPhotoUrl] = useState<string | undefined>();
  const [idCardPhotoName, setIdCardPhotoName] = useState<string | undefined>();
  const [savingsOpeningFeeCollected, setSavingsOpeningFeeCollected] = useState<boolean | null>(null);
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
  const accountHint = ACCOUNT_TYPES.find((t) => t.value === form.accountType)?.hint;

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
    const branchId = defaultBranchId ?? activeBranches[0]?.id ?? "";
    setHomeBranchId(branchId);
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

  function updateField<K extends keyof typeof EMPTY_FORM>(key: K, value: (typeof EMPTY_FORM)[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (!idCardPhotoUrl) {
      showToast("Take a photo of the customer's ID card.", "error");
      return;
    }

    if (isSavings && savingsOpeningFeeCollected === null) {
      showToast("Choose how the GHS 20 opening fee was handled.", "error");
      return;
    }

    if (isOffice) {
      if (!homeBranchId || !assignedFieldAgentId) {
        showToast("Select home branch and assigned field agent.", "error");
        return;
      }
      if (activeBranches.length === 0) {
        showToast("Add an active branch before registering customers.", "error");
        return;
      }
      if (agentsForBranch.length === 0) {
        showToast("Add an active field agent for this branch first.", "error");
        return;
      }
    }

    setSubmitting(true);
    try {
      const photoForSubmit = await preparePhoto(photoUrl);
      const idCardForSubmit = await preparePhoto(idCardPhotoUrl);
      if (!idCardForSubmit) {
        showToast("Take a photo of the customer's ID card.", "error");
        setSubmitting(false);
        return;
      }

      const payload: CustomerRegistrationInput = {
        fullName: form.fullName,
        email: form.email.trim() || undefined,
        phone: form.phone,
        location: form.location,
        houseNumber: form.houseNumber,
        accountType: form.accountType,
        idCardNumber: form.idCardNumber,
        photoUrl: photoForSubmit,
        idCardPhotoUrl: idCardForSubmit,
        savingsOpeningFeeCollected: isSavings ? savingsOpeningFeeCollected === true : undefined,
        nextOfKin: {
          fullName: form.kinName,
          phone: form.kinPhone,
          location: form.kinUseCustomerAddress ? form.location : form.kinLocation,
          houseNumber: form.kinUseCustomerAddress
            ? form.houseNumber || undefined
            : form.kinHouseNumber || undefined
        },
        dailyContributionAmount: parseDailyContribution(form.dailyContributionAmount),
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

  return (
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
            {submitting ? "Submitting…" : "Submit registration"}
          </button>
        </>
      }
    >
      <form id="agent-registration-form" className="stack-form agent-form" onSubmit={handleSubmit}>
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

            <label className="field">
              <span>Email (optional)</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="e.g. kwame@email.com"
                autoComplete="email"
              />
            </label>

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

            <label className="field">
              <span>House number</span>
              <input
                value={form.houseNumber}
                onChange={(e) => updateField("houseNumber", e.target.value)}
                placeholder="e.g. H/12, Block B"
                required
              />
            </label>

            <label className="field agent-form__span-2">
              <span>Account type</span>
              <select
                value={form.accountType}
                onChange={(e) => updateField("accountType", e.target.value as AccountType)}
                aria-describedby="account-type-hint"
              >
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
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

        {isSavings ? (
          <section className="agent-savings-panel agent-form__span-2" aria-labelledby="savings-opening-fee-title">
            <h3 id="savings-opening-fee-title" className="agent-savings-panel__title">
              Savings — GHS {OPENING_FEE.toFixed(2)} opening fee
            </h3>
            <ol className="agent-savings-panel__steps muted">
              <li>
                <strong>GHS {OPENING_FEE.toFixed(2)} cash from customer</strong> —{" "}
                {isOffice ? "collect at the branch" : "you collect this fee"} (choose an option below).
              </li>
              <li>
                <strong>GHS {OPENING_FEE.toFixed(2)} on the account</strong> — credited when approved; customer cannot
                withdraw this amount.
              </li>
            </ol>

            <p className="agent-savings-panel__prompt">
              How was the <strong>GHS {OPENING_FEE.toFixed(2)} opening fee</strong> handled?
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
                    GHS {OPENING_FEE.toFixed(2)} collected from the customer in cash.
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
                    Customer did not pay now. Up to GHS {OPENING_FEE.toFixed(2)} will be taken from their first
                    deposit(s) after approval.
                  </span>
                </span>
              </label>
            </div>
          </section>
        ) : null}

        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Identity &amp; KYC</h3>
          <div className="agent-form__grid">
            <label className="field agent-form__span-2">
              <span>ID card number</span>
              <input
                value={form.idCardNumber}
                onChange={(e) => updateField("idCardNumber", e.target.value)}
                placeholder="e.g. GHA-123456789-0"
                required
              />
            </label>
          </div>
          <div className="agent-form__photos">
            <AgentPhotoField
              label="ID card photo"
              hint="Capture the front of the Ghana Card or other ID — must be readable."
              photoUrl={idCardPhotoUrl}
              photoName={idCardPhotoName}
              onPhotoChange={(url, name) => {
                setIdCardPhotoUrl(url);
                setIdCardPhotoName(name);
              }}
              required
            />

            <AgentPhotoField
              label="Customer photo"
              hint="Face photo of the customer for the account file."
              photoUrl={photoUrl}
              photoName={photoName}
              onPhotoChange={(url, name) => {
                setPhotoUrl(url);
                setPhotoName(name);
              }}
            />
          </div>
        </section>

        <fieldset className="agent-fieldset agent-form__section">
          <legend>Next of kin</legend>
          <div className="agent-form__grid">
            <label className="field">
              <span>Name</span>
              <input
                value={form.kinName}
                onChange={(e) => updateField("kinName", e.target.value)}
                placeholder="e.g. Ama Mensah"
                required
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
                required
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
                    required
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

        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Contribution plan</h3>
          <div className="agent-form__grid agent-form__grid--center">
            <label className="field agent-form__field--amount">
              <span>Daily contribution (GHS)</span>
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
                placeholder={isSavings ? "0.00" : "20.00"}
              />
              <FieldHint>
                {isSavings
                  ? "Enter 0.00 if the customer does not pay a fixed amount every day."
                  : "Amount the customer is expected to pay each collection day."}
              </FieldHint>
            </label>
          </div>
        </section>

        <p className="muted agent-form__foot">Account number appears after approval.</p>
      </form>
    </Modal>
  );
}
