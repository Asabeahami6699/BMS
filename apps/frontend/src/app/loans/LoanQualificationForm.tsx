import type { LoanQualification } from "@bms/shared";
import { LOAN_INCOME_SOURCE_OPTIONS, LOAN_PURPOSE_OPTIONS, formatMoneyInput } from "./loanUi";
import { LoanMoneyInput } from "./LoanMoneyInput";

export const EMPTY_QUALIFICATION: LoanQualification = {
  loanPurpose: "working_capital",
  loanPurposeOther: "",
  sourceOfIncome: "salary",
  sourceOfIncomeOther: "",
  occupation: "",
  employerOrBusiness: "",
  monthlyIncome: 0,
  monthlyExpenses: undefined,
  existingLoanBalance: undefined,
  yearsAtCurrentJob: undefined,
  guarantor: {
    fullName: "",
    phone: "",
    relationship: "",
    occupation: "",
    employerOrBusiness: "",
    monthlyIncome: undefined,
    location: "",
    idCardNumber: ""
  }
};

type Props = {
  value: LoanQualification;
  onChange: (value: LoanQualification) => void;
};

export function LoanQualificationForm({ value, onChange }: Props) {
  function patch(partial: Partial<LoanQualification>) {
    onChange({ ...value, ...partial });
  }

  function patchGuarantor(partial: Partial<LoanQualification["guarantor"]>) {
    onChange({ ...value, guarantor: { ...value.guarantor, ...partial } });
  }

  return (
    <div className="loans-form-grid">
      <label className="field">
        <span>Purpose of loan</span>
        <select
          required
          value={value.loanPurpose}
          onChange={(e) =>
            patch({ loanPurpose: e.target.value as LoanQualification["loanPurpose"] })
          }
        >
          {LOAN_PURPOSE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      {value.loanPurpose === "other" ? (
        <label className="field">
          <span>Purpose details</span>
          <input
            required
            value={value.loanPurposeOther ?? ""}
            onChange={(e) => patch({ loanPurposeOther: e.target.value })}
          />
        </label>
      ) : null}

      <label className="field">
        <span>Source of income</span>
        <select
          required
          value={value.sourceOfIncome}
          onChange={(e) =>
            patch({ sourceOfIncome: e.target.value as LoanQualification["sourceOfIncome"] })
          }
        >
          {LOAN_INCOME_SOURCE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>
      {value.sourceOfIncome === "other" ? (
        <label className="field">
          <span>Income source details</span>
          <input
            required
            value={value.sourceOfIncomeOther ?? ""}
            onChange={(e) => patch({ sourceOfIncomeOther: e.target.value })}
          />
        </label>
      ) : null}

      <label className="field">
        <span>Occupation / role</span>
        <input
          required
          value={value.occupation}
          onChange={(e) => patch({ occupation: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Employer or business name</span>
        <input
          value={value.employerOrBusiness ?? ""}
          onChange={(e) => patch({ employerOrBusiness: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Monthly income (GHS)</span>
        <LoanMoneyInput
          required
          value={value.monthlyIncome > 0 ? formatMoneyInput(value.monthlyIncome) : ""}
          onChange={(_display, numeric) => patch({ monthlyIncome: numeric })}
        />
      </label>
      <label className="field">
        <span>Monthly expenses (GHS)</span>
        <LoanMoneyInput
          value={value.monthlyExpenses != null ? String(value.monthlyExpenses) : ""}
          onChange={(_display, numeric) =>
            patch({ monthlyExpenses: Number.isFinite(numeric) ? numeric : undefined })
          }
        />
      </label>
      <label className="field">
        <span>Existing loan balance (GHS)</span>
        <LoanMoneyInput
          value={value.existingLoanBalance != null ? String(value.existingLoanBalance) : ""}
          onChange={(_display, numeric) =>
            patch({ existingLoanBalance: Number.isFinite(numeric) ? numeric : undefined })
          }
        />
      </label>
      <label className="field">
        <span>Years in current work / business</span>
        <input
          type="text"
          inputMode="decimal"
          className="loans-money-input"
          value={value.yearsAtCurrentJob ?? ""}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d.]/g, "");
            patch({ yearsAtCurrentJob: raw ? Number(raw) : undefined });
          }}
        />
      </label>

      <div className="loans-form-section field--full">
        <h4>Guarantor</h4>
        <div className="loans-form-grid">
          <label className="field">
            <span>Full name</span>
            <input
              required
              value={value.guarantor.fullName}
              onChange={(e) => patchGuarantor({ fullName: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Phone</span>
            <input
              required
              value={value.guarantor.phone}
              onChange={(e) => patchGuarantor({ phone: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Relationship to borrower</span>
            <input
              required
              value={value.guarantor.relationship}
              onChange={(e) => patchGuarantor({ relationship: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Occupation</span>
            <input
              required
              value={value.guarantor.occupation}
              onChange={(e) => patchGuarantor({ occupation: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Employer / business</span>
            <input
              value={value.guarantor.employerOrBusiness ?? ""}
              onChange={(e) => patchGuarantor({ employerOrBusiness: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Guarantor monthly income (GHS)</span>
            <LoanMoneyInput
              value={
                value.guarantor.monthlyIncome != null ? String(value.guarantor.monthlyIncome) : ""
              }
              onChange={(_display, numeric) =>
                patchGuarantor({
                  monthlyIncome: Number.isFinite(numeric) && numeric > 0 ? numeric : undefined
                })
              }
            />
          </label>
          <label className="field">
            <span>Location / area</span>
            <input
              required
              value={value.guarantor.location}
              onChange={(e) => patchGuarantor({ location: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Ghana Card / ID number</span>
            <input
              value={value.guarantor.idCardNumber ?? ""}
              onChange={(e) => patchGuarantor({ idCardNumber: e.target.value })}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
