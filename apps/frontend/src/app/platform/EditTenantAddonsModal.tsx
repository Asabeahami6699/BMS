import { FormEvent, useEffect, useState } from "react";
import type { TenantRecord } from "../api";
import type { TenantAddon } from "@bms/shared";
import { ADDON_LABELS } from "@bms/shared";
import { updateTenantAddons } from "../api";
import { AddonPicker } from "../../components/AddonPicker";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";

type Props = {
  open: boolean;
  tenant: TenantRecord | null;
  onClose: () => void;
  onUpdated: () => void;
};

export function EditTenantAddonsModal({ open, tenant, onClose, onUpdated }: Props) {
  const { showToast } = useToast();
  const [selected, setSelected] = useState<TenantAddon[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && tenant) {
      setSelected(tenant.subscribedAddons ?? []);
    }
  }, [open, tenant]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!tenant) {
      return;
    }
    setSubmitting(true);
    try {
      await updateTenantAddons(tenant.id, selected);
      showToast(`Add-ons updated for ${tenant.name}`, "success");
      onUpdated();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update add-ons", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!tenant) {
    return null;
  }

  return (
    <Modal
      open={open}
      title={`Add-ons — ${tenant.name}`}
      subtitle="Assign premium add-ons. Company admins can only configure add-ons you enable here."
      onClose={onClose}
    >
      <form className="stack-form" onSubmit={handleSubmit}>
        <AddonPicker selected={selected} onChange={setSelected} disabled={submitting} />
        <p className="muted">
          Current: {(tenant.subscribedAddons ?? []).map((a) => ADDON_LABELS[a]).join(", ") || "None"}
        </p>
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? "Saving..." : "Save add-ons"}
        </button>
      </form>
    </Modal>
  );
}
