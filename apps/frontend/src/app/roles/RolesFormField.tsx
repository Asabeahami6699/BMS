import type { ReactNode } from "react";
import { SectionHelpTip } from "./SectionHelpTip";

type Props = {
  label?: string;
  children: ReactNode;
  size?: "section" | "field";
};

export function FieldHelpTip({ label = "Field help", children, size = "field" }: Props) {
  return (
    <SectionHelpTip label={label} size={size}>
      {children}
    </SectionHelpTip>
  );
}

type FormFieldProps = {
  label: string;
  help: ReactNode;
  helpLabel?: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
};

/** Label + help icon + control for roles page text/select inputs. */
export function RolesFormField({
  label,
  help,
  helpLabel,
  hint,
  children,
  className = ""
}: FormFieldProps) {
  return (
    <label className={`field roles-page__field ${className}`.trim()}>
      <span className="roles-page__field-label">
        {label}
        <FieldHelpTip label={helpLabel ?? `${label} help`}>{help}</FieldHelpTip>
      </span>
      {children}
      {hint ? <small className="muted roles-page__field-hint">{hint}</small> : null}
    </label>
  );
}

type InlineLabelProps = {
  label: string;
  help: ReactNode;
  helpLabel?: string;
  className?: string;
};

/** Group heading with help icon (checkbox sections, sidebar rows). */
export function RolesInlineLabel({ label, help, helpLabel, className = "" }: InlineLabelProps) {
  return (
    <span className={`roles-page__inline-label ${className}`.trim()}>
      {label}
      <FieldHelpTip label={helpLabel ?? `${label} help`}>{help}</FieldHelpTip>
    </span>
  );
}
