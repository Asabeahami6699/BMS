import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import { bankProductDisplayLabel, workflowFieldsForStage } from "@bms/shared";
import { filterRowsBySearch } from "../../components/AdminDataTable";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import type { TenantBankProduct } from "@bms/shared";
import { listBankProducts } from "../api";
import { selectActiveAgencyCustomers, useAgencyTellerStore } from "../stores/agencyTellerStore";
import { useAgencyAccountsStore } from "../stores/agencyAccountsStore";
import { DynamicWorkflowForm } from "./DynamicWorkflowForm";

export function AgencyAccountOpeningPage() {
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [accountName, setAccountName] = useState("");
  const [externalReference, setExternalReference] = useState("");
  const [bankProductId, setBankProductId] = useState("");
  const [workflowData, setWorkflowData] = useState<Record<string, unknown>>({});

  const { accounts, loading: accountsLoading, hydrate: hydrateAccounts, createAccount, posting } =
    useAgencyAccountsStore(
      useShallow((s) => ({
        accounts: s.accounts,
        loading: s.loading,
        hydrate: s.hydrate,
        createAccount: s.createAccount,
        posting: s.posting
      }))
    );

  const [openingProducts, setOpeningProducts] = useState<TenantBankProduct[]>([]);

  const { customers, selectedCustomerId, loading, hydrate, startLiveSync, stopLiveSync, selectCustomer } =
    useAgencyTellerStore(
      useShallow((s) => ({
        customers: s.customers,
        selectedCustomerId: s.selectedCustomerId,
        loading: s.loading,
        hydrate: s.hydrate,
        startLiveSync: s.startLiveSync,
        stopLiveSync: s.stopLiveSync,
        selectCustomer: s.selectCustomer
      }))
    );

  useEffect(() => {
    hydrate({ force: true });
    hydrateAccounts({ force: true });
    startLiveSync();
    void listBankProducts({ direction: "account_opening", activeOnly: true })
      .then(setOpeningProducts)
      .catch(() => setOpeningProducts([]));
    return () => stopLiveSync();
  }, [hydrate, hydrateAccounts, startLiveSync, stopLiveSync]);

  useEffect(() => {
    if (!bankProductId && openingProducts[0]) {
      setBankProductId(openingProducts[0].id);
    }
  }, [openingProducts, bankProductId]);

  const selectedProduct = openingProducts.find((p) => p.id === bankProductId);
  const openingFields = selectedProduct
    ? workflowFieldsForStage(selectedProduct, "account_opening")
    : [];

  const activeCustomers = useMemo(() => selectActiveAgencyCustomers(customers), [customers]);
  const filteredCustomers = useMemo(
    () =>
      filterRowsBySearch(activeCustomers, search, [
        "fullName",
        "phone",
        "accountNumber"
      ] as (keyof (typeof activeCustomers)[0])[]).slice(0, 12),
    [activeCustomers, search]
  );

  const selectedCustomer = activeCustomers.find((c) => c.id === selectedCustomerId) ?? null;
  const customerAccounts = useMemo(
    () => accounts.filter((a) => a.customerId === selectedCustomerId),
    [accounts, selectedCustomerId]
  );

  async function handleSubmit() {
    if (!selectedCustomer) {
      showToast("Select a customer first", "error");
      return;
    }
    if (!bankProductId) {
      showToast("Select an account-opening bank product", "error");
      return;
    }
    if (!accountNumber.trim() || !accountName.trim()) {
      showToast("Account number and account name are required", "error");
      return;
    }

    try {
      await createAccount({
        customerId: selectedCustomer.id,
        bankProductId,
        accountNumber: accountNumber.trim(),
        accountName: accountName.trim(),
        externalReference: externalReference.trim() || undefined,
        workflowData
      });
      showToast("Partner bank account recorded", "success");
      setAccountNumber("");
      setAccountName("");
      setExternalReference("");
      setWorkflowData({});
    } catch (err) {
      showToast(toUserFacingError(err, "Could not record account"), "error");
    }
  }

  return (
    <div className="agency-banking-page role-workspace">
      <header className="card role-workspace__hero workspace-animate-in">
        <p className="role-workspace__eyebrow">Agency banking · Customer service</p>
        <div className="role-workspace__hero-row">
          <div>
            <h2>Partner account opening</h2>
            <p className="muted role-workspace__subtitle">
              Record real accounts created on Ecobank, GCB, or other partner platforms.
            </p>
          </div>
          <Link to="/app/banking/customer-service" className="button secondary">
            ← CS desk
          </Link>
        </div>
      </header>

      <div className="agency-deposits-layout workspace-animate-in workspace-animate-in--2">
        <section className="card agency-deposits-layout__customers">
          <label className="field">
            <span>Search customer</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, phone, account…"
            />
          </label>
          <ul className="agency-deposits-customer-list">
            {filteredCustomers.map((customer) => (
              <li key={customer.id}>
                <button
                  type="button"
                  className={`agency-deposits-customer${selectedCustomerId === customer.id ? " is-selected" : ""}`}
                  onClick={() => selectCustomer(customer.id)}
                >
                  <strong>{customer.fullName}</strong>
                  <span className="muted">{customer.accountNumber ?? customer.phone}</span>
                </button>
              </li>
            ))}
          </ul>
          {selectedCustomer && customerAccounts.length > 0 ? (
            <div className="partner-accounts-list">
              <h4>Recorded partner accounts</h4>
              <ul>
                {customerAccounts.map((account) => (
                  <li key={account.id}>
                    <strong>{account.bankLabel}</strong> · {account.accountNumber}
                    <span className="muted"> — {account.accountName}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <section className="card agency-deposits-layout__form">
          {selectedCustomer ? (
            <>
              <h3>{selectedCustomer.fullName}</h3>
              {openingProducts.length === 0 ? (
                <p className="muted">
                  No account-opening bank products configured. Ask an admin to add one under Bank
                  products → Account opening.
                </p>
              ) : (
                <>
                  <label className="field">
                    <span>Bank product</span>
                    <select value={bankProductId} onChange={(e) => setBankProductId(e.target.value)}>
                      {openingProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {bankProductDisplayLabel(product)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Partner account number</span>
                    <input
                      value={accountNumber}
                      onChange={(e) => setAccountNumber(e.target.value)}
                      placeholder="From partner bank platform"
                    />
                  </label>
                  <label className="field">
                    <span>Account name</span>
                    <input
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value)}
                      placeholder="As shown on partner bank"
                    />
                  </label>
                  <label className="field">
                    <span>External reference (optional)</span>
                    <input
                      value={externalReference}
                      onChange={(e) => setExternalReference(e.target.value)}
                      placeholder="Platform ticket / ref"
                    />
                  </label>
                  <DynamicWorkflowForm
                    fields={openingFields}
                    values={workflowData}
                    disabled={posting}
                    onChange={(key, value) =>
                      setWorkflowData((prev) => ({ ...prev, [key]: value }))
                    }
                  />
                  <button
                    type="button"
                    className="button primary agency-deposits-submit"
                    disabled={posting || loading || accountsLoading}
                    onClick={() => void handleSubmit()}
                  >
                    {posting ? "Saving…" : "Record partner account"}
                  </button>
                </>
              )}
            </>
          ) : (
            <p className="muted">Select a customer to record a partner bank account.</p>
          )}
        </section>
      </div>
    </div>
  );
}
