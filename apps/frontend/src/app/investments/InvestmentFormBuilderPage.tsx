import { useState } from "react";
import type { InvestmentFormField, InvestmentFormFieldType } from "@bms/shared";
import type { AppRole } from "../api";
import { updateInvestmentFormConfig } from "../api";
import { useToast } from "../../components/Toast";
import { useInvestmentStore } from "../stores/investmentStore";
import { InvestmentsLayout } from "./InvestmentsLayout";

type Props = { role: AppRole };

const FIELD_TYPES: InvestmentFormFieldType[] = [
  "text",
  "number",
  "date",
  "dropdown",
  "checkbox",
  "radio",
  "file",
  "signature",
  "textarea",
  "phone",
  "email"
];

function newId(): string {
  return `fld_${crypto.randomUUID().slice(0, 8)}`;
}

export function InvestmentFormBuilderPage({ role: _role }: Props) {
  const formConfig = useInvestmentStore((s) => s.formConfig);
  const setFormConfig = useInvestmentStore((s) => s.setFormConfig);
  const { showToast } = useToast();
  const [saving, setSaving] = useState(false);
  const [newSectionTitle, setNewSectionTitle] = useState("");

  if (!formConfig) {
    return (
      <InvestmentsLayout activeNav="formBuilder" title="Form builder">
        <p className="muted">Loading…</p>
      </InvestmentsLayout>
    );
  }

  const config = formConfig;

  function updateField(fieldId: string, patch: Partial<InvestmentFormField>) {
    setFormConfig({
      ...config,
      fields: config.fields.map((f) => (f.id === fieldId ? { ...f, ...patch } : f))
    });
  }

  function removeField(fieldId: string) {
    const field = config.fields.find((f) => f.id === fieldId);
    if (field?.isStandard) {
      updateField(fieldId, { requirement: "hidden" });
      return;
    }
    setFormConfig({
      ...config,
      fields: config.fields.filter((f) => f.id !== fieldId)
    });
  }

  function addCustomField(sectionId: string) {
    const field: InvestmentFormField = {
      id: newId(),
      key: `custom_${Date.now()}`,
      label: "Custom field",
      type: "text",
      sectionId,
      requirement: "optional",
      sortOrder: config.fields.filter((f) => f.sectionId === sectionId).length,
      isStandard: false
    };
    setFormConfig({ ...config, fields: [...config.fields, field] });
  }

  function addSection() {
    if (!newSectionTitle.trim()) {
      return;
    }
    const section = {
      id: `sec_${Date.now()}`,
      title: newSectionTitle.trim(),
      sortOrder: config.sections.length,
      isStandard: false,
      collapsible: true
    };
    setFormConfig({
      ...config,
      sections: [...config.sections, section]
    });
    setNewSectionTitle("");
  }

  function moveField(fieldId: string, direction: -1 | 1) {
    const fields = [...config.fields];
    const index = fields.findIndex((f) => f.id === fieldId);
    if (index < 0) return;
    const swapIndex = index + direction;
    if (swapIndex < 0 || swapIndex >= fields.length) return;
    const current = fields[index];
    const swap = fields[swapIndex];
    fields[index] = { ...swap, sortOrder: current.sortOrder };
    fields[swapIndex] = { ...current, sortOrder: swap.sortOrder };
    setFormConfig({ ...config, fields });
  }

  async function save() {
    setSaving(true);
    try {
      const saved = await updateInvestmentFormConfig({
        sections: config.sections,
        fields: config.fields
      });
      setFormConfig(saved);
      showToast("Form configuration saved", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save form", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <InvestmentsLayout
      activeNav="formBuilder"
      title="Application form builder"
      subtitle="Customize fields per company without affecting other tenants."
      actions={
        <button type="button" className="button primary" disabled={saving} onClick={() => void save()}>
          {saving ? "Saving…" : "Save configuration"}
        </button>
      }
    >
      <div className="card stack-form">
        <h3>Add custom section</h3>
        <label className="field">
          <span>Section title</span>
          <input value={newSectionTitle} onChange={(e) => setNewSectionTitle(e.target.value)} />
        </label>
        <button type="button" className="button secondary" onClick={addSection}>
          Add section
        </button>
      </div>
      {config.sections.map((section) => (
        <section key={section.id} className="card investment-form-builder__section">
          <div className="admin-mgmt-head">
            <h3>{section.title}</h3>
            <button type="button" className="button secondary" onClick={() => addCustomField(section.id)}>
              + Add field
            </button>
          </div>
          {config.fields
            .filter((f) => f.sectionId === section.id)
            .sort((a, b) => a.sortOrder - b.sortOrder)
            .map((field) => (
              <div key={field.id} className="investment-form-builder__row">
                <input
                  value={field.label}
                  disabled={field.isStandard && field.key === "investmentNumber"}
                  onChange={(e) => updateField(field.id, { label: e.target.value })}
                />
                <select
                  value={field.type}
                  disabled={field.isStandard}
                  onChange={(e) => updateField(field.id, { type: e.target.value as InvestmentFormFieldType })}
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
                <select
                  value={field.requirement}
                  onChange={(e) =>
                    updateField(field.id, {
                      requirement: e.target.value as InvestmentFormField["requirement"]
                    })
                  }
                >
                  <option value="required">Required</option>
                  <option value="optional">Optional</option>
                  <option value="hidden">Hidden</option>
                </select>
                <button type="button" className="button secondary" onClick={() => moveField(field.id, -1)}>
                  ↑
                </button>
                <button type="button" className="button secondary" onClick={() => moveField(field.id, 1)}>
                  ↓
                </button>
                <button type="button" className="button secondary" onClick={() => removeField(field.id)}>
                  {field.isStandard ? "Hide" : "Remove"}
                </button>
              </div>
            ))}
        </section>
      ))}
    </InvestmentsLayout>
  );
}
