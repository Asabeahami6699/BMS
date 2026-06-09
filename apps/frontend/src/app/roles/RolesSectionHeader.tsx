import type { ReactNode } from "react";
import { SectionHelpTip } from "./SectionHelpTip";

type Props = {
  title: string;
  subtitle?: string;
  helpTitle?: string;
  help: ReactNode;
  actions?: ReactNode;
  badge?: ReactNode;
};

export function RolesSectionHeader({ title, subtitle, helpTitle, help, actions, badge }: Props) {
  return (
    <header className="roles-page__section-head">
      <div className="roles-page__section-head-text">
        <div className="roles-page__section-title-row">
          <h3>{title}</h3>
          <SectionHelpTip label={helpTitle ?? `${title} help`}>{help}</SectionHelpTip>
          {badge}
        </div>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="roles-page__section-actions">{actions}</div> : null}
    </header>
  );
}
