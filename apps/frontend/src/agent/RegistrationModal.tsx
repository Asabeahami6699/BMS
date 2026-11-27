import type {
  AccountType,
  CustomerIdCardType,
  CustomerRegistrationInput,
  RegistrationFormSetup
} from "@bms/shared";
import {
  CUSTOMER_ID_CARD_TYPE_OPTIONS,
  defaultRegistrationFormSetup,
  formatAccountAmount,
  formatGhs,
  formatIdCardTypeLabel,
  registrationFormIssue,
  registrationPayloadForSetup,
  showDailyContributionForAccountType
} from "@bms/shared";
import type { Branch, Customer, FieldAgentOption } from "../app/api";
import {
  getCustomer,
  getRegistrationFormSetup,
  listFieldAgents,
  resubmitCustomerRegistration,
  submitCustomerRegistration
} from "../app/api";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AgentPhotoField } from "./components/AgentPhotoField";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { submitRegistrationOnlineOrQueue } from "./agentSync";
import { compressImageDataUrl, isDataUrlWithinLimit } from "../lib/imageCompress";
import { toUserFacingError } from "../lib/networkError";

function money(amount: number): string {
  return formatGhs(amount);
}

const NATIONALITY_OPTIONS = [
  "Nigerian",
  "Togolese",
  "Burkinabe",
  "Ivorian",
  "Beninese",
  "Nigerien",
  "Malian",
  "Liberian",
  "Sierra Leonean",
  "Guinean",
  "Senegalese",
  "Gambian",
  "Cameroonian",
  "Chadian",
  "Cape Verdean",
  "Guinea-Bissauan",
  "Ghanaian",
  "Kenyan",
  "South African",
  "Ethiopian",
  "Egyptian",
  "Moroccan",
  "Lebanese",
  "Indian",
  "Chinese",
  "Pakistani",
  "Syrian",
  "Turkish",
  "British",
  "American",
  "Canadian",
  "French",
  "German",
  "Dutch",
  "Italian",
  "Filipino",
  "Brazilian"
] as const;

const NATIONALITY_OPTION_SET = new Set<string>(NATIONALITY_OPTIONS);

const EMPTY_FORM = {
  fullName: "",
  email: "",
  phone: "",
  location: "",
  houseNumber: "",
  dateOfBirth: "",
  occupation: "",
  accountType: "susu" as AccountType,
  idCardType: "ghana_card" as CustomerIdCardType,
  idCardNumber: "",
  nationality: "",
  introducerName: "",
  introducerPhone: "",
  introducerRelationship: "",
  introducerGhanaCard: "",
  kinName: "",
  kinPhone: "",
  kinUseCustomerAddress: true,
  kinLocation: "",
  kinHouseNumber: "",
  dailyContributionAmount: "20",
  initialDepositAmount: "20"
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
  /** When set, opens in "Fix & resubmit" mode for a rejected registration. */
  editCustomer?: Customer | null;
};

function formStateFromCustomer(customer: Customer): typeof EMPTY_FORM {
  const kinLoc = customer.nextOfKin?.location ?? "";
  const kinHouse = customer.nextOfKin?.houseNumber ?? "";
  const custLoc = customer.location ?? "";
  const custHouse = customer.houseNumber ?? "";
  const kinMatchesCustomer =
    !kinLoc ||
    (kinLoc.trim().toLowerCase() === custLoc.trim().toLowerCase() &&
      kinHouse.trim().toLowerCase() === custHouse.trim().toLowerCase());

  return {
    fullName: customer.fullName ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    location: custLoc,
    houseNumber: custHouse,
    dateOfBirth: customer.dateOfBirth ?? "",
    occupation: customer.occupation ?? "",
    accountType: (customer.accountType ?? "susu") as AccountType,
    idCardType: (customer.idCardType ?? "ghana_card") as CustomerIdCardType,
    idCardNumber: customer.idCardNumber ?? "",
    nationality: customer.nationality ?? "",
    introducerName: customer.kycIntroducer?.fullName ?? "",
    introducerPhone: customer.kycIntroducer?.phone ?? "",
    introducerRelationship: customer.kycIntroducer?.relationship ?? "",
    introducerGhanaCard: customer.kycIntroducer?.ghanaCardNumber ?? "",
    kinName: customer.nextOfKin?.fullName ?? "",
    kinPhone: customer.nextOfKin?.phone ?? "",
    kinUseCustomerAddress: kinMatchesCustomer,
    kinLocation: kinMatchesCustomer ? "" : kinLoc,
    kinHouseNumber: kinMatchesCustomer ? "" : kinHouse,
    dailyContributionAmount:
      customer.dailyContributionAmount > 0 ? customer.dailyContributionAmount.toFixed(2) : "0",
    initialDepositAmount:
      customer.initialDepositAmount != null && customer.initialDepositAmount > 0
        ? customer.initialDepositAmount.toFixed(2)
        : "20"
  };
}

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

function initialsFor(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function RegistrationPreview({
  form,
  isOffice,
  isSavings,
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
  branchLabel: string;
  agentLabel: string;
  photoUrl?: string;
  idCardPhotoUrl?: string;
  openingFee: number;
  accountLabel: string;
  fields: RegistrationFormSetup["fields"];
}) {
  const customerAddress =
    [form.location, fields.houseNumber === "hidden" ? "" : form.houseNumber].filter(Boolean).join(", ") || "—";
  const kinAddress =
    (form.kinUseCustomerAddress
      ? [form.location, form.houseNumber].filter(Boolean).join(", ")
      : [form.kinLocation, form.kinHouseNumber].filter(Boolean).join(", ")) || "—";
  const showDailyContribution = showDailyContributionForAccountType(
    form.accountType,
    fields.dailyContribution
  );
  const dailyContribution = showDailyContribution
    ? parseDailyContribution(form.dailyContributionAmount)
    : 0;
  const isSimplifiedKyc = form.idCardType === "no_id_simplified_kyc";
  const showIdPhoto = !isSimplifiedKyc && fields.idCardPhoto !== "hidden" && Boolean(idCardPhotoUrl);
  const showCustomerPhoto = (isSimplifiedKyc || fields.customerPhoto !== "hidden") && Boolean(photoUrl);
  const showPhotosSection = showIdPhoto || showCustomerPhoto;

  return (
    <div className="agent-reg-preview">
      <div className="agent-reg-preview__hero">
        <div className="agent-reg-preview__avatar" aria-hidden="true">
          {showCustomerPhoto && photoUrl ? (
            <img src={photoUrl} alt="" />
          ) : (
            <span>{initialsFor(form.fullName)}</span>
          )}
        </div>
        <div className="agent-reg-preview__hero-body">
          <div className="agent-reg-preview__hero-top">
            <h3 className="agent-reg-preview__name">{form.fullName || "New customer"}</h3>
            <span className="agent-reg-preview__pill">{accountLabel}</span>
          </div>
          <div className="agent-reg-preview__hero-meta">
            <span>{form.phone || "—"}</span>
            {customerAddress !== "—" ? (
              <>
                <span className="agent-reg-preview__sep" aria-hidden="true">·</span>
                <span>{customerAddress}</span>
              </>
            ) : null}
          </div>
          <div className="agent-reg-preview__hero-chips">
            {showDailyContribution ? (
              <span className="agent-reg-preview__chip agent-reg-preview__chip--accent">
                Daily: GHS {formatAccountAmount(dailyContribution)}
              </span>
            ) : null}
            {isSavings ? (
              <span className="agent-reg-preview__chip agent-reg-preview__chip--accent">
                Initial deposit: {money(parseDailyContribution(form.initialDepositAmount))}
              </span>
            ) : null}
            {isOffice && branchLabel ? (
              <span className="agent-reg-preview__chip">{branchLabel}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="agent-reg-preview__sections">
        {isOffice ? (
          <section className="agent-reg-preview__card">
            <h4 className="agent-reg-preview__card-title">Branch &amp; servicing</h4>
            <dl className="agent-reg-preview__grid">
              <div>
                <dt>Home branch</dt>
                <dd>{branchLabel || "—"}</dd>
              </div>
              <div>
                <dt>Assigned field agent</dt>
                <dd>{agentLabel || "—"}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="agent-reg-preview__card">
          <h4 className="agent-reg-preview__card-title">Personal &amp; contact</h4>
          <dl className="agent-reg-preview__grid">
            <div>
              <dt>Full name</dt>
              <dd>{form.fullName || "—"}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>{form.phone || "—"}</dd>
            </div>
            {fields.email !== "hidden" && form.email ? (
              <div>
                <dt>Email</dt>
                <dd>{form.email}</dd>
              </div>
            ) : null}
            {fields.dateOfBirth !== "hidden" ? (
              <div>
                <dt>Date of birth</dt>
                <dd>{form.dateOfBirth || "—"}</dd>
              </div>
            ) : null}
            {fields.occupation !== "hidden" ? (
              <div>
                <dt>Occupation</dt>
                <dd>{form.occupation || "—"}</dd>
              </div>
            ) : null}
            <div className="agent-reg-preview__span-2">
              <dt>Address</dt>
              <dd>{customerAddress}</dd>
            </div>
          </dl>
        </section>

        <section className="agent-reg-preview__card">
          <h4 className="agent-reg-preview__card-title">Account &amp; identity</h4>
          <dl className="agent-reg-preview__grid">
            <div>
              <dt>Account type</dt>
              <dd>{accountLabel}</dd>
            </div>
            {showDailyContribution ? (
              <div>
                <dt>Daily contribution</dt>
                <dd>GHS {formatAccountAmount(dailyContribution)}</dd>
              </div>
            ) : null}
            {fields.idCardNumber !== "hidden" ? (
              isSimplifiedKyc ? (
                <>
                  <div>
                    <dt>KYC tier</dt>
                    <dd>
                      <span className="kyc-tier-badge kyc-tier-badge--simplified">
                        Tier 1 · Simplified KYC
                      </span>
                    </dd>
                  </div>
                  <div>
                    <dt>Nationality</dt>
                    <dd>{form.nationality || "—"}</dd>
                  </div>
                  <div>
                    <dt>Local introducer</dt>
                    <dd>
                      {form.introducerName || "—"} ({form.introducerRelationship || "—"})
                    </dd>
                  </div>
                  <div>
                    <dt>Introducer Ghana Card &amp; phone</dt>
                    <dd className="agent-reg-preview__mono">
                      {form.introducerGhanaCard || "—"} · {form.introducerPhone || "—"}
                    </dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>ID card type</dt>
                    <dd>{formatIdCardTypeLabel(form.idCardType)}</dd>
                  </div>
                  <div>
                    <dt>ID card number</dt>
                    <dd className="agent-reg-preview__mono">{form.idCardNumber || "—"}</dd>
                  </div>
                </>
              )
            ) : null}
            {isSavings ? (
              <div className="agent-reg-preview__span-2">
                <dt>Initial deposit</dt>
                <dd>
                  {money(parseDailyContribution(form.initialDepositAmount))} — credits to account on
                  approval
                  {openingFee > 0 ? ` (minimum locked balance: ${money(openingFee)})` : ""}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>

        {fields.nextOfKin !== "hidden" ? (
          <section className="agent-reg-preview__card">
            <h4 className="agent-reg-preview__card-title">Next of kin</h4>
            <dl className="agent-reg-preview__grid">
              <div>
                <dt>Name</dt>
                <dd>{form.kinName || "—"}</dd>
              </div>
              <div>
                <dt>Phone</dt>
                <dd>{form.kinPhone || "—"}</dd>
              </div>
              <div className="agent-reg-preview__span-2">
                <dt>Address</dt>
                <dd>{kinAddress}</dd>
              </div>
            </dl>
          </section>
        ) : null}
      </div>

      {showPhotosSection ? (
        <section className="agent-reg-preview__card">
          <h4 className="agent-reg-preview__card-title">Uploaded photos</h4>
          <div className="agent-reg-preview__photos">
            {showCustomerPhoto && photoUrl ? (
              <figure className="agent-reg-preview__photo-card">
                <div className="agent-reg-preview__photo-frame agent-reg-preview__photo-frame--portrait">
                  <img src={photoUrl} alt="Customer photo preview" />
                </div>
                <figcaption>Customer photo</figcaption>
              </figure>
            ) : null}
            {showIdPhoto && idCardPhotoUrl ? (
              <figure className="agent-reg-preview__photo-card">
                <div className="agent-reg-preview__photo-frame agent-reg-preview__photo-frame--id">
                  <img src={idCardPhotoUrl} alt="ID card preview" />
                </div>
                <figcaption>ID card</figcaption>
              </figure>
            ) : null}
          </div>
        </section>
      ) : null}
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
  branches: branchesProp = [],
  editCustomer = null
}: Props) {
  const { showToast } = useToast();
  const isOffice = variant === "office";
  const isEditMode = Boolean(editCustomer);
  const [submitting, setSubmitting] = useState(false);
  const [loadingExisting, setLoadingExisting] = useState(false);
  const [step, setStep] = useState<"form" | "preview">("form");
  const [form, setForm] = useState(EMPTY_FORM);
  const [customNationalityMode, setCustomNationalityMode] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | undefined>();
  const [photoName, setPhotoName] = useState<string | undefined>();
  const [idCardPhotoUrl, setIdCardPhotoUrl] = useState<string | undefined>();
  const [idCardPhotoName, setIdCardPhotoName] = useState<string | undefined>();
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
  const showDailyContribution = showDailyContributionForAccountType(
    form.accountType,
    formSetup.fields.dailyContribution
  );
  const openingFee = formSetup.savingsOpeningFeeGhs;
  const activeForm = formSetup.forms.find((item) => item.id === form.accountType);
  const offeredForms = formSetup.forms.filter((item) => item.enabled);
  const accountHint = isSavings
    ? `Minimum initial deposit ${money(openingFee)}. ${activeForm?.hint ?? ""}`.trim()
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
      setCustomNationalityMode(false);
      setPhotoUrl(undefined);
      setPhotoName(undefined);
      setIdCardPhotoUrl(undefined);
      setIdCardPhotoName(undefined);
      setHomeBranchId("");
      setAssignedFieldAgentId("");
      setLoadingExisting(false);
      return;
    }
    if (!editCustomer) {
      return;
    }
    const applyCustomer = (c: Customer) => {
      setForm(formStateFromCustomer(c));
      const nat = (c.nationality ?? "").trim();
      setCustomNationalityMode(Boolean(nat) && !NATIONALITY_OPTION_SET.has(nat));
      if (c.photoUrl) {
        setPhotoUrl(c.photoUrl);
        setPhotoName("Saved customer photo");
      }
      if (c.idCardPhotoUrl) {
        setIdCardPhotoUrl(c.idCardPhotoUrl);
        setIdCardPhotoName("Saved ID photo");
      }
      if (c.homeBranchId) {
        setHomeBranchId(c.homeBranchId);
      }
      if (c.assignedFieldAgentId) {
        setAssignedFieldAgentId(c.assignedFieldAgentId);
      }
    };
    applyCustomer(editCustomer);
    let cancelled = false;
    setLoadingExisting(true);
    void getCustomer(editCustomer.id)
      .then((full) => {
        if (!cancelled) {
          applyCustomer(full);
        }
      })
      .catch(() => {
        /* keep fields from list record */
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingExisting(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, editCustomer]);

  useEffect(() => {
    if (!formSetup.simplifiedKyc.enabled && form.idCardType === "no_id_simplified_kyc") {
      setForm((prev) => ({
        ...prev,
        idCardType: "ghana_card",
        introducerName: "",
        introducerPhone: "",
        introducerRelationship: "",
        introducerGhanaCard: ""
      }));
    }
  }, [formSetup.simplifiedKyc.enabled, form.idCardType]);

  useEffect(() => {
    if (!open) {
      appliedDailyKey.current = "";
      return;
    }
    if (isEditMode) {
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
    const showDaily = showDailyContributionForAccountType(
      active.id,
      formSetup.fields.dailyContribution
    );
    const daily = showDaily ? active.defaultDailyContributionGhs.toFixed(2) : "0";
    const defaultInitDeposit = formSetup.savingsOpeningFeeGhs.toFixed(2);
    setForm((prev) => ({
      ...prev,
      accountType: active.id,
      dailyContributionAmount: daily,
      initialDepositAmount:
        active.id === "savings"
          ? prev.initialDepositAmount && parseDailyContribution(prev.initialDepositAmount) >= formSetup.savingsOpeningFeeGhs
            ? prev.initialDepositAmount
            : defaultInitDeposit
          : prev.initialDepositAmount
    }));
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
      dateOfBirth: form.dateOfBirth,
      occupation: form.occupation,
      idCardType: form.idCardType,
      idCardNumber: form.idCardNumber,
      nationality: form.nationality,
      kycIntroducer:
        form.idCardType === "no_id_simplified_kyc"
          ? {
              fullName: form.introducerName,
              phone: form.introducerPhone,
              relationship: form.introducerRelationship,
              ghanaCardNumber: form.introducerGhanaCard
            }
          : undefined,
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
      dailyContributionAmount: showDailyContribution
        ? parseDailyContribution(form.dailyContributionAmount)
        : 0
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
    if (isSavings) {
      const initDepText = form.initialDepositAmount.trim();
      const initDep = parseDailyContribution(initDepText);
      if (!initDepText || !Number.isFinite(Number(initDepText))) {
        return `Enter an initial deposit of at least ${money(openingFee)}.`;
      }
      if (initDep < openingFee) {
        return `Initial deposit must be at least ${money(openingFee)} (minimum locked balance).`;
      }
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
        dateOfBirth: cleaned.dateOfBirth,
        occupation: cleaned.occupation,
        accountType: form.accountType,
        idCardType: cleaned.idCardType as CustomerIdCardType | undefined,
        idCardNumber: cleaned.idCardNumber,
        nationality: cleaned.nationality,
        kycIntroducer:
          cleaned.kycIntroducer?.fullName &&
          cleaned.kycIntroducer.phone &&
          cleaned.kycIntroducer.relationship &&
          cleaned.kycIntroducer.ghanaCardNumber
            ? {
                fullName: cleaned.kycIntroducer.fullName,
                phone: cleaned.kycIntroducer.phone,
                relationship: cleaned.kycIntroducer.relationship,
                ghanaCardNumber: cleaned.kycIntroducer.ghanaCardNumber
              }
            : undefined,
        photoUrl: cleaned.photoUrl,
        idCardPhotoUrl: cleaned.idCardPhotoUrl,
        savingsOpeningFeeCollected: isSavings ? true : undefined,
        initialDepositAmount: isSavings
          ? parseDailyContribution(form.initialDepositAmount)
          : undefined,
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
      if (isEditMode && editCustomer) {
        const customer = await resubmitCustomerRegistration(editCustomer.id, payload);
        showToast("Registration corrected and resubmitted for coordinator approval", "success");
        onSubmitted(customer);
        onClose();
      } else if (isOffice) {
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
  const parsedInitialDeposit =
    form.initialDepositAmount.trim() === "" ? NaN : Number(form.initialDepositAmount);
  const initialDepositBelowMin =
    isSavings && (!Number.isFinite(parsedInitialDeposit) || parsedInitialDeposit < openingFee);
  const previewBranch = activeBranches.find((branch) => branch.id === homeBranchId);
  const previewAgent = agentsForBranch.find((agent) => agent.userId === assignedFieldAgentId);

  return (
    <>
    <Modal
      open={open}
      title={
        isEditMode
          ? "Fix & resubmit registration"
          : isOffice
            ? "Register walk-in customer"
            : "Create new account"
      }
      subtitle={
        isEditMode
          ? "Correct the details requested by the coordinator and resubmit for approval."
          : isOffice
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
            disabled={
              submitting ||
              loadingExisting ||
              (isOffice && !officeReady) ||
              initialDepositBelowMin
            }
          >
            {loadingExisting ? "Loading saved details…" : "Review details"}
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
        {isEditMode && editCustomer ? (
          <div
            className="callover-danger-form"
            role="status"
            style={{ marginBottom: "0.75rem" }}
          >
            <p className="callover-danger-form__note">
              <strong>Returned by coordinator — action required:</strong>{" "}
              {editCustomer.rejectionReason?.trim() ||
                "Please review and correct the customer details, then resubmit for approval."}
            </p>
            {loadingExisting ? (
              <p className="muted" style={{ margin: 0, fontSize: "0.8rem" }}>
                Loading saved photos and KYC details…
              </p>
            ) : null}
          </div>
        ) : null}
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

            {formSetup.fields.dateOfBirth !== "hidden" ? (
              <label className="field">
                <span>
                  Date of birth
                  {formSetup.fields.dateOfBirth === "optional" ? " (optional)" : ""}
                </span>
                <input
                  type="date"
                  value={form.dateOfBirth}
                  onChange={(e) => updateField("dateOfBirth", e.target.value)}
                  max={new Date().toISOString().slice(0, 10)}
                  required={formSetup.fields.dateOfBirth === "required"}
                />
              </label>
            ) : null}

            {formSetup.fields.occupation !== "hidden" ? (
              <label className="field">
                <span>
                  Occupation
                  {formSetup.fields.occupation === "optional" ? " (optional)" : ""}
                </span>
                <input
                  value={form.occupation}
                  onChange={(e) => updateField("occupation", e.target.value)}
                  placeholder="e.g. Trader, Teacher"
                  required={formSetup.fields.occupation === "required"}
                />
              </label>
            ) : null}

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

        {isSavings ? (
          <section className="agent-savings-panel agent-form__span-2" aria-labelledby="savings-initial-deposit-title">
            <h3 id="savings-initial-deposit-title" className="agent-savings-panel__title">
              Savings — Initial deposit
            </h3>
            <ol className="agent-savings-panel__steps muted">
              <li>
                <strong>Credited after approval</strong> — the full initial deposit is credited to
                the customer&apos;s account once approved and the account number is ready.
              </li>
              {openingFee > 0 ? (
                <li>
                  <strong>Minimum locked balance ({money(openingFee)})</strong> — initial deposit
                  must be at least {money(openingFee)}. The locked minimum is held on the account
                  according to Commission Settings (<em>When to deduct</em>).
                </li>
              ) : null}
            </ol>

            <label className="field">
              <span>
                Initial deposit (GHS){openingFee > 0 ? ` — min ${money(openingFee)}` : ""} *
              </span>
              <input
                type="number"
                inputMode="decimal"
                min={openingFee}
                step="0.01"
                value={form.initialDepositAmount}
                aria-invalid={initialDepositBelowMin ? "true" : undefined}
                onKeyDown={(e) => {
                  if (e.key === "-" || e.key === "+" || e.key === "e" || e.key === "E") {
                    e.preventDefault();
                  }
                }}
                onChange={(e) => {
                  const next = e.target.value;
                  if (isValidDailyContributionInput(next)) {
                    updateField("initialDepositAmount", next);
                  }
                }}
                onBlur={() => {
                  const raw = form.initialDepositAmount.trim();
                  const num = raw === "" ? NaN : Number(raw);
                  if (!Number.isFinite(num) || num < openingFee) {
                    updateField("initialDepositAmount", openingFee.toFixed(2));
                    if (raw !== "" && openingFee > 0) {
                      showToast(
                        `Initial deposit cannot be less than ${money(openingFee)} (minimum locked balance).`,
                        "error"
                      );
                    }
                  }
                }}
                placeholder={openingFee > 0 ? openingFee.toFixed(2) : "0.00"}
                required
              />
              {initialDepositBelowMin && openingFee > 0 ? (
                <p className="field-error" role="alert">
                  Cannot be less than {money(openingFee)} (minimum locked balance).
                </p>
              ) : null}
            </label>
          </section>
        ) : null}

        {formSetup.fields.idCardNumber !== "hidden" ||
        formSetup.fields.idCardPhoto !== "hidden" ||
        formSetup.fields.customerPhoto !== "hidden" ? (
        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Identity &amp; KYC</h3>
          {formSetup.fields.idCardNumber !== "hidden" ? (
          <div className="agent-form__grid">
            <label
              className={`field${form.idCardType === "no_id_simplified_kyc" ? " agent-form__span-2" : ""}`}
            >
              <span>ID card type</span>
              <select
                value={form.idCardType}
                onChange={(e) => updateField("idCardType", e.target.value as CustomerIdCardType)}
              >
                {CUSTOMER_ID_CARD_TYPE_OPTIONS.filter(
                  (opt) => !opt.isSimplifiedKyc || formSetup.simplifiedKyc.enabled
                ).map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            {form.idCardType !== "no_id_simplified_kyc" ? (
              <label className="field">
                <span>
                  {formatIdCardTypeLabel(form.idCardType)} number
                  {formSetup.fields.idCardNumber === "optional" ? " (optional)" : ""}
                </span>
                <input
                  value={form.idCardNumber}
                  onChange={(e) => updateField("idCardNumber", e.target.value)}
                  placeholder={
                    CUSTOMER_ID_CARD_TYPE_OPTIONS.find((o) => o.value === form.idCardType)
                      ?.placeholder ?? "Enter ID number"
                  }
                  required={formSetup.fields.idCardNumber === "required"}
                />
              </label>
            ) : null}
          </div>
          ) : null}

          {form.idCardType === "no_id_simplified_kyc" ? (
            <div className="kyc-simplified-banner">
              <div className="kyc-simplified-banner__head">
                <strong>Tier 1 · Simplified KYC (BoG Susu compliance)</strong>
                <span className="kyc-tier-badge kyc-tier-badge--simplified">Simplified KYC</span>
              </div>
              <p className="muted">
                For foreign residents or customers without a national ID. Capture a clear customer
                face photo and a verified local introducer holding a valid Ghana Card.
                {formSetup.simplifiedKyc.maxBalanceGhs > 0
                  ? ` Maximum balance cap: GHS ${formatAccountAmount(formSetup.simplifiedKyc.maxBalanceGhs)}.`
                  : ""}{" "}
                Loans and investments stay locked until upgraded to Full KYC.
              </p>
              <div className="agent-form__grid">
                <label className="field">
                  <span>Nationality / country of origin</span>
                  <select
                    value={
                      customNationalityMode
                        ? "__other__"
                        : NATIONALITY_OPTION_SET.has(form.nationality)
                          ? form.nationality
                          : ""
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === "__other__") {
                        setCustomNationalityMode(true);
                        updateField("nationality", "");
                      } else {
                        setCustomNationalityMode(false);
                        updateField("nationality", val);
                      }
                    }}
                    required={!customNationalityMode}
                  >
                    <option value="">Select nationality…</option>
                    <optgroup label="West Africa (ECOWAS & neighbours)">
                      {NATIONALITY_OPTIONS.slice(0, 17).map((nat) => (
                        <option key={nat} value={nat}>
                          {nat}
                        </option>
                      ))}
                    </optgroup>
                    <optgroup label="Other countries">
                      {NATIONALITY_OPTIONS.slice(17).map((nat) => (
                        <option key={nat} value={nat}>
                          {nat}
                        </option>
                      ))}
                    </optgroup>
                    <option value="__other__">Other (specify)…</option>
                  </select>
                </label>
                {customNationalityMode ? (
                  <label className="field">
                    <span>Specify nationality</span>
                    <input
                      value={form.nationality}
                      onChange={(e) => updateField("nationality", e.target.value)}
                      placeholder="Enter nationality"
                      required
                    />
                  </label>
                ) : null}
                <label className="field">
                  <span>Local introducer full name</span>
                  <input
                    value={form.introducerName}
                    onChange={(e) => updateField("introducerName", e.target.value)}
                    placeholder="e.g. Kwame Boateng"
                    required
                  />
                </label>
                <label className="field">
                  <span>Introducer phone number</span>
                  <input
                    type="tel"
                    inputMode="tel"
                    value={form.introducerPhone}
                    onChange={(e) => updateField("introducerPhone", e.target.value)}
                    placeholder="e.g. 0241234567"
                    required
                  />
                </label>
                <label className="field">
                  <span>Relationship to customer</span>
                  <input
                    value={form.introducerRelationship}
                    onChange={(e) => updateField("introducerRelationship", e.target.value)}
                    placeholder="e.g. Landlord, Employer, Market Leader"
                    required
                  />
                </label>
                <label className="field agent-form__span-2">
                  <span>Introducer Ghana Card number</span>
                  <input
                    value={form.introducerGhanaCard}
                    onChange={(e) => updateField("introducerGhanaCard", e.target.value)}
                    placeholder="e.g. GHA-123456789-0"
                    required
                  />
                </label>
              </div>
            </div>
          ) : null}

          <div className="agent-form__photos">
            {form.idCardType !== "no_id_simplified_kyc" && formSetup.fields.idCardPhoto !== "hidden" ? (
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

            {form.idCardType === "no_id_simplified_kyc" || formSetup.fields.customerPhoto !== "hidden" ? (
            <AgentPhotoField
              label={
                form.idCardType === "no_id_simplified_kyc"
                  ? "Customer face photo (required for Simplified KYC)"
                  : "Customer photo"
              }
              hint={
                form.idCardType === "no_id_simplified_kyc"
                  ? "Required for face verification on withdrawals."
                  : "Face photo of the customer for the account file."
              }
              captureGuide="Center the customer's face in the frame"
              facingMode="user"
              photoUrl={photoUrl}
              photoName={photoName}
              onPhotoChange={(url, name) => {
                setPhotoUrl(url);
                setPhotoName(name);
              }}
              required={
                form.idCardType === "no_id_simplified_kyc" ||
                formSetup.fields.customerPhoto === "required"
              }
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

        {showDailyContribution ? (
        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Contribution plan</h3>
          <div className="agent-form__grid agent-form__grid--center">
            <label className="field agent-form__field--amount">
              <span>
                {form.accountType === "susu" ? "Daily savings amount (GHS)" : "Daily contribution (GHS)"}
                {formSetup.fields.dailyContribution !== "required" ? " (optional)" : ""}
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
                placeholder={formatAccountAmount((activeForm?.defaultDailyContributionGhs ?? 0))}
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
            {submitting
              ? isEditMode
                ? "Resubmitting…"
                : "Submitting…"
              : isEditMode
                ? "Resubmit for approval"
                : "Confirm and submit"}
          </button>
        </>
      }
    >
      <RegistrationPreview
        form={form}
        isOffice={isOffice}
        isSavings={isSavings}
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
