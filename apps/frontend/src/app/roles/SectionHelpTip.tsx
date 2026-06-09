import type { ReactNode } from "react";

type Props = {
  label?: string;
  children: ReactNode;
  size?: "section" | "field";
};

export function SectionHelpTip({ label = "Section help", children, size = "section" }: Props) {
  return (
    <span className={`roles-page__help-tip roles-page__help-tip--${size}`}>
      <button
        type="button"
        className="roles-page__help-tip-btn"
        aria-label={label}
        tabIndex={0}
      >
        i
      </button>
      <span className="roles-page__help-tip-popover" role="tooltip">
        {children}
      </span>
    </span>
  );
}
