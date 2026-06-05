import { FormEvent, useEffect, useState } from "react";
import type { TenantProductModule } from "@bms/shared";
import type { TenantRecord } from "../api";
import { MODULE_LABELS } from "@bms/shared";
import { updateTenantModules } from "../api";
import { ProductModulePicker } from "../../components/ProductModulePicker";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";

type Props = {
  open: boolean;
  tenant: TenantRecord | null;
  onClose: () => void;
  onUpdated: () => void;
};

export function EditTenantModulesModal({ open, tenant, onClose, onUpdated }: Props) {
  const { showToast } = useToast();
  const [selected, setSelected] = useState<TenantProductModule[]>([]);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open && tenant) {
      setSelected(tenant.subscribedModules ?? []);
    }
  }, [open, tenant]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!tenant) {
      return;
    }
    setSubmitting(true);
    try {
      await updateTenantModules(tenant.id, selected);
      showToast(`Products updated for ${tenant.name}`, "success");
      onUpdated();
      onClose();
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update products", "error");
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
      title={`Product subscription — ${tenant.name}`}
      subtitle="Choose which modules appear on this company's admin sidebar."
      onClose={onClose}
    >
      <form className="stack-form" onSubmit={handleSubmit}>
        <ProductModulePicker selected={selected} onChange={setSelected} disabled={submitting} />
        <p className="muted">
          Current: {tenant.subscribedModules.map((m) => MODULE_LABELS[m]).join(", ")}
        </p>
        <button type="submit" className="button" disabled={submitting}>
          {submitting ? "Saving..." : "Save products"}
        </button>
      </form>
    </Modal>
  );
}
