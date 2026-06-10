import type { ReactNode } from "react";

export type DeskMetric = {
  id: string;
  label: string;
  value: string | number;
  hint?: string;
  tone?: "primary" | "success" | "warning" | "danger" | "neutral" | "violet";
  icon?: ReactNode;
};

type Section = {
  title: string;
  subtitle?: string;
  metrics: DeskMetric[];
};

type Props = {
  sections: Section[];
};

const TONE_CLASS: Record<NonNullable<DeskMetric["tone"]>, string> = {
  primary: "desk-metric--primary",
  success: "desk-metric--success",
  warning: "desk-metric--warning",
  danger: "desk-metric--danger",
  neutral: "desk-metric--neutral",
  violet: "desk-metric--violet"
};

export function DeskMetricGrid({ sections }: Props) {
  return (
    <div className="desk-metric-sections">
      {sections.map((section) => (
        <section key={section.title} className="desk-metric-section card">
          <header className="desk-metric-section__head">
            <h3>{section.title}</h3>
            {section.subtitle ? <p className="muted">{section.subtitle}</p> : null}
          </header>
          <div className="desk-metric-grid">
            {section.metrics.map((metric) => (
              <article
                key={metric.id}
                className={`desk-metric ${TONE_CLASS[metric.tone ?? "neutral"]}`}
              >
                <span className="desk-metric__label">{metric.label}</span>
                <strong className="desk-metric__value">{metric.value}</strong>
                {metric.hint ? <small className="desk-metric__hint muted">{metric.hint}</small> : null}
              </article>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function formatDeskMoney(amount: number): string {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    maximumFractionDigits: 0
  }).format(amount);
}
