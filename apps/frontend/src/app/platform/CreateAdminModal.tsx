import { FormEvent, useEffect, useState } from "react";
import type { TenantRecord } from "../api";
import { createTenantAdmin } from "../api";
import { CredentialsSharePanel } from "../../components/CredentialsSharePanel";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";

type Props = {
  open: boolean;
  onClose: () => void;
  tenants: TenantRecord[];
  defaultTenantId?: string;
  onCreated: () => void;
};

export function CreateAdminModal({ open, onClose, tenants, defaultTenantId, onCreated }: Props) {
  const { showToast } = useToast();
  const [step, setStep] = useState<"form" | "success">("form");
  const [submitting, setSubmitting] = useState(false);

  const [adminTenantId, setAdminTenantId] = useState(defaultTenantId ?? "");
  const [adminEmail, setAdminEmail] = useState("admin@acme.com");
  const [adminPassword, setAdminPassword] = useState("ChangeMe123!");
  const [adminFullName, setAdminFullName] = useState("Acme Company Admin");

  useEffect(() => {
    if (open && defaultTenantId) {
      setAdminTenantId(defaultTenantId);
    }
  }, [open, defaultTenantId]);

  const [savedCredentials, setSavedCredentials] = useState<{
    companyName: string;
    companyId: string;
    fullName: string;
    email: string;
    password: string;
  } | null>(null);

  function handleClose() {
    setStep("form");
    setSavedCredentials(null);
    onClose();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!adminTenantId) {
      showToast("Select a company first", "error");
      return;
    }
    const tenant = tenants.find((t) => t.id === adminTenantId);
    setSubmitting(true);
    try {
      await createTenantAdmin(adminTenantId, {
        email: adminEmail,
        password: adminPassword,
        fullName: adminFullName
      });
      setSavedCredentials({
        companyName: tenant?.name ?? adminTenantId,
        companyId: adminTenantId,
        fullName: adminFullName,
        email: adminEmail,
        password: adminPassword
      });
      setStep("success");
      onCreated();
      showToast(`Company admin created for ${tenant?.name ?? adminTenantId}`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to create company admin", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal
      open={open}
      title={step === "form" ? "Create company admin" : "Admin account created"}
      subtitle={
        step === "form"
          ? "Company admins manage branches, users, and policies."
          : "Share login credentials securely with the company contact."
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
            <span>Company</span>
            <select value={adminTenantId} onChange={(e) => setAdminTenantId(e.target.value)} required>
              <option value="">Select company</option>
              {tenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.id})
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Full Name</span>
            <input value={adminFullName} onChange={(e) => setAdminFullName(e.target.value)} required />
          </label>
          <label className="field">
            <span>Email (login)</span>
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="text"
              autoComplete="new-password"
              value={adminPassword}
              onChange={(e) => setAdminPassword(e.target.value)}
              required
            />
          </label>
          <button type="submit" className="button" disabled={submitting}>
            {submitting ? "Creating..." : "Create company admin"}
          </button>
        </form>
      ) : savedCredentials ? (
        <CredentialsSharePanel
          title="Login credentials for company admin"
          shareTitle={`BMS — ${savedCredentials.companyName} admin access`}
          fields={[
            { label: "Company", value: savedCredentials.companyName },
            { label: "Company ID", value: savedCredentials.companyId },
            { label: "Admin name", value: savedCredentials.fullName },
            { label: "Email", value: savedCredentials.email },
            { label: "Password", value: savedCredentials.password, secret: true }
          ]}
        />
      ) : null}
    </Modal>
  );
}
