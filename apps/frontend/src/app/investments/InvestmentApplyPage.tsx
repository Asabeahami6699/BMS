import { FormEvent, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  computeInvestmentFigures,
  INVESTMENT_PRODUCT_TYPE_LABELS,
  investmentProductRateOptions,
  type InvestmentAutoRenewal
} from "@bms/shared";
import type { AppRole } from "../api";
import { createInvestmentApplication } from "../api";
import { useBranchesStore } from "../stores/branchesStore";
import { useToast } from "../../components/Toast";
import { useInvestmentStore } from "../stores/investmentStore";
import { DynamicInvestmentForm } from "./DynamicInvestmentForm";
import { formatInvestmentMoney } from "./investmentUi";
import { InvestmentsLayout } from "./InvestmentsLayout";

type Props = { role: AppRole };

type Step = 1 | 2 | 3 | 4;

const AUTO_RENEWAL_OPTIONS = [
  { label: "No renewal", value: "none" as InvestmentAutoRenewal },
  { label: "Renew principal only", value: "principal_only" as InvestmentAutoRenewal },
  { label: "Renew principal + interest", value: "principal_and_interest" as InvestmentAutoRenewal }
];

const STEPS = [
  { n: 1 as Step, label: "Product & terms" },
  { n: 2 as Step, label: "Customer details" },
  { n: 3 as Step, label: "Beneficiaries" },
  { n: 4 as Step, label: "Review & submit" }
];

function tierKey(tier: { tenureDays: number; ratePercent: number }): string {
  return `${tier.tenureDays}:${tier.ratePercent}`;
}

export function InvestmentApplyPage({ role: _role }: Props) {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const formConfig = useInvestmentStore((s) => s.formConfig);
  const products = useInvestmentStore((s) => s.products);
  const branches = useBranchesStore((s) => s.branches);
  const prependInvestment = useInvestmentStore((s) => s.prependInvestment);

  const [step, setStep] = useState<Step>(1);
  const [animKey, setAnimKey] = useState(0);
  const [productId, setProductId] = useState("");
  const [tierSelection, setTierSelection] = useState("");
  const [branchId, setBranchId] = useState("");
  const [principalAmount, setPrincipalAmount] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [autoRenewal, setAutoRenewal] = useState<InvestmentAutoRenewal>("none");
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [beneficiaries, setBeneficiaries] = useState<Array<Record<string, unknown>>>([]);
  const [submitting, setSubmitting] = useState(false);

  const activeProducts = useMemo(
    () => products.filter((p) => p.status === "active"),
    [products]
  );

  const selectedProduct = useMemo(
    () => activeProducts.find((p) => p.id === productId),
    [activeProducts, productId]
  );

  const rateOptions = useMemo(
    () => (selectedProduct ? investmentProductRateOptions(selectedProduct) : []),
    [selectedProduct]
  );

  const selectedTier = useMemo(() => {
    if (!selectedProduct) {
      return null;
    }
    const match = rateOptions.find((opt) => tierKey(opt) === tierSelection);
    return match ?? rateOptions[0] ?? null;
  }, [rateOptions, selectedProduct, tierSelection]);

  const principalNum = Number(principalAmount);
  const figures = useMemo(() => {
    if (!selectedTier || !Number.isFinite(principalNum) || principalNum <= 0) {
      return null;
    }
    return computeInvestmentFigures({
      principalAmount: principalNum,
      interestRatePercent: selectedTier.ratePercent,
      tenureDays: selectedTier.tenureDays,
      startDate
    });
  }, [principalNum, selectedTier, startDate]);

  const amountOutOfRange = useMemo(() => {
    if (!selectedProduct || !Number.isFinite(principalNum) || principalNum <= 0) {
      return false;
    }
    return principalNum < selectedProduct.minAmount || principalNum > selectedProduct.maxAmount;
  }, [principalNum, selectedProduct]);

  function onChange(key: string, value: unknown) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  function goTo(next: Step) {
    setStep(next);
    setAnimKey((k) => k + 1);
  }

  function validateStep(current: Step): boolean {
    if (current === 1) {
      if (!productId || !branchId || !selectedTier) {
        showToast("Select product, tenure/rate, and branch", "error");
        return false;
      }
      if (!Number.isFinite(principalNum) || principalNum <= 0) {
        showToast("Enter a valid principal amount", "error");
        return false;
      }
      if (amountOutOfRange && selectedProduct) {
        showToast(
          `Amount must be between ${formatInvestmentMoney(selectedProduct.minAmount)} and ${formatInvestmentMoney(selectedProduct.maxAmount)}`,
          "error"
        );
        return false;
      }
      return true;
    }
    if (current === 2) {
      const firstName = String(values.firstName ?? "").trim();
      const lastName = String(values.lastName ?? "").trim();
      const mobile = String(values.mobileNumber ?? "").trim();
      if (!firstName || !lastName || !mobile) {
        showToast("First name, last name, and mobile number are required", "error");
        return false;
      }
      return true;
    }
    return true;
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!formConfig || !selectedProduct || !selectedTier || !figures) {
      return;
    }
    setSubmitting(true);
    try {
      const customerName = [values.firstName, values.middleName, values.lastName]
        .filter(Boolean)
        .join(" ")
        .trim();
      const snapshot = {
        ...values,
        productId,
        productName: selectedProduct.name,
        productType: INVESTMENT_PRODUCT_TYPE_LABELS[selectedProduct.productType],
        branchId,
        principalAmount: principalNum,
        interestRatePercent: selectedTier.ratePercent,
        tenureDays: selectedTier.tenureDays,
        tenureLabel: selectedTier.label,
        startDate,
        maturityDate: figures.maturityDate,
        expectedInterest: figures.expectedInterest,
        expectedMaturityValue: figures.expectedMaturityValue,
        autoRenewal
      };
      const investment = await createInvestmentApplication({
        productId: selectedProduct.id,
        productType: selectedProduct.productType,
        productName: selectedProduct.name,
        branchId,
        customerName: customerName || "Customer",
        customerPhone: String(values.mobileNumber ?? values.customerPhone ?? ""),
        customerSnapshot: snapshot,
        customFields: {},
        principalAmount: principalNum,
        interestRatePercent: selectedTier.ratePercent,
        tenureDays: selectedTier.tenureDays,
        startDate,
        autoRenewal,
        beneficiaries: beneficiaries
          .filter((b) => b.name)
          .map((b) => ({
            name: String(b.name),
            relationship: String(b.relationship ?? ""),
            phone: b.phone ? String(b.phone) : undefined,
            allocationPercent: Number(b.allocationPercent ?? 0)
          }))
      });
      prependInvestment(investment);
      showToast("Investment application saved", "success");
      navigate(`/app/investments/applications/${investment.id}`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to save application", "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!formConfig) {
    return (
      <InvestmentsLayout activeNav="apply" title="New application">
        <p className="muted">Loading form…</p>
      </InvestmentsLayout>
    );
  }

  const customerName = [values.firstName, values.middleName, values.lastName].filter(Boolean).join(" ").trim();

  return (
    <InvestmentsLayout activeNav="apply" title="New investment application" subtitle="Step-by-step customer application.">
      <ol className="investments-wizard-steps" aria-label="Application steps">
        {STEPS.map((s) => (
          <li
            key={s.n}
            className={`investments-wizard-steps__item${step === s.n ? " investments-wizard-steps__item--active" : ""}${
              step > s.n ? " investments-wizard-steps__item--done" : ""
            }`}
          >
            <span>{s.n}</span>
            {s.label}
          </li>
        ))}
      </ol>

      <form className="stack-form" onSubmit={handleSubmit}>
        <section key={animKey} className="card investments-wizard-panel">
          {step === 1 ? (
            <>
              <h3>Product & terms</h3>
              <p className="muted">Choose the product, tenure/rate tier, branch, and principal.</p>
              <div className="investment-form-grid">
                <label className="field">
                  <span>Product *</span>
                  <select
                    required
                    value={productId}
                    onChange={(e) => {
                      setProductId(e.target.value);
                      setTierSelection("");
                    }}
                  >
                    <option value="">Select product…</option>
                    {activeProducts.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({INVESTMENT_PRODUCT_TYPE_LABELS[p.productType]})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Tenure & rate *</span>
                  <select
                    required
                    value={tierSelection || (rateOptions[0] ? tierKey(rateOptions[0]) : "")}
                    disabled={!selectedProduct}
                    onChange={(e) => setTierSelection(e.target.value)}
                  >
                    {rateOptions.map((opt) => (
                      <option key={tierKey(opt)} value={tierKey(opt)}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Branch *</span>
                  <select required value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                    <option value="">Select branch…</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Principal amount (GHS) *</span>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    required
                    value={principalAmount}
                    onChange={(e) => setPrincipalAmount(e.target.value)}
                  />
                  {selectedProduct ? (
                    <small className="muted">
                      Range: {formatInvestmentMoney(selectedProduct.minAmount)} –{" "}
                      {formatInvestmentMoney(selectedProduct.maxAmount)}
                    </small>
                  ) : null}
                </label>
                <label className="field">
                  <span>Start date *</span>
                  <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                </label>
                <label className="field">
                  <span>Auto renewal</span>
                  <select
                    value={autoRenewal}
                    onChange={(e) => setAutoRenewal(e.target.value as InvestmentAutoRenewal)}
                  >
                    {AUTO_RENEWAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {figures ? (
                <div className="investment-terms-summary">
                  <div>
                    <span className="muted">Maturity date</span>
                    <strong>{figures.maturityDate}</strong>
                  </div>
                  <div>
                    <span className="muted">Expected interest</span>
                    <strong>{formatInvestmentMoney(figures.expectedInterest)}</strong>
                  </div>
                  <div>
                    <span className="muted">Maturity value</span>
                    <strong>{formatInvestmentMoney(figures.expectedMaturityValue)}</strong>
                  </div>
                </div>
              ) : null}
            </>
          ) : null}

          {step === 2 ? (
            <>
              <h3>Customer details</h3>
              <p className="muted">Complete KYC fields configured for your company.</p>
              <DynamicInvestmentForm
                config={formConfig}
                values={values}
                onChange={onChange}
                excludeSectionIds={["beneficiaries", "investment"]}
                layout="grid"
              />
            </>
          ) : null}

          {step === 3 ? (
            <>
              <h3>Beneficiaries</h3>
              <p className="muted">Optional beneficiary allocations for this investment.</p>
              <DynamicInvestmentForm
                config={formConfig}
                values={values}
                beneficiaries={beneficiaries}
                onChange={onChange}
                onBeneficiariesChange={setBeneficiaries}
                includeSectionIds={["beneficiaries"]}
              />
            </>
          ) : null}

          {step === 4 ? (
            <>
              <h3>Review & submit</h3>
              <dl className="investment-review-grid">
                <div>
                  <dt>Product</dt>
                  <dd>{selectedProduct?.name ?? "—"}</dd>
                </div>
                <div>
                  <dt>Tenure & rate</dt>
                  <dd>{selectedTier?.label ?? "—"}</dd>
                </div>
                <div>
                  <dt>Customer</dt>
                  <dd>{customerName || "—"}</dd>
                </div>
                <div>
                  <dt>Principal</dt>
                  <dd>{figures ? formatInvestmentMoney(principalNum) : "—"}</dd>
                </div>
                <div>
                  <dt>Maturity value</dt>
                  <dd>{figures ? formatInvestmentMoney(figures.expectedMaturityValue) : "—"}</dd>
                </div>
                <div>
                  <dt>Auto renewal</dt>
                  <dd>{AUTO_RENEWAL_OPTIONS.find((o) => o.value === autoRenewal)?.label ?? autoRenewal}</dd>
                </div>
              </dl>
            </>
          ) : null}

          <div className="investments-wizard-actions">
            {step > 1 ? (
              <button type="button" className="button secondary" onClick={() => goTo((step - 1) as Step)}>
                Back
              </button>
            ) : null}
            {step < 4 ? (
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  if (validateStep(step)) {
                    goTo((step + 1) as Step);
                  }
                }}
              >
                Continue
              </button>
            ) : (
              <button type="submit" className="button primary" disabled={submitting}>
                {submitting ? "Saving…" : "Submit application"}
              </button>
            )}
          </div>
        </section>
      </form>
    </InvestmentsLayout>
  );
}
