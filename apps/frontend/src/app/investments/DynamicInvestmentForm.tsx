import type { InvestmentFormConfig, InvestmentFormField } from "@bms/shared";
import { investmentSectionsOrdered, visibleInvestmentFields } from "./investmentUi";

type Props = {
  config: InvestmentFormConfig;
  values: Record<string, unknown>;
  beneficiaries?: Array<Record<string, unknown>>;
  onChange: (key: string, value: unknown) => void;
  onBeneficiariesChange?: (rows: Array<Record<string, unknown>>) => void;
  readOnly?: boolean;
  excludeSectionIds?: string[];
  includeSectionIds?: string[];
  layout?: "stack" | "grid";
};

function isFullWidthField(field: InvestmentFormField): boolean {
  return field.type === "textarea" || field.type === "file" || field.type === "signature";
}

function renderField(
  field: InvestmentFormField,
  values: Record<string, unknown>,
  onChange: Props["onChange"],
  readOnly?: boolean,
  layout?: Props["layout"]
) {
  const value = values[field.key] ?? "";
  const required = field.requirement === "required";
  const fieldClass = `field${layout === "grid" && isFullWidthField(field) ? " field--full" : ""}`;

  if (field.type === "checkbox") {
    return (
      <label key={field.id} className={`${fieldClass} workflow-form__checkbox`}>
        <input
          type="checkbox"
          checked={Boolean(value)}
          disabled={readOnly}
          onChange={(e) => onChange(field.key, e.target.checked)}
        />
        <span>
          {field.label}
          {required ? " *" : ""}
        </span>
      </label>
    );
  }
  if (field.type === "textarea") {
    return (
      <label key={field.id} className={fieldClass}>
        <span>
          {field.label}
          {required ? " *" : ""}
        </span>
        <textarea
          value={String(value)}
          required={required}
          readOnly={readOnly}
          placeholder={field.placeholder}
          onChange={(e) => onChange(field.key, e.target.value)}
        />
        {field.helpText ? <small className="muted">{field.helpText}</small> : null}
      </label>
    );
  }
  if (field.type === "dropdown" || field.type === "radio") {
    return (
      <label key={field.id} className={fieldClass}>
        <span>
          {field.label}
          {required ? " *" : ""}
        </span>
        <select
          value={String(value)}
          required={required}
          disabled={readOnly}
          onChange={(e) => onChange(field.key, e.target.value)}
        >
          <option value="">Select…</option>
          {(field.options ?? []).map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        {field.helpText ? <small className="muted">{field.helpText}</small> : null}
      </label>
    );
  }
  if (field.type === "file" || field.type === "signature") {
    return (
      <label key={field.id} className={fieldClass}>
        <span>
          {field.label}
          {required ? " *" : ""}
        </span>
        <input
          type="file"
          disabled={readOnly}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) {
              return;
            }
            const reader = new FileReader();
            reader.onload = () => onChange(field.key, String(reader.result ?? ""));
            reader.readAsDataURL(file);
          }}
        />
        {field.helpText ? <small className="muted">{field.helpText}</small> : null}
      </label>
    );
  }
  const inputType =
    field.type === "number"
      ? "number"
      : field.type === "date"
        ? "date"
        : field.type === "email"
          ? "email"
          : field.type === "phone"
            ? "tel"
            : "text";
  return (
    <label key={field.id} className={fieldClass}>
      <span>
        {field.label}
        {required ? " *" : ""}
      </span>
      <input
        type={inputType}
        value={String(value)}
        required={required}
        readOnly={readOnly}
        placeholder={field.placeholder}
        onChange={(e) =>
          onChange(field.key, field.type === "number" ? Number(e.target.value) : e.target.value)
        }
      />
      {field.helpText ? <small className="muted">{field.helpText}</small> : null}
    </label>
  );
}

export function DynamicInvestmentForm({
  config,
  values,
  beneficiaries = [],
  onChange,
  onBeneficiariesChange,
  readOnly,
  excludeSectionIds = [],
  includeSectionIds,
  layout = "stack"
}: Props) {
  const sections = investmentSectionsOrdered(config).filter((section) => {
    if (includeSectionIds?.length) {
      return includeSectionIds.includes(section.id);
    }
    return !excludeSectionIds.includes(section.id);
  });
  const fields = visibleInvestmentFields(config);

  return (
    <div className={`workflow-form investment-form${layout === "grid" ? " investment-form--grid" : ""}`}>
      {sections.map((section) => {
        const sectionFields = fields.filter((f) => f.sectionId === section.id);
        if (section.id === "beneficiaries") {
          return (
            <section key={section.id} className="investment-form__section">
              <h4>{section.title}</h4>
              {(beneficiaries.length ? beneficiaries : [{}]).map((row, index) => (
                <div key={index} className="investment-form__beneficiary">
                  <label className="field">
                    <span>Name *</span>
                    <input
                      value={String(row.name ?? "")}
                      readOnly={readOnly}
                      onChange={(e) => {
                        const next = [...beneficiaries];
                        next[index] = { ...next[index], name: e.target.value };
                        onBeneficiariesChange?.(next);
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Relationship *</span>
                    <input
                      value={String(row.relationship ?? "")}
                      readOnly={readOnly}
                      onChange={(e) => {
                        const next = [...beneficiaries];
                        next[index] = { ...next[index], relationship: e.target.value };
                        onBeneficiariesChange?.(next);
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Phone</span>
                    <input
                      value={String(row.phone ?? "")}
                      readOnly={readOnly}
                      onChange={(e) => {
                        const next = [...beneficiaries];
                        next[index] = { ...next[index], phone: e.target.value };
                        onBeneficiariesChange?.(next);
                      }}
                    />
                  </label>
                  <label className="field">
                    <span>Allocation %</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={String(row.allocationPercent ?? "")}
                      readOnly={readOnly}
                      onChange={(e) => {
                        const next = [...beneficiaries];
                        next[index] = { ...next[index], allocationPercent: Number(e.target.value) };
                        onBeneficiariesChange?.(next);
                      }}
                    />
                  </label>
                </div>
              ))}
              {!readOnly ? (
                <button
                  type="button"
                  className="button secondary"
                  onClick={() =>
                    onBeneficiariesChange?.([
                      ...beneficiaries,
                      { name: "", relationship: "", allocationPercent: 0 }
                    ])
                  }
                >
                  + Add beneficiary
                </button>
              ) : null}
            </section>
          );
        }
        if (!sectionFields.length) {
          return null;
        }
        return (
          <section key={section.id} className="investment-form__section">
            <h4>{section.title}</h4>
            {section.description ? <p className="muted">{section.description}</p> : null}
            <div className={layout === "grid" ? "investment-form-grid" : "stack-form"}>
              {sectionFields.map((field) => renderField(field, values, onChange, readOnly, layout))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
