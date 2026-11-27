import {
  CUSTOMER_ID_CARD_TYPE_OPTIONS,
  type CustomerIdCardType,
  type UpdateCustomerDetailsInput
} from "@bms/shared";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthContext";
import { AgentPhotoField } from "../agent/components/AgentPhotoField";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { compressImageDataUrl, isDataUrlWithinLimit } from "../lib/imageCompress";
import { toUserFacingError } from "../lib/networkError";
import type { Branch, Customer } from "./api";
import { updateCustomerDetails } from "./api";
import { useAgentsStore } from "./stores/agentsStore";
import { useCustomerLedgerStore } from "./stores/customerLedgerStore";
import { useCustomersStore } from "./stores/customersStore";

type Props = {
  open: boolean;
  customer: Customer | null;
  branches: Branch[];
  onClose: () => void;
  onUpdated?: (customer: Customer) => void;
};

type EditFormState = {
  fullName: string;
  phone: string;
  email: string;
  location: string;
  houseNumber: string;
  dateOfBirth: string;
  occupation: string;
  nationality: string;
  idCardType: CustomerIdCardType;
  idCardNumber: string;
  kinName: string;
  kinPhone: string;
  kinLocation: string;
  kinHouseNumber: string;
  homeBranchId: string;
  assignedFieldAgentId: string;
};

function formFromCustomer(c: Customer): EditFormState {
  return {
    fullName: c.fullName ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    location: c.location ?? "",
    houseNumber: c.houseNumber ?? "",
    dateOfBirth: c.dateOfBirth ?? "",
    occupation: c.occupation ?? "",
    nationality: c.nationality ?? "",
    idCardType: (c.idCardType ?? "ghana_card") as CustomerIdCardType,
    idCardNumber: c.idCardNumber ?? "",
    kinName: c.nextOfKin?.fullName ?? "",
    kinPhone: c.nextOfKin?.phone ?? "",
    kinLocation: c.nextOfKin?.location ?? "",
    kinHouseNumber: c.nextOfKin?.houseNumber ?? "",
    homeBranchId: c.homeBranchId ?? "",
    assignedFieldAgentId: c.assignedFieldAgentId ?? ""
  };
}

export function EditCustomerModal({ open, customer, branches, onClose, onUpdated }: Props) {
  const { showToast } = useToast();
  const { user } = useAuth();
  const isBranchScoped = user?.scopeType === "branch" && Boolean(user.branchId);

  const cachedDetail = useCustomerLedgerStore((s) =>
    customer ? s.detailByCustomer[customer.id] : undefined
  );
  const agentsRoster = useAgentsStore((s) => s.roster);

  const sourceCustomer = cachedDetail ?? customer;

  const [form, setForm] = useState<EditFormState>(() =>
    sourceCustomer ? formFromCustomer(sourceCustomer) : formFromCustomer({} as Customer)
  );
  const [photoUrl, setPhotoUrl] = useState<string | undefined>(sourceCustomer?.photoUrl);
  const [photoName, setPhotoName] = useState<string | undefined>();
  const [photoDirty, setPhotoDirty] = useState(false);
  const [idCardPhotoUrl, setIdCardPhotoUrl] = useState<string | undefined>(
    sourceCustomer?.idCardPhotoUrl
  );
  const [idCardPhotoName, setIdCardPhotoName] = useState<string | undefined>();
  const [idCardPhotoDirty, setIdCardPhotoDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  // Hydrate full customer detail (including photos) and agents catalog from Zustand stores
  useEffect(() => {
    if (!open || !customer) {
      return;
    }
    void useCustomerLedgerStore.getState().ensureDetail(customer.id);
    useAgentsStore.getState().hydrate();
  }, [open, customer]);

  // Reset form when opening for a customer
  useEffect(() => {
    if (!open || !customer) {
      return;
    }
    const base = useCustomerLedgerStore.getState().detailByCustomer[customer.id] ?? customer;
    setForm(formFromCustomer(base));
    setPhotoUrl(base.photoUrl);
    setPhotoName(undefined);
    setPhotoDirty(false);
    setIdCardPhotoUrl(base.idCardPhotoUrl);
    setIdCardPhotoName(undefined);
    setIdCardPhotoDirty(false);
  }, [open, customer?.id]);

  // Sync photos once full detail finishes hydrating if user hasn't touched photos yet
  useEffect(() => {
    if (!open || !cachedDetail) {
      return;
    }
    if (!photoDirty && cachedDetail.photoUrl && !photoUrl) {
      setPhotoUrl(cachedDetail.photoUrl);
    }
    if (!idCardPhotoDirty && cachedDetail.idCardPhotoUrl && !idCardPhotoUrl) {
      setIdCardPhotoUrl(cachedDetail.idCardPhotoUrl);
    }
  }, [open, cachedDetail, photoDirty, photoUrl, idCardPhotoDirty, idCardPhotoUrl]);

  const activeBranches = useMemo(
    () => branches.filter((b) => b.status !== "inactive"),
    [branches]
  );

  const agentsForBranch = useMemo(() => {
    const active = agentsRoster.filter((a) => a.status === "active");
    if (!form.homeBranchId) {
      return active;
    }
    const matching = active.filter((a) => !a.branchId || a.branchId === form.homeBranchId);
    return matching.length > 0 ? matching : active;
  }, [agentsRoster, form.homeBranchId]);

  function updateField<K extends keyof EditFormState>(key: K, value: EditFormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  async function preparePhoto(url?: string): Promise<string | undefined> {
    if (!url) {
      return undefined;
    }
    if (isDataUrlWithinLimit(url)) {
      return url;
    }
    return compressImageDataUrl(url);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!customer) {
      return;
    }
    if (!form.fullName.trim()) {
      showToast("Full name is required.", "error");
      return;
    }
    if (!form.phone.trim()) {
      showToast("Phone number is required.", "error");
      return;
    }
    if (!form.location.trim()) {
      showToast("Location is required.", "error");
      return;
    }
    const kinStarted = Boolean(
      form.kinName.trim() || form.kinPhone.trim() || form.kinLocation.trim() || form.kinHouseNumber.trim()
    );
    if (kinStarted && (!form.kinName.trim() || !form.kinPhone.trim() || !form.kinLocation.trim())) {
      showToast("Complete next of kin name, phone, and location (or leave all blank).", "error");
      return;
    }

    setSaving(true);
    try {
      const payload: UpdateCustomerDetailsInput = {
        fullName: form.fullName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim() || null,
        location: form.location.trim(),
        houseNumber: form.houseNumber.trim() || null,
        dateOfBirth: form.dateOfBirth.trim() || null,
        occupation: form.occupation.trim() || null,
        nationality: form.nationality.trim() || null,
        idCardType: form.idCardType,
        idCardNumber:
          form.idCardType === "no_id_simplified_kyc" ? null : form.idCardNumber.trim() || null,
        nextOfKin: kinStarted
          ? {
              fullName: form.kinName.trim(),
              phone: form.kinPhone.trim(),
              location: form.kinLocation.trim(),
              houseNumber: form.kinHouseNumber.trim() || undefined
            }
          : null,
        ...(!isBranchScoped && form.homeBranchId ? { homeBranchId: form.homeBranchId } : {}),
        assignedFieldAgentId: form.assignedFieldAgentId.trim() || null
      };

      if (photoDirty) {
        payload.photoUrl = photoUrl ? ((await preparePhoto(photoUrl)) ?? null) : null;
      }
      if (idCardPhotoDirty) {
        payload.idCardPhotoUrl = idCardPhotoUrl
          ? ((await preparePhoto(idCardPhotoUrl)) ?? null)
          : null;
      }

      const updated = await updateCustomerDetails(customer.id, payload);
      useCustomersStore.getState().upsertCustomer(updated);
      void useCustomersStore.getState().refreshSilent();
      useCustomerLedgerStore.getState().invalidate(updated.id);
      void useCustomerLedgerStore.getState().ensureDetail(updated.id, { force: true });

      showToast(`Updated ${updated.fullName}`, "success");
      onUpdated?.(updated);
      onClose();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not update customer details"), "error");
    } finally {
      setSaving(false);
    }
  }

  if (!customer) {
    return null;
  }

  const subtitle = [
    customer.accountNumber ? `Acct ${customer.accountNumber}` : "Pending account #",
    customer.accountType?.replace(/_/g, " "),
    customer.status.replace(/_/g, " ")
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Modal
      open={open}
      title={`Update customer — ${customer.fullName}`}
      subtitle={subtitle}
      onClose={() => {
        if (!saving) {
          onClose();
        }
      }}
      panelClassName="modal-panel--70 modal-panel--registration"
      footer={
        <>
          <button type="button" className="button secondary" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button
            type="submit"
            form="edit-customer-form"
            className="button"
            disabled={saving}
          >
            {saving ? "Saving…" : "Save changes"}
          </button>
        </>
      }
    >
      <form id="edit-customer-form" onSubmit={(e) => void handleSubmit(e)} className="agent-form">
        <p className="muted" style={{ margin: "0 0 0.75rem", fontSize: "0.85rem" }}>
          Account number, account type, and balances are locked for audit safety. All profile
          changes are recorded in the immutable audit trail.
        </p>

        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Personal details</h3>
          <div className="agent-form__grid">
            <label className="field agent-form__span-2">
              <span>Full name *</span>
              <input
                value={form.fullName}
                onChange={(e) => updateField("fullName", e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Phone *</span>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>Email</span>
              <input
                type="email"
                value={form.email}
                onChange={(e) => updateField("email", e.target.value)}
                placeholder="Optional"
              />
            </label>

            <label className="field">
              <span>Location *</span>
              <input
                value={form.location}
                onChange={(e) => updateField("location", e.target.value)}
                required
              />
            </label>

            <label className="field">
              <span>House number / digital address</span>
              <input
                value={form.houseNumber}
                onChange={(e) => updateField("houseNumber", e.target.value)}
              />
            </label>

            <label className="field">
              <span>Date of birth</span>
              <input
                type="date"
                value={form.dateOfBirth}
                onChange={(e) => updateField("dateOfBirth", e.target.value)}
              />
            </label>

            <label className="field">
              <span>Occupation</span>
              <input
                value={form.occupation}
                onChange={(e) => updateField("occupation", e.target.value)}
              />
            </label>

            <label className="field">
              <span>Nationality</span>
              <input
                value={form.nationality}
                onChange={(e) => updateField("nationality", e.target.value)}
                placeholder="e.g. Ghanaian"
              />
            </label>
          </div>
        </section>

        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Identity &amp; KYC</h3>
          <div className="agent-form__grid">
            <label className="field">
              <span>ID card type</span>
              <select
                value={form.idCardType}
                onChange={(e) => updateField("idCardType", e.target.value as CustomerIdCardType)}
              >
                {CUSTOMER_ID_CARD_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>

            {form.idCardType !== "no_id_simplified_kyc" ? (
              <label className="field">
                <span>ID card number</span>
                <input
                  value={form.idCardNumber}
                  onChange={(e) => updateField("idCardNumber", e.target.value)}
                />
              </label>
            ) : null}

            <div className="agent-form__span-2">
              <AgentPhotoField
                label="Customer photo"
                hint="Optional — upload a new photo to replace the existing one."
                photoUrl={photoUrl}
                photoName={photoName}
                onPhotoChange={(nextUrl, nextName) => {
                  setPhotoUrl(nextUrl);
                  setPhotoName(nextName);
                  setPhotoDirty(true);
                }}
              />
            </div>

            {form.idCardType !== "no_id_simplified_kyc" ? (
              <div className="agent-form__span-2">
                <AgentPhotoField
                  label="ID card photo"
                  hint="Optional — upload a new ID card photo to replace the existing one."
                  photoUrl={idCardPhotoUrl}
                  photoName={idCardPhotoName}
                  onPhotoChange={(nextUrl, nextName) => {
                    setIdCardPhotoUrl(nextUrl);
                    setIdCardPhotoName(nextName);
                    setIdCardPhotoDirty(true);
                  }}
                />
              </div>
            ) : null}
          </div>
        </section>

        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Next of kin</h3>
          <div className="agent-form__grid">
            <label className="field">
              <span>Next of kin name</span>
              <input
                value={form.kinName}
                onChange={(e) => updateField("kinName", e.target.value)}
              />
            </label>

            <label className="field">
              <span>Next of kin phone</span>
              <input
                type="tel"
                value={form.kinPhone}
                onChange={(e) => updateField("kinPhone", e.target.value)}
              />
            </label>

            <label className="field">
              <span>Next of kin location</span>
              <input
                value={form.kinLocation}
                onChange={(e) => updateField("kinLocation", e.target.value)}
              />
            </label>

            <label className="field">
              <span>Next of kin house number</span>
              <input
                value={form.kinHouseNumber}
                onChange={(e) => updateField("kinHouseNumber", e.target.value)}
              />
            </label>
          </div>
        </section>

        <section className="agent-form__section">
          <h3 className="agent-form__section-title">Branch &amp; servicing</h3>
          <div className="agent-form__grid">
            <label className="field">
              <span>Home branch</span>
              <select
                value={form.homeBranchId}
                disabled={isBranchScoped}
                onChange={(e) => updateField("homeBranchId", e.target.value)}
              >
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
                value={form.assignedFieldAgentId}
                onChange={(e) => updateField("assignedFieldAgentId", e.target.value)}
              >
                <option value="">Unassigned</option>
                {agentsForBranch.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.displayName || a.fullName || a.email || a.userId}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      </form>
    </Modal>
  );
}
