import { FormEvent, useState } from "react";
import type { TenantAddon, TenantProductModule } from "@bms/shared";
import { ADDON_LABELS, MODULE_LABELS } from "@bms/shared";
import type { TenantRecord } from "../api";
import { createPlatformTenant } from "../api";
import { AddonPicker } from "../../components/AddonPicker";
import { CredentialsSharePanel } from "../../components/CredentialsSharePanel";
import { Modal } from "../../components/Modal";
import { ProductModulePicker } from "../../components/ProductModulePicker";
import { useToast } from "../../components/Toast";

type Props = {
  open: boolean;
  onClose: () => void;
  onCreated: (tenant: TenantRecord) => void;
};

const DEFAULT_MODULES: TenantProductModule[] = ["banking", "susu_management"];

export function RegisterCompanyModal({ open, onClose, onCreated }: Props) {
  const { showToast } = useToast();
  const [step, setStep] = useState<"form" | "success">("form");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<TenantRecord | null>(null);

  const [tenantId, setTenantId] = useState("tenant-acme");
  const [tenantName, setTenantName] = useState("Acme Cooperative");
  const [subscriptionStatus, setSubscriptionStatus] = useState<"active" | "inactive">("active");
  const [subscribedModules, setSubscribedModules] = useState<TenantProductModule[]>(DEFAULT_MODULES);
  const [subscribedAddons, setSubscribedAddons] = useState<TenantAddon[]>([]);

  function handleClose() {
    setStep("form");
    setCreated(null);
    setSubscribedModules(DEFAULT_MODULES);
    setSubscribedAddons([]);
    onClose();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    try {
      const tenant = await createPlatformTenant({
        id: tenantId,
        name: tenantName,
        subscriptionStatus,
        subscribedModules,
        subscribedAddons
      });
      setCreated(tenant);
      setStep("success");
      onCreated(tenant);
      showToast(`Company "${tenant.name}" registered successfully`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to register company", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={step === "form" ? "Register company" : "Company registered"}
      subtitle={
        step === "form"
          ? "Onboard a new cooperative or MFI tenant on BMS."
          : "Copy and share these details with the company."
      }
      onClose={handleClose}
      footer={
        step === "success" ? (
          <button type="button" className="button" onClick={handleClose}>
            Done
          </button>
        ) : undefined
      }
    >
      {step === "form" ? (
        <form className="stack-form" onSubmit={handleSubmit}>
          <label className="field">
            <span>Company ID</span>
            <input value={tenantId} onChange={(e) => setTenantId(e.target.value)} required />
          </label>
          <label className="field">
            <span>Company Name</span>
            <input value={tenantName} onChange={(e) => setTenantName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Subscription</span>
            <select
              value={subscriptionStatus}
              onChange={(e) => setSubscriptionStatus(e.target.value as "active" | "inactive")}
            >
              <option value="active">active</option>
              <option value="inactive">inactive</option>
            </select>
          </label>
          <fieldset className="field">
            <span>Product modules</span>
            <ProductModulePicker
              selected={subscribedModules}
              onChange={setSubscribedModules}
              disabled={submitting}
            />
          </fieldset>
          <fieldset className="field">
            <span>Add-ons (optional)</span>
            <AddonPicker selected={subscribedAddons} onChange={setSubscribedAddons} disabled={submitting} />
          </fieldset>
          <button type="submit" className="button" disabled={submitting}>
            {submitting ? "Registering..." : "Register company"}
          </button>
        </form>
      ) : created ? (
        <CredentialsSharePanel
          title="Company registration details"
          shareTitle={`BMS — ${created.name} registered`}
          fields={[
            { label: "Company name", value: created.name },
            { label: "Company ID", value: created.id },
            { label: "Subscription", value: created.subscriptionStatus },
            {
              label: "Products",
              value: (created.subscribedModules ?? []).map((m) => MODULE_LABELS[m]).join(", ")
            },
            {
              label: "Add-ons",
              value: (created.subscribedAddons ?? []).map((a) => ADDON_LABELS[a]).join(", ") || "None"
            },
            { label: "Reports & Analysis", value: created.subscriptionStatus === "active" ? "Included" : "When active" }
          ]}
        />
      ) : null}
    </Modal>
  );
}
