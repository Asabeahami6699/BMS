import type { BankProductFieldType, BankProductWorkflowField, BankProductWorkflowStage } from "@bms/shared";
import {
  BANK_PRODUCT_WORKFLOW_STAGE_LABELS,
  defaultWorkflowFieldsForDirection,
  type BankProductDirection
} from "@bms/shared";

const FIELD_TYPES: BankProductFieldType[] = [
  "text",
  "number",
  "phone",
  "email",
  "date",
  "select",
  "textarea",
  "checkbox"
];

const STAGES: BankProductWorkflowStage[] = [
  "capture",
  "verification",
  "execution",
  "account_opening"
];

type Props = {
  direction: BankProductDirection | "both" | "account_opening";
  fields: BankProductWorkflowField[];
  onChange: (fields: BankProductWorkflowField[]) => void;
};

function emptyField(sortOrder: number): BankProductWorkflowField {
  return {
    key: `field_${sortOrder + 1}`,
    label: "New field",
    type: "text",
    required: false,
    stages: ["verification"],
    sortOrder
  };
}

export function WorkflowFieldsEditor({ direction, fields, onChange }: Props) {
  const previewDirection: BankProductDirection =
    direction === "both" ? "withdrawal" : direction === "account_opening" ? "account_opening" : direction;

  function updateField(index: number, patch: Partial<BankProductWorkflowField>) {
    onChange(fields.map((field, i) => (i === index ? { ...field, ...patch } : field)));
  }

  function removeField(index: number) {
    onChange(fields.filter((_, i) => i !== index));
  }

  function loadDefaults() {
    onChange(defaultWorkflowFieldsForDirection(previewDirection));
  }

  return (
    <section className="card workflow-fields-editor">
      <header className="workflow-fields-editor__head">
        <div>
          <h3>Workflow fields</h3>
          <p className="muted">
            Configure the inputs staff must complete for this bank product. Leave empty to use
            platform defaults per product type.
          </p>
        </div>
        <div className="workflow-fields-editor__actions">
          <button type="button" className="button secondary" onClick={loadDefaults}>
            Load standard fields
          </button>
          <button
            type="button"
            className="button secondary"
            onClick={() => onChange([...fields, emptyField(fields.length)])}
          >
            Add field
          </button>
        </div>
      </header>

      {fields.length === 0 ? (
        <p className="muted">No custom fields — standard agency banking defaults will apply.</p>
      ) : (
        <div className="workflow-fields-editor__list">
          {fields.map((field, index) => (
            <article key={`${field.key}-${index}`} className="workflow-fields-editor__row">
              <label className="field">
                <span>Label</span>
                <input
                  value={field.label}
                  onChange={(e) => updateField(index, { label: e.target.value })}
                />
              </label>
              <label className="field">
                <span>Key</span>
                <input
                  value={field.key}
                  onChange={(e) =>
                    updateField(index, {
                      key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, "")
                    })
                  }
                />
              </label>
              <label className="field">
                <span>Type</span>
                <select
                  value={field.type}
                  onChange={(e) =>
                    updateField(index, { type: e.target.value as BankProductFieldType })
                  }
                >
                  {FIELD_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field workflow-form__checkbox">
                <input
                  type="checkbox"
                  checked={field.required}
                  onChange={(e) => updateField(index, { required: e.target.checked })}
                />
                <span>Required</span>
              </label>
              <fieldset className="workflow-fields-editor__stages">
                <legend className="muted">Shown at stage</legend>
                {STAGES.map((stage) => (
                  <label key={stage} className="workflow-form__checkbox">
                    <input
                      type="checkbox"
                      checked={field.stages.includes(stage)}
                      onChange={(e) => {
                        const next = e.target.checked
                          ? [...new Set([...field.stages, stage])]
                          : field.stages.filter((s) => s !== stage);
                        updateField(index, { stages: next.length ? next : [stage] });
                      }}
                    />
                    <span>{BANK_PRODUCT_WORKFLOW_STAGE_LABELS[stage]}</span>
                  </label>
                ))}
              </fieldset>
              {field.type === "select" ? (
                <label className="field workflow-fields-editor__options">
                  <span>Options (comma-separated)</span>
                  <input
                    value={(field.options ?? []).join(", ")}
                    onChange={(e) =>
                      updateField(index, {
                        options: e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter(Boolean)
                      })
                    }
                  />
                </label>
              ) : null}
              <button
                type="button"
                className="button secondary workflow-fields-editor__remove"
                onClick={() => removeField(index)}
              >
                Remove
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
