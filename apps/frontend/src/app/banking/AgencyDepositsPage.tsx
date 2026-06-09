import { useEffect, useMemo, useState } from "react";

import { Link, useSearchParams } from "react-router-dom";

import { useShallow } from "zustand/react/shallow";

import {

  applyWorkflowAutoFields,

  bankProductDisplayLabel,

  hasTenantModule,

  workflowFieldsForStage

} from "@bms/shared";

import { useAuth } from "../../auth/AuthContext";

import { BranchCounterCashCalculator } from "../BranchCounterCashCalculator";

import { DynamicWorkflowForm } from "./DynamicWorkflowForm";

import {
  isSusuCustomer,
  resolveDepositCustomerByAccountNumber
} from "./agencyDepositCustomer";

import { filterRowsBySearch } from "../../components/AdminDataTable";

import { useToast } from "../../components/Toast";

import { balancesFromLedger } from "../../lib/customerBalance";

import { toUserFacingError } from "../../lib/networkError";

import type { Customer } from "../api";

import {

  selectActiveAgencyCustomers,

  useAgencyTellerStore

} from "../stores/agencyTellerStore";

import { TellerDepositStatusList } from "./TellerDepositStatusList";



const QUICK_AMOUNTS = [50, 100, 200, 500, 1000];

type DepositCaptureMode = "banks" | "manual";

type CustomerSearchTab = "all" | "susu" | "savings";



export function AgencyDepositsPage() {

  const { user } = useAuth();

  const { showToast } = useToast();

  const [searchParams, setSearchParams] = useSearchParams();

  const [search, setSearch] = useState("");

  const [amount, setAmount] = useState("");

  const [notes, setNotes] = useState("");

  const [bankProductId, setBankProductId] = useState("");

  const [workflowData, setWorkflowData] = useState<Record<string, unknown>>({});

  const [calculatorOpen, setCalculatorOpen] = useState(false);

  const [captureMode, setCaptureMode] = useState<DepositCaptureMode>("banks");

  const [customerSearchTab, setCustomerSearchTab] = useState<CustomerSearchTab>("all");

  const [accountNumberInput, setAccountNumberInput] = useState("");

  const [accountLookupBusy, setAccountLookupBusy] = useState(false);

  const [lookupCustomer, setLookupCustomer] = useState<Customer | null>(null);

  const [partnerAccountMeta, setPartnerAccountMeta] = useState<{
    accountNumber?: string;
    bankLabel?: string;
  } | null>(null);



  const hasSusu = hasTenantModule(user?.subscribedModules, "susu_management");



  const {

    customers,

    branches,

    bankProducts,

    transactionBranchId,

    selectedCustomerId,

    ledgerByCustomer,

    loading,

    posting,

    error,

    lastFetchedAt,

    hydrate,

    startLiveSync,

    stopLiveSync,

    setTransactionBranchId,

    selectCustomer,

    postDeposit,

    recentDeposits,

    depositsBusinessDate

  } = useAgencyTellerStore(

    useShallow((s) => ({

      customers: s.customers,

      branches: s.branches,

      bankProducts: s.bankProducts,

      transactionBranchId: s.transactionBranchId,

      selectedCustomerId: s.selectedCustomerId,

      ledgerByCustomer: s.ledgerByCustomer,

      loading: s.loading,

      posting: s.posting,

      error: s.error,

      lastFetchedAt: s.lastFetchedAt,

      recentDeposits: s.recentDeposits,

      depositsBusinessDate: s.depositsBusinessDate,

      hydrate: s.hydrate,

      startLiveSync: s.startLiveSync,

      stopLiveSync: s.stopLiveSync,

      setTransactionBranchId: s.setTransactionBranchId,

      selectCustomer: s.selectCustomer,

      postDeposit: s.postDeposit

    }))

  );



  useEffect(() => {

    hydrate({ force: true });

    startLiveSync();

    return () => stopLiveSync();

  }, [hydrate, startLiveSync, stopLiveSync]);



  useEffect(() => {

    const paramId = searchParams.get("customerId");

    if (paramId) {

      selectCustomer(paramId);

    }

  }, [searchParams, selectCustomer]);



  useEffect(() => {

    if (bankProducts.length === 0) {

      setBankProductId("");

      return;

    }

    if (!bankProducts.some((p) => p.id === bankProductId)) {

      setBankProductId(bankProducts[0]?.id ?? "");

    }

  }, [bankProducts, bankProductId]);



  const activeCustomers = useMemo(() => selectActiveAgencyCustomers(customers), [customers]);

  const customersForSearchTab = useMemo(() => {
    if (customerSearchTab === "susu") {
      return activeCustomers.filter((customer) => isSusuCustomer(customer));
    }
    if (customerSearchTab === "savings") {
      return activeCustomers.filter((customer) => !isSusuCustomer(customer));
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

  const showCatalogLoader = loading && activeCustomers.length === 0;



  const selectedCustomer = useMemo(() => {
    if (lookupCustomer?.id === selectedCustomerId) {
      return lookupCustomer;
    }
    return activeCustomers.find((c) => c.id === selectedCustomerId) ?? null;
  }, [activeCustomers, selectedCustomerId, lookupCustomer]);

  const showDepositForm = captureMode === "manual" || Boolean(selectedCustomer);



  const selectedProduct = useMemo(
    () => bankProducts.find((p) => p.id === bankProductId),
    [bankProducts, bankProductId]
  );

  const captureFields = useMemo(
    () => (selectedProduct ? workflowFieldsForStage(selectedProduct, "capture") : []),
    [selectedProduct]
  );

  const usesWorkflowAmount = useMemo(
    () => captureFields.some((field) => field.key === "amount_figure"),
    [captureFields]
  );

  const selectedBranch = branches.find((branch) => branch.id === transactionBranchId);



  const captureFieldKeys = useMemo(() => captureFields.map((field) => field.key).join(","), [captureFields]);

  useEffect(() => {
    if (!selectedCustomer && !selectedBranch) {
      return;
    }

    setWorkflowData((prev) => {
      const next = { ...prev };
      let changed = false;

      const apply = (key: string, value: string | undefined) => {
        if (!value || !captureFieldKeys.includes(key)) {
          return;
        }
        if (next[key] !== value) {
          next[key] = value;
          changed = true;
        }
      };

      if (selectedBranch) {
        apply("branch", selectedBranch.name);
      }
      if (selectedCustomer) {
        apply("account_holder_name", selectedCustomer.fullName);
        if (selectedCustomer.idCardNumber) {
          apply("ghana_card_number", selectedCustomer.idCardNumber);
        }
      }
      if (partnerAccountMeta?.accountNumber) {
        apply("account_number", partnerAccountMeta.accountNumber);
      } else if (selectedCustomer?.accountNumber) {
        apply("account_number", selectedCustomer.accountNumber);
      }

      return changed ? next : prev;
    });
  }, [
    selectedCustomer?.id,
    selectedCustomer?.fullName,
    selectedCustomer?.accountNumber,
    selectedCustomer?.idCardNumber,
    selectedBranch?.id,
    selectedBranch?.name,
    partnerAccountMeta?.accountNumber,
    captureFieldKeys
  ]);



  const ledger = selectedCustomerId ? ledgerByCustomer[selectedCustomerId] ?? [] : [];

  const balances = useMemo(

    () =>

      selectedCustomer

        ? balancesFromLedger(selectedCustomer, ledger)

        : { accountBalance: 0, withdrawableBalance: 0, lockedAmount: 0, isSavings: false },

    [selectedCustomer, ledger]

  );



  function resetDepositForm() {
    setAmount("");
    setNotes("");
    setWorkflowData({});
  }

  function enableManualMode() {
    setCaptureMode("manual");
    selectCustomer("");
    setLookupCustomer(null);
    setPartnerAccountMeta(null);
    setAccountNumberInput("");
    setSearch("");
    resetDepositForm();
    setSearchParams({}, { replace: true });
  }

  function enableBanksMode() {
    setCaptureMode("banks");
    selectCustomer("");
    setLookupCustomer(null);
    setPartnerAccountMeta(null);
    setAccountNumberInput("");
    setSearch("");
    resetDepositForm();
    setSearchParams({}, { replace: true });
  }

  function handleSelectCustomer(id: string, customer?: Customer) {
    setCaptureMode("banks");
    selectCustomer(id);
    setLookupCustomer(customer ?? null);
    setPartnerAccountMeta(null);
    setSearchParams(id ? { customerId: id } : {}, { replace: true });
  }

  async function handleAccountLookup() {
    const trimmed = accountNumberInput.trim();
    if (!trimmed) {
      showToast("Enter an account number to look up", "error");
      return;
    }

    setAccountLookupBusy(true);
    try {
      const result = await resolveDepositCustomerByAccountNumber(trimmed, activeCustomers);
      if (!result) {
        showToast("No linked bank account found for that number in BMS", "error");
        return;
      }

      setCaptureMode("banks");
      setLookupCustomer(result.customer);
      selectCustomer(result.customer.id);
      setSearchParams({ customerId: result.customer.id }, { replace: true });

      if (result.partnerAccountNumber) {
        setPartnerAccountMeta({
          accountNumber: result.partnerAccountNumber,
          bankLabel: result.partnerBankLabel
        });
      } else {
        setPartnerAccountMeta(null);
      }

      showToast(`Account found — ${result.customer.fullName}`, "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Account lookup failed"), "error");
    } finally {
      setAccountLookupBusy(false);
    }
  }



  function applyCalculatorAmount(value: number) {

    setAmount(String(value));

    if (usesWorkflowAmount) {

      setWorkflowData((prev) =>

        applyWorkflowAutoFields(captureFields, { ...prev, amount_figure: value })

      );

    }

    setCalculatorOpen(false);

  }



  async function handlePost() {

    if (captureMode === "banks" && !selectedCustomer) {
      showToast("Select a customer, use banks account lookup, or switch to non-BMS entry", "error");
      return;
    }

    const workflowAmount = Number(workflowData.amount_figure);

    const parsedAmount = usesWorkflowAmount ? workflowAmount : Number(amount);

    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {

      showToast("Enter a valid amount greater than zero", "error");

      return;

    }

    if (!transactionBranchId) {

      showToast("Select the branch where cash is received", "error");

      return;

    }

    if (bankProducts.length > 0 && !bankProductId) {

      showToast("Select a deposit bank product", "error");

      return;

    }



    try {

      await postDeposit({

        customerId: selectedCustomer?.id,

        amount: parsedAmount,

        transactionBranchId,

        notes: notes.trim() || undefined,

        bankProductId: bankProductId || undefined,

        workflowData

      });

      showToast(

        `Deposit GHS ${parsedAmount.toFixed(2)} recorded — pending back-office bank execution`,

        "success"

      );

      if (captureMode === "manual") {
        resetDepositForm();
      } else {
        setAmount("");
        setNotes("");
        setWorkflowData({});
      }

    } catch (err) {

      showToast(toUserFacingError(err, "Failed to record deposit"), "error");

    }

  }



  const updatedLabel = lastFetchedAt

    ? `Updated ${new Date(lastFetchedAt).toLocaleTimeString()}`

    : "Loading…";



  return (
    <div className="branch-counter agency-deposits-counter">
      <header className="branch-counter__toolbar">
        <div>
          <p className="role-workspace__eyebrow">Agency banking · Teller</p>
          <h2>Record deposit</h2>
          <p className="muted branch-counter__subtitle">
            Agency teller desk — cash deposits queued for back-office bank execution · {updatedLabel}
          </p>
          {error ? <p className="error-text">{error}</p> : null}
        </div>
        <div className="branch-counter__toolbar-actions">
          <button
            type="button"
            className="button secondary branch-counter__calc-btn"
            onClick={() => setCalculatorOpen(true)}
            aria-label="Open cash calculator"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
              <rect x="4" y="2" width="16" height="20" rx="2" />
              <path d="M8 6h8M8 10h2M12 10h2M16 10h0M8 14h2M12 14h2M16 14h0M8 18h2M12 18h4" />
            </svg>
            Calculator
          </button>
          <Link to="/app/banking/teller" className="button secondary">
            ← Teller desk
          </Link>
        </div>
      </header>

      <BranchCounterCashCalculator
        open={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
        onApply={applyCalculatorAmount}
      />

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
                Manual entry — enter all deposit slip details on the form. For walk-in customers without a Susu,
                savings, or linked bank account in BMS.
              </p>
              <button type="button" className="button secondary" onClick={enableBanksMode}>
                ← Back to account search
              </button>
            </div>
          ) : (
            <>
              {hasSusu || activeCustomers.length > 0 ? (
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
                        className={`branch-counter__type-tab branch-counter__type-tab--deposit${customerSearchTab === tab.id ? " branch-counter__type-tab--active" : ""}`}
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
                      <div className="branch-counter__skeleton-list">
                        {[1, 2, 3].map((n) => (
                          <div key={n} className="branch-counter__skeleton-row" />
                        ))}
                      </div>
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
              ) : null}

              <div className="agency-deposits-banks-lookup">
                <h4 className="agency-deposits-lookup-title">Banks account lookup</h4>
                <p className="muted agency-deposits-account-hint">
                  Enter a linked partner bank account number to pull customer details from BMS records.
                </p>
                <label className="field">
                  <span>Bank account number</span>
                  <input
                    type="text"
                    value={accountNumberInput}
                    onChange={(e) => setAccountNumberInput(e.target.value)}
                    placeholder="Partner bank account number"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        void handleAccountLookup();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className="button primary"
                  disabled={accountLookupBusy || !accountNumberInput.trim()}
                  onClick={() => void handleAccountLookup()}
                >
                  {accountLookupBusy ? "Looking up…" : "Find account"}
                </button>
                {selectedCustomer && captureMode === "banks" && partnerAccountMeta ? (
                  <div className="agency-deposits-account-result">
                    <strong>{selectedCustomer.fullName}</strong>
                    <span className="muted">
                      {partnerAccountMeta.bankLabel
                        ? `${partnerAccountMeta.bankLabel} · ${partnerAccountMeta.accountNumber}`
                        : partnerAccountMeta.accountNumber}
                    </span>
                  </div>
                ) : null}
              </div>
            </>
          )}
        </section>

        <section className="branch-counter__main">
          {showDepositForm ? (
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
                        : selectedCustomer?.fullName ?? "Deposit"}
                    </h3>
                    <p className="muted">
                      {captureMode === "manual" ? (
                        "Enter all deposit slip details below"
                      ) : (
                        <>
                          {partnerAccountMeta?.accountNumber ??
                            selectedCustomer?.accountNumber ??
                            "—"}{" "}
                          · {selectedCustomer?.accountType?.replace(/_/g, " ") ?? "Account"}
                          {hasSusu && selectedCustomer && isSusuCustomer(selectedCustomer) ? " · Susu" : ""}
                        </>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    className="button secondary branch-counter__clear"
                    onClick={() => (captureMode === "manual" ? enableBanksMode() : handleSelectCustomer(""))}
                  >
                    Clear
                  </button>
                </div>
                {captureMode !== "manual" && selectedCustomer && hasSusu ? (
                  <div className="branch-counter__hero-balances">
                    <div className="branch-counter__hero-balance branch-counter__hero-balance--primary">
                      <span>Account balance</span>
                      <strong>GHS {balances.accountBalance.toFixed(2)}</strong>
                    </div>
                    <div className="branch-counter__hero-balance">
                      <span>Withdrawable</span>
                      <strong>GHS {balances.withdrawableBalance.toFixed(2)}</strong>
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="branch-counter__post card">
                <div className="branch-counter__section-head">
                  <span className="branch-counter__step">2</span>
                  <h3>Record deposit</h3>
                </div>



                <div className="branch-counter__post-grid">
                  {bankProducts.length > 0 ? (
                    <label className="field">
                      <span>Deposit product</span>
                      <select
                        value={bankProductId}
                        disabled={posting}
                        onChange={(e) => setBankProductId(e.target.value)}
                      >
                        {bankProducts.map((product) => (
                          <option key={product.id} value={product.id}>
                            {bankProductDisplayLabel(product)}
                          </option>
                        ))}
                      </select>
                      <small className="muted">
                        Teller deposit type (e.g. GCB cash deposit) — not the company settlement account.
                      </small>
                    </label>
                  ) : null}
                  <label className="field">
                    <span>Branch</span>
                    <select
                      value={transactionBranchId}
                      disabled={posting || branches.length <= 1}
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
                  <label className="field">
                    <span>Notes (optional)</span>
                    <input
                      type="text"
                      value={notes}
                      disabled={posting}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Reference or remark"
                    />
                  </label>
                </div>

                {!usesWorkflowAmount ? (
                  <div className="branch-counter__amount-row">
                    <label className="field branch-counter__amount-field">
                      <span>Amount (GHS)</span>
                      <input
                        className="input-no-spin"
                        type="number"
                        min={0.01}
                        step={0.01}
                        inputMode="decimal"
                        value={amount}
                        disabled={posting}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                      />
                    </label>
                    <div className="branch-counter__quick-amounts" aria-label="Quick amounts">
                      {QUICK_AMOUNTS.map((value) => (
                        <button
                          key={value}
                          type="button"
                          className="branch-counter__quick-btn"
                          disabled={posting}
                          onClick={() => setAmount(String(value))}
                        >
                          {value}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <DynamicWorkflowForm
                  fields={captureFields}
                  values={workflowData}
                  disabled={posting}
                  onChange={(key, value) => {
                    setWorkflowData((prev) =>
                      applyWorkflowAutoFields(captureFields, { ...prev, [key]: value })
                    );
                    if (key === "amount_figure") {
                      setAmount(String(value));
                    }
                  }}
                />

                {usesWorkflowAmount ? (
                  <div className="branch-counter__quick-amounts" aria-label="Quick amounts">
                    {QUICK_AMOUNTS.map((value) => (
                      <button
                        key={value}
                        type="button"
                        className="branch-counter__quick-btn"
                        disabled={posting}
                        onClick={() => {
                          setAmount(String(value));
                          setWorkflowData((prev) =>
                            applyWorkflowAutoFields(captureFields, { ...prev, amount_figure: value })
                          );
                        }}
                      >
                        {value}
                      </button>
                    ))}
                  </div>
                ) : null}

                <button
                  type="button"
                  className="button primary branch-counter__submit"
                  disabled={posting}
                  onClick={() => void handlePost()}
                >
                  {posting ? "Posting…" : "Record deposit"}
                </button>
              </div>
            </>
          ) : (
            <div className="branch-counter__hero branch-counter__hero--empty card">
              <p className="branch-counter__hero-placeholder">
                Select <strong>Non-BMS account holder</strong>, search a Susu or savings account, or use{" "}
                <strong>Banks account lookup</strong> to record a deposit.
              </p>
            </div>
          )}
        </section>
      </div>

      <TellerDepositStatusList
        deposits={recentDeposits}
        loading={loading && recentDeposits.length === 0}
        businessDate={depositsBusinessDate}
      />
    </div>
  );

}


