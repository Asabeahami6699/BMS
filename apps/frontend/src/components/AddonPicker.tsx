import {
  ADDON_DESCRIPTIONS,
  ADDON_LABELS,
  TENANT_ADDONS,
  type TenantAddon
} from "@bms/shared";

type Props = {
  selected: TenantAddon[];
  onChange: (addons: TenantAddon[]) => void;
  disabled?: boolean;
};

export function AddonPicker({ selected, onChange, disabled }: Props) {
  function toggle(addon: TenantAddon) {
    if (disabled) {
      return;
    }
    if (selected.includes(addon)) {
      onChange(selected.filter((a) => a !== addon));
    } else {
      onChange([...selected, addon]);
    }
  }

  return (
    <div className="module-picker">
      <p className="muted module-picker-hint">
        Add-ons are assigned by the platform. Company admins can only configure add-ons already active on
        their subscription.
      </p>
      {TENANT_ADDONS.map((addon) => (
        <label key={addon} className={`module-picker-item${selected.includes(addon) ? " selected" : ""}`}>
          <input
            type="checkbox"
            checked={selected.includes(addon)}
            disabled={disabled}
            onChange={() => toggle(addon)}
          />
          <span>
            <strong>{ADDON_LABELS[addon]}</strong>
            <small>{ADDON_DESCRIPTIONS[addon]}</small>
          </span>
        </label>
      ))}
    </div>
  );
}
