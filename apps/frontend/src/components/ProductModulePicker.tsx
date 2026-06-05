import {
  MODULE_DESCRIPTIONS,
  MODULE_LABELS,
  TENANT_PRODUCT_MODULES,
  type TenantProductModule
} from "@bms/shared";

type Props = {
  selected: TenantProductModule[];
  onChange: (modules: TenantProductModule[]) => void;
  disabled?: boolean;
};

export function ProductModulePicker({ selected, onChange, disabled }: Props) {
  function toggle(module: TenantProductModule) {
    if (disabled) {
      return;
    }
    if (selected.includes(module)) {
      const next = selected.filter((m) => m !== module);
      if (next.length > 0) {
        onChange(next);
      }
    } else {
      onChange([...selected, module]);
    }
  }

  return (
    <div className="module-picker">
      <p className="muted module-picker-hint">
        Reports & Analysis and Settings are included for every active company. Select department products below.
      </p>
      {TENANT_PRODUCT_MODULES.map((module) => (
        <label key={module} className={`module-picker-item${selected.includes(module) ? " selected" : ""}`}>
          <input
            type="checkbox"
            checked={selected.includes(module)}
            disabled={disabled}
            onChange={() => toggle(module)}
          />
          <span>
            <strong>{MODULE_LABELS[module]}</strong>
            <small>{MODULE_DESCRIPTIONS[module]}</small>
          </span>
        </label>
      ))}
    </div>
  );
}
