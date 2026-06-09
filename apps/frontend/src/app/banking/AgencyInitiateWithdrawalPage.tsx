import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import {
  bankProductDisplayLabel,
  hasTenantModule,
  workflowFieldsForStage
} from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { filterRowsBySearch } from "../../components/AdminDataTable";
import { useToast } from "../../components/Toast";
import { balancesFromLedger } from "../../lib/customerBalance";
import { toUserFacingError } from "../../lib/networkError";
import { initiateAgencyWithdrawal, listBankProducts } from "../api";
import type { TenantBankProduct } from "@bms/shared";
import { isSusuCustomer } from "./agencyDepositCustomer";
import { DynamicWorkflowForm } from "./DynamicWorkflowForm";
import {
  selectActiveAgencyCustomers,
  useAgencyTellerStore
} from "../stores/agencyTellerStore";

type CustomerSearchTab = "all" | "susu" | "savings";
type WithdrawalCaptureMode = "bms" | "manual";

export function AgencyInitiateWithdrawalPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const hasSusu = hasTenantModule(user?.subscribedModules, "susu_management");

  const [captureMode, setCaptureMode] = useState<WithdrawalCaptureMode>("bms");
  const [search, setSearch] = useState("");
  const [customerSearchTab, setCustomerSearchTab] = useState<CustomerSearchTab>("all");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [bankProductId, setBankProductId] = useState("");
  const [workflowData, setWorkflowData] = useState<Record<string, unknown>>({});
  const [withdrawalProducts, setWithdrawalProducts] = useState<TenantBankProduct[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const {
    customers,
    branches,
    transactionBranchId,
    selectedCustomerId,
    ledgerByCustomer,
    loading,
    hydrate,
    startLiveSync,
    stopLiveSync,
    selectCustomer,
    setTransactionBranchId
  } = useAgencyTellerStore(
    useShallow((s) => ({
      customers: s.customers,
      branches: s.branches,
      transactionBranchId: s.transactionBranchId,
      selectedCustomerId: s.selectedCustomerId,
      ledgerByCustomer: s.ledgerByCustomer,
      loading: s.loading,
      hydrate: s.hydrate,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync,
      selectCustomer: s.selectCustomer,
      setTransactionBranchId: s.setTransactionBranchId
    }))
  );

  useEffect(() => {
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [hydrate, startLiveSync, stopLiveSync]);

  useEffect(() => {
    void listBankProducts({ direction: "withdrawal", activeOnly: true })
      .then(setWithdrawalProducts)
      .catch(() => setWithdrawalProducts([]));
  }, []);

  useEffect(() => {
    if (withdrawalProducts.length === 0) {
      setBankProductId("");
      return;
    }
    if (!withdrawalProducts.some((p) => p.id === bankProductId)) {
      setBankProductId(withdrawalProducts[0]?.id ?? "");
    }
  }, [withdrawalProducts, bankProductId]);

  const activeCustomers = useMemo(() => selectActiveAgencyCustomers(customers), [customers]);

  const customersForSearchTab = useMemo(() => {
    if (customerSearchTab === "susu") {
      return activeCustomers.filter((c) => isSusuCustomer(c));
    }
    if (customerSearchTab === "savings") {
      return activeCustomers.filter((c) => !isSusuCustomer(c));
    }
    return activeCustomers;
  }, [activeCustomers, customerSearchTab]);

  const filteredCustomers = useMemo(
    () =>
      filterRowsBySearch(customersForSearchTab, search, [
        "fullName",
        "phone",
        "accountNumber",
        "idCardNumber"
      ] as (keyof (typeof customersForSearchTab)[0])[]).slice(0, 10),
    [customersForSearchTab, search]
  );

  const selectedCustomer = useMemo(
    () => activeCustomers.find((c) => c.id === selectedCustomerId) ?? null,
    [activeCustomers, selectedCustomerId]
  );

  const showWithdrawalForm = captureMode === "manual" || Boolean(selectedCustomer);

  const ledger = selectedCustomerId ? ledgerByCustomer[selectedCustomerId] ?? [] : [];
  const balances = useMemo(
    () =>
      selectedCustomer
        ? balancesFromLedger(selectedCustomer, ledger)
        : { accountBalance: 0, withdrawableBalance: 0, lockedAmount: 0, isSavings: false },
    [selectedCustomer, ledger]
  );

  const selectedProduct = withdrawalProducts.find((p) => p.id === bankProductId);
  const verificationFields = selectedProduct
    ? workflowFieldsForStage(selectedProduct, "verification")
    : [];
  const usesWorkflowAmount = verificationFields.some((field) => field.key === "amount");

  function resetForm() {
    setAmount("");
    setReason("");
    setWorkflowData({});
  }

  function enableManualMode() {
    setCaptureMode("manual");
    selectCustomer("");
    setSearch("");
    resetForm();
  }

  function enableBmsMode() {
    setCaptureMode("bms");
    selectCustomer("");
    setSearch("");
    resetForm();
  }

  function handleSelectCustomer(id: string) {
    setCaptureMode("bms");
    selectCustomer(id);
  }

  async function handleSubmit() {
    if (captureMode === "bms" && !selectedCustomer) {
      showToast("Select a customer or use non-BMS account entry", "error");
      return;
    }

    const workflowAmount = Number(workflowData.amount);
    const parsedAmount = usesWorkflowAmount ? workflowAmount : Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      showToast("Enter a valid withdrawal amount", "error");
      return;
    }

    if (
      captureMode === "bms" &&
      selectedCustomer &&
      parsedAmount > balances.withdrawableBalance
    ) {
      showToast(
        `Amount exceeds withdrawable balance (GHS ${balances.withdrawableBalance.toFixed(2)})`,
        "error"
      );
      return;
    }

    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      showToast("Enter a reason for the withdrawal (at least 3 characters)", "error");
      return;
    }

    if (!transactionBranchId) {
      showToast("Select the branch where this withdrawal is handled", "error");
      return;
    }

    if (withdrawalProducts.length > 0 && !bankProductId) {
      showToast("Select a withdrawal bank product", "error");
      return;
    }

    setSubmitting(true);
    try {
      await initiateAgencyWithdrawal({
        customerId: captureMode === "bms" ? selectedCustomer?.id : undefined,
        branchId: captureMode === "manual" ? transactionBranchId : undefined,
        manualPartnerAccount: captureMode === "manual",
        amount: parsedAmount,
        reason: trimmedReason,
        fulfillmentMode: "next_day_cash",
        bankProductId: bankProductId || undefined,
        workflowData: {
          ...workflowData,
          ...(usesWorkflowAmount ? { amount: parsedAmount } : {})
        }
      });
      showToast(
        captureMode === "manual"
          ? "Walk-in withdrawal sent to teller for cash payout"
          : "Withdrawal initiated — verify and release to teller",
        "success"
      );
      navigate("/app/banking/customer-service");
    } catch (err) {
      showToast(toUserFacingError(err, "Failed to initiate withdrawal"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  const showCatalogLoader = loading && activeCustomers.length === 0;

  return (
    <div className="branch-counter agency-deposits-counter">
      <header className="branch-counter__toolbar">
        <div>
          <p className="role-workspace__eyebrow">Agency banking · Customer service</p>
          <h2>Initiate withdrawal</h2>
          <p className="muted branch-counter__subtitle">
            First point of contact — collect customer details and start the withdrawal for teller payout.
          </p>
        </div>
        <Link to="/app/banking/customer-service" className="button secondary">
          ← CS desk
        </Link>
      </header>

      <div className="branch-counter__workspace">
        <section className="branch-counter__find card">
          <div className="branch-counter__section-head">
            <span className="branch-counter__step">1</span>
            <h3>Find customer</h3>
          </div>

          <button
            type="button"
            className={`button agency-deposits-mode-btn${captureMode === "manual" ? " agency-deposits-mode-btn--active" : ""}`}
            onClick={enableManualMode}
          >
            Non-BMS account holder
          </button>

          {captureMode === "manual" ? (
            <div className="agency-deposits-manual-mode">
              <p className="muted agency-deposits-account-hint">
                Manual entry — enter the partner bank account number and verification details on the form.
                For customers without a Susu, savings, or linked BMS account.
              </p>
              <button type="button" className="button secondary" onClick={enableBmsMode}>
                ← Back to BMS customer search
              </button>
            </div>
          ) : (
            <>
              {hasSusu ? (
                <div className="branch-counter__type-tabs" role="tablist" aria-label="Account type">
                  {(
                    [
                      { id: "all" as const, label: "All accounts" },
                      { id: "susu" as const, label: "Susu" },
                      { id: "savings" as const, label: "Savings" }
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={customerSearchTab === tab.id}
                      className={`branch-counter__type-tab branch-counter__type-tab--withdrawal${customerSearchTab === tab.id ? " branch-counter__type-tab--active" : ""}`}
                      onClick={() => setCustomerSearchTab(tab.id)}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
              ) : null}

              <label className="field branch-counter__search">
                <span className="sr-only">Search</span>
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Name, phone, or account number…"
                  autoComplete="off"
                />
              </label>

              <div className="branch-counter__results" aria-busy={showCatalogLoader}>
                {showCatalogLoader ? (
                  <p className="muted">Loading customers…</p>
                ) : filteredCustomers.length === 0 ? (
                  <p className="muted branch-counter__empty">No active customers match your search.</p>
                ) : (
                  <ul className="branch-counter__pick-list" role="listbox" aria-label="Customers">
                    {filteredCustomers.map((customer) => (
                      <li key={customer.id}>
                        <button
                          type="button"
                          role="option"
                          aria-selected={customer.id === selectedCustomerId}
                          className={`branch-counter__pick${customer.id === selectedCustomerId ? " branch-counter__pick--active" : ""}`}
                          onClick={() => handleSelectCustomer(customer.id)}
                        >
                          <span className="branch-counter__pick-main">
                            <strong>{customer.fullName}</strong>
                            <span className="branch-counter__pick-acct">
                              {customer.accountNumber ?? "Pending acct"}
                            </span>
                          </span>
                          <span className="muted branch-counter__pick-phone">
                            {hasSusu
                              ? `${isSusuCustomer(customer) ? "Susu" : "Savings"} · ${customer.phone}`
                              : customer.phone}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>

        <section className="branch-counter__main">
          {showWithdrawalForm ? (
            <>
              <div className="branch-counter__hero card">
                <div className="branch-counter__hero-top">
                  <div>
                    <p className="branch-counter__hero-eyebrow">
                      {captureMode === "manual" ? "Manual entry" : "Selected account"}
                    </p>
                    <h3 className="branch-counter__hero-name">
                      {captureMode === "manual"
                        ? "Non-BMS account holder"
                        : selectedCustomer?.fullName ?? "Withdrawal"}
                    </h3>
                    <p className="muted">
                      {captureMode === "manual" ? (
                        "Enter partner bank account number and verification details below"
                      ) : (
                        <>
                          {selectedCustomer?.accountNumber ?? "—"} ·{" "}
                          {selectedCustomer?.accountType?.replace(/_/g, " ") ?? "Account"}
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button secondary branch-counter__clear"
                    onClick={() => (captureMode === "manual" ? enableBmsMode() : handleSelectCustomer(""))}
                  >
                    Clear
                  </button>
                </div>
                {captureMode === "bms" && selectedCustomer ? (
                  <div className="branch-counter__hero-balances">
                    <div className="branch-counter__hero-balance branch-counter__hero-balance--primary">
                      <span>Withdrawable</span>
                      <strong>GHS {balances.withdrawableBalance.toFixed(2)}</strong>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="branch-counter__post card">
                <div className="branch-counter__section-head">
                  <span className="branch-counter__step">2</span>
                  <h3>Withdrawal details</h3>
                </div>

                <div className="branch-counter__post-grid">
                  {withdrawalProducts.length > 0 ? (
                    <label className="field">
                      <span>Bank product</span>
                      <select
                        value={bankProductId}
                        disabled={submitting}
                        onChange={(e) => setBankProductId(e.target.value)}
                      >
                        {withdrawalProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {bankProductDisplayLabel(product)}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {branches.length > 0 ? (
                    <label className="field">
                      <span>Branch</span>
                      <select
                        value={transactionBranchId}
                        disabled={submitting || branches.length <= 1}
                        onChange={(e) => setTransactionBranchId(e.target.value)}
                      >
                        <option value="">Select branch</option>
                        {branches.map((branch) => (
                          <option key={branch.id} value={branch.id}>
                            {branch.name} ({branch.code})
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                  {!usesWorkflowAmount ? (
                    <label className="field">
                      <span>Amount (GHS)</span>
                      <input
                        className="input-no-spin"
                        type="number"
                        min={0.01}
                        step={0.01}
                        value={amount}
                        disabled={submitting}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                      />
                    </label>
                  ) : null}
                  <label className="field">
                    <span>Reason</span>
                    <input
                      type="text"
                      value={reason}
                      disabled={submitting}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why the customer is withdrawing"
                    />
                  </label>
                </div>

                {verificationFields.length > 0 ? (
                  <DynamicWorkflowForm
                    fields={verificationFields}
                    values={workflowData}
                    disabled={submitting}
                    onChange={(key, value) => {
                      setWorkflowData((prev) => ({ ...prev, [key]: value }));
                      if (key === "amount") {
                        setAmount(String(value));
                      }
                    }}
                  />
                ) : null}

                <button
                  type="button"
                  className="button primary branch-counter__submit"
                  disabled={submitting}
                  onClick={() => void handleSubmit()}
                >
                  {submitting ? "Initiating…" : "Initiate withdrawal"}
                </button>
              </div>
            </>
          ) : (
            <div className="branch-counter__hero branch-counter__hero--empty card">
              <p className="branch-counter__hero-placeholder">
                Select <strong>Non-BMS account holder</strong> to enter partner bank details manually, or
                search and select a BMS customer.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
