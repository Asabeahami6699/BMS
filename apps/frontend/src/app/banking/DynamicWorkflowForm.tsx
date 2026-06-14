import type { BankProductWorkflowField } from "@bms/shared";
import { applyWorkflowAutoFields, formatGhanaCardInput } from "@bms/shared";

type Props = {
  fields: BankProductWorkflowField[];
  values: Record<string, unknown>;
  disabled?: boolean;
  onChange: (key: string, value: unknown) => void;
};

function withAutoFields(
  fields: BankProductWorkflowField[],
  values: Record<string, unknown>,
  key: string,
  value: unknown
): Record<string, unknown> {
  return applyWorkflowAutoFields(fields, { ...values, [key]: value });
}

export function DynamicWorkflowForm({ fields, values, disabled, onChange }: Props) {
  if (fields.length === 0) {
    return <p className="muted">No extra fields configured for this bank product.</p>;
  }

  function handleChange(key: string, value: unknown) {
    onChange(key, value);
    const derived = fields.filter((field) => field.autoFrom === key);
    if (derived.length === 0) {
      return;
    }
    const next = withAutoFields(fields, values, key, value);
    for (const field of derived) {
      if (next[field.key] !== values[field.key]) {
        onChange(field.key, next[field.key]);
      }
    }
  }

  return (
    <div className="workflow-form">
      {fields.map((field) => {
        const value = values[field.key];
        const id = `workflow-${field.key}`;
        const isReadOnly = field.readOnly === true || Boolean(field.autoFrom);

        if (field.type === "checkbox") {
          const isSelfCheckbox = field.key === "deposit_self";
          return (
            <label
              key={field.key}
              className={`field workflow-form__checkbox${isSelfCheckbox ? " workflow-form__checkbox--self" : ""}`}
            >
              <input
                id={id}
                type="checkbox"
                checked={value === true || value === "true"}
                disabled={disabled || isReadOnly}
                onChange={(e) => handleChange(field.key, e.target.checked)}
              />
              <span>
                {field.label}
                {field.required ? " *" : ""}
              </span>
              {field.helpText ? <small className="muted">{field.helpText}</small> : null}
            </label>
          );
        }

        if (field.type === "textarea") {
          return (
            <label key={field.key} className="field">
              <span>
                {field.label}
                {field.required ? " *" : ""}
              </span>
              <textarea
                id={id}
                rows={3}
                value={typeof value === "string" ? value : ""}
                placeholder={field.placeholder}
                disabled={disabled || isReadOnly}
                readOnly={isReadOnly}
                onChange={(e) => handleChange(field.key, e.target.value)}
              />
              {field.helpText ? <small className="muted">{field.helpText}</small> : null}
            </label>
          );
        }

        if (field.type === "select") {
          return (
            <label key={field.key} className="field">
              <span>
                {field.label}
                {field.required ? " *" : ""}
              </span>
              <select
                id={id}
                value={typeof value === "string" ? value : ""}
                disabled={disabled || isReadOnly}
                onChange={(e) => handleChange(field.key, e.target.value)}
              >
                <option value="">Select…</option>
                {(field.options ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
              {field.helpText ? <small className="muted">{field.helpText}</small> : null}
            </label>
          );
        }

        const inputType =
          field.type === "number"
            ? "number"
            : field.type === "email"
              ? "email"
              : field.type === "phone"
                ? "tel"
                : field.type === "date"
                  ? "date"
                  : "text";

        const isPhoneField = field.type === "phone";
        const isCommissionField = field.key === "commission";
        const isGhanaCardField = field.key === "ghana_card_number";

        return (
          <label key={field.key} className="field">
            <span>
              {field.label}
              {field.required ? " *" : ""}
            </span>
            <input
              id={id}
              className={isCommissionField || field.type === "number" ? "input-no-spin" : undefined}
              type={isPhoneField ? "tel" : inputType}
              inputMode={isPhoneField ? "numeric" : isGhanaCardField ? "numeric" : isCommissionField ? "decimal" : undefined}
              min={isCommissionField ? 0 : undefined}
              step={isCommissionField ? 0.01 : undefined}
              maxLength={isPhoneField ? 10 : isGhanaCardField ? 14 : undefined}
              pattern={isPhoneField ? "[0-9]{10}" : undefined}
              placeholder={isGhanaCardField ? "GHA-123456789-0" : field.placeholder}
              value={value != null ? String(value) : ""}
              disabled={disabled || isReadOnly}
              readOnly={isReadOnly}
              onChange={(e) => {
                let next = e.target.value;
                if (isPhoneField) {
                  next = e.target.value.replace(/\D/g, "").slice(0, 10);
                } else if (isGhanaCardField) {
                  next = formatGhanaCardInput(e.target.value);
                }
                handleChange(field.key, next);
              }}
            />
            {field.helpText ? <small className="muted">{field.helpText}</small> : null}
          </label>
        );
      })}
    </div>
  );
}
