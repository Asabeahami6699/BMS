import type { ReactNode } from "react";
import type {
  InvestmentBeneficiary,
  InvestmentFormConfig,
  InvestmentFormField,
  InvestmentRecord
} from "@bms/shared";
import { formatInvestmentTenureLabel } from "@bms/shared";
import { resolveInvestmentIdPhotoUrl, resolveInvestmentPortraitUrl } from "./investmentImages";
import { investmentSectionsOrdered, visibleInvestmentFields, formatInvestmentMoney } from "./investmentUi";

const SECTION_ICONS: Record<string, ReactNode> = {
  personal: "👤",
  contact: "☎",
  address: "📍",
  identification: "🪪",
  next_of_kin: "👥",
  beneficiaries: "🧾",
  investment: "◆"
};

const RAIL_SECTION_IDS = new Set(["photo"]);

function InfoRow({ label, value, fullWidth }: { label: string; value: ReactNode; fullWidth?: boolean }) {
  return (
    <div className={`cif-row${fullWidth ? " cif-row--full" : ""}`}>
      <span className="cif-row__label">{label}</span>
      <span className="cif-row__value">{value ?? "—"}</span>
    </div>
  );
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="cif-block">
      <header className="cif-block__head">
        <span className="cif-block__icon" aria-hidden>
          {icon}
        </span>
        <h3 className="cif-block__title">{title}</h3>
      </header>
      <div className="cif-block__body">{children}</div>
    </section>
  );
}

function formatFieldValue(field: InvestmentFormField, raw: unknown): ReactNode {
  if (raw == null || raw === "") {
    return "—";
  }
  if (field.type === "file" || field.type === "signature") {
    return "On file";
  }
  if (field.type === "checkbox") {
    return raw === true || raw === "true" ? "Yes" : "No";
  }
  return String(raw);
}

type Props = {
  investment: InvestmentRecord;
  formConfig: InvestmentFormConfig;
};

export function InvestmentDetailsView({ investment, formConfig }: Props) {
  const snapshot = investment.customerSnapshot;
  const sections = investmentSectionsOrdered(formConfig).filter(
    (section) => section.id !== "beneficiaries" && !RAIL_SECTION_IDS.has(section.id)
  );
  const fields = visibleInvestmentFields(formConfig);

  const portraitUrl = resolveInvestmentPortraitUrl(investment);
  const idPhotoUrl = resolveInvestmentIdPhotoUrl(investment);

  const initials = investment.customerName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0))
    .join("")
    .toUpperCase();

  return (
    <div className="cif">
      <main className="cif-main">
        <article className="cif-account-card">
          <div className="cif-account-card__chip" aria-hidden />
          <div className="cif-account-card__content">
            <p className="cif-account-card__eyebrow">BMS · Investment account</p>
            <p className="cif-account-card__number">{investment.investmentNumber}</p>
            <p className="cif-account-card__meta">
              <span>{investment.productName}</span>
              <span className="cif-account-card__dot" aria-hidden>
                ·
              </span>
              <span>{investment.branchName ?? investment.branchId}</span>
            </p>
          </div>
          <span
            className={`status-pill status-pill--${investment.status === "active" ? "active" : "pending"} cif-account-card__status`}
          >
            {investment.status}
          </span>
        </article>

        <Section icon={SECTION_ICONS.investment} title="Investment terms">
          <div className="cif-grid">
            <InfoRow label="Principal" value={formatInvestmentMoney(investment.principalAmount)} />
            <InfoRow label="Rate" value={`${investment.interestRatePercent}%`} />
            <InfoRow label="Tenure" value={formatInvestmentTenureLabel(investment.tenureDays)} />
            <InfoRow label="Start date" value={investment.startDate} />
            <InfoRow label="Maturity date" value={investment.maturityDate} />
            <InfoRow label="Expected interest" value={formatInvestmentMoney(investment.expectedInterest)} />
            <InfoRow label="Maturity value" value={formatInvestmentMoney(investment.expectedMaturityValue)} />
            <InfoRow
              label="Auto renewal"
              value={String(snapshot.autoRenewal ?? investment.autoRenewal).replace(/_/g, " ")}
            />
          </div>
        </Section>

        <div className="cif-blocks">
          {sections.map((section) => {
            const sectionFields = fields.filter(
              (field) => field.sectionId === section.id && field.requirement !== "hidden"
            );
            if (!sectionFields.length) {
              return null;
            }
            return (
              <Section key={section.id} icon={SECTION_ICONS[section.id] ?? "•"} title={section.title}>
                <div className="cif-grid">
                  {sectionFields.map((field) => (
                    <InfoRow
                      key={field.id}
                      label={field.label}
                      value={formatFieldValue(field, snapshot[field.key])}
                      fullWidth={field.type === "textarea"}
                    />
                  ))}
                </div>
              </Section>
            );
          })}

          {investment.beneficiaries.length > 0 ? (
            <Section icon={SECTION_ICONS.beneficiaries} title="Beneficiaries">
              {investment.beneficiaries.map((beneficiary: InvestmentBeneficiary, index) => (
                <div key={beneficiary.id ?? index} className="investment-details-beneficiary">
                  <div className="cif-grid">
                    <InfoRow label="Name" value={beneficiary.name} />
                    <InfoRow label="Relationship" value={beneficiary.relationship} />
                    <InfoRow label="Phone" value={beneficiary.phone} />
                    <InfoRow label="Allocation" value={`${beneficiary.allocationPercent}%`} />
                  </div>
                </div>
              ))}
            </Section>
          ) : null}
        </div>
      </main>

      <aside className="cif-rail" aria-label="Customer identity">
        <div className="cif-portrait">
          <div className="cif-portrait__frame">
            {portraitUrl ? (
              <img src={portraitUrl} alt="" className="cif-portrait__img" />
            ) : (
              <div className="cif-portrait__fallback" aria-hidden>
                {initials}
              </div>
            )}
            {investment.status === "active" ? (
              <span className="cif-portrait__badge" title="Active investment">
                ✓
              </span>
            ) : null}
          </div>
          <p className="cif-portrait__name">{investment.customerName}</p>
          <p className="cif-portrait__role muted">{investment.productName}</p>
        </div>

        <div className="cif-kyc">
          <div className="cif-kyc__head">
            <span className="cif-kyc__title">ID verification</span>
          </div>
          {idPhotoUrl ? (
            <div className="cif-kyc__preview">
              <img src={idPhotoUrl} alt="" />
            </div>
          ) : (
            <div className="cif-kyc__missing">
              <span aria-hidden>🪪</span>
              <p className="muted">No ID scan on file</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
