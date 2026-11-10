import { formatAccountAmount } from "@bms/shared";
import { useEffect, useMemo, useState } from "react";

import type { Customer } from "../../app/api";
import { getCompanyProfile } from "../../app/api";
import { useAuth } from "../../auth/AuthContext";
import { RowActionsMenu } from "../../components/RowActionsMenu";
import { useToast } from "../../components/Toast";
import { downloadDailyTallySheet, printDailyTallySheet } from "../../app/dailyTallySheetPrint";

import { useNetworkStatus } from "../../lib/useNetworkStatus";

import { CollectionModal } from "../CollectionModal";

import { formatCustomerAddress, useAgentCustomerStore } from "../stores/agentCustomerStore";

import { useAgentCollectionStore } from "../stores/agentCollectionStore";



type Props = {

  onQueueChange: () => void;

  onSync: () => void;

  syncing: boolean;

  pendingCount: number;

};



type CollectTab = "not_collected" | "collected";



function formatTotal(amount: number): string {

  if (amount === 0) {

    return "—";

  }

  return `GHS ${formatAccountAmount(amount)}`;

}



export function AgentCollectPage({ onQueueChange, onSync, syncing, pendingCount }: Props) {

  const { online } = useNetworkStatus();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [companyName, setCompanyName] = useState(user?.tenantName ?? "");

  useEffect(() => {
    let cancelled = false;
    void getCompanyProfile()
      .then((profile) => {
        if (!cancelled && profile.name.trim()) {
          setCompanyName(profile.name);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  function openTallySheet(kind: "print" | "download") {
    const options = {
      companyName: companyName || user?.tenantName,
      mobilizerName: user?.fullName || user?.email || ""
    };
    try {
      if (kind === "print") {
        printDailyTallySheet(options);
      } else {
        downloadDailyTallySheet(options);
        showToast("Daily tally sheet downloaded", "success");
      }
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Could not open the tally sheet", "error");
    }
  }


  const customers = useAgentCustomerStore((s) => s.customers);

  const hydrated = useAgentCustomerStore((s) => s.hydrated);

  const [tab, setTab] = useState<CollectTab>("not_collected");

  const [query, setQuery] = useState("");

  const [selected, setSelected] = useState<Customer | null>(null);

  const [modalOpen, setModalOpen] = useState(false);

  const [topUpMode, setTopUpMode] = useState(false);



  const customerIds = useAgentCollectionStore((s) => s.customerIds);

  const items = useAgentCollectionStore((s) => s.items);

  const totalAmount = useAgentCollectionStore((s) => s.totalAmount);

  const loadingCollections = useAgentCollectionStore((s) => s.loading);

  const refreshToday = useAgentCollectionStore((s) => s.refreshToday);

  const markCollected = useAgentCollectionStore((s) => s.markCollected);



  useEffect(() => {

    if (online) {

      void refreshToday();

    }

  }, [refreshToday, online]);



  const activeCustomers = useMemo(

    () => customers.filter((c) => c.status === "active"),

    [customers]

  );



  const collectedSet = useMemo(() => new Set(customerIds), [customerIds]);



  const notCollected = useMemo(() => {

    const q = query.trim().toLowerCase();

    return activeCustomers

      .filter((c) => !collectedSet.has(c.id))

      .filter((c) => {

        if (!q) {

          return true;

        }

        return (

          c.fullName.toLowerCase().includes(q) ||

          c.phone.includes(q) ||

          (c.accountNumber?.toLowerCase().includes(q) ?? false) ||

          (c.location?.toLowerCase().includes(q) ?? false)

        );

      });

  }, [activeCustomers, collectedSet, query]);



  const collectedCustomers = useMemo(() => {

    const byId = new Map(activeCustomers.map((c) => [c.id, c]));

    const q = query.trim().toLowerCase();

    return items

      .map((item) => {

        const customer = byId.get(item.customerId);

        return customer ? { customer, item } : null;

      })

      .filter((row): row is { customer: Customer; item: (typeof items)[0] } => row != null)

      .filter(({ customer }) => {

        if (!q) {

          return true;

        }

        return (

          customer.fullName.toLowerCase().includes(q) ||

          customer.phone.includes(q) ||

          (customer.accountNumber?.toLowerCase().includes(q) ?? false)

        );

      });

  }, [activeCustomers, items, query]);



  function openCollection(customer: Customer, topUp: boolean) {

    setSelected(customer);

    setTopUpMode(topUp);

    setModalOpen(true);

  }



  const refreshCustomers = useAgentCustomerStore((s) => s.refreshSilent);

  function handleSaved(customer: Customer, amount: number) {

    markCollected(customer.id, amount);

    onQueueChange();

    if (online) {

      void refreshToday();

      void refreshCustomers();

    }

  }



  const moreActions = [
    {
      label: "Print tally sheet",
      onClick: () => openTallySheet("print")
    },
    {
      label: "Download tally sheet",
      onClick: () => openTallySheet("download")
    },
    {
      label: loadingCollections ? "Refreshing…" : "Refresh collections",
      onClick: () => {
        if (online && !loadingCollections) {
          void refreshToday();
        }
      }
    }
  ];

  const pendingHint =
    pendingCount > 0
      ? `${pendingCount} waiting to sync`
      : online
        ? "Up to date"
        : "Saved on this device";

  return (
    <div className="agent-page">
      <div className="agent-page-head agent-page-head--clean">
        <div>
          <h2>Daily collection</h2>
          <p className="muted agent-page-sub">
            Today&apos;s total: <strong>{formatTotal(totalAmount)}</strong>
            <span className="agent-page-sub__sep" aria-hidden>
              ·
            </span>
            <span className={online ? undefined : "agent-page-sub--warn"}>
              {syncing ? "Syncing…" : pendingHint}
            </span>
          </p>
        </div>
        <RowActionsMenu items={moreActions} ariaLabel="Collection actions" />
      </div>



      <label className="field agent-search-field">

        <span>Search</span>

        <input

          type="search"

          value={query}

          onChange={(e) => setQuery(e.target.value)}

          placeholder="Name, phone, account #"

        />

      </label>



      <div className="agent-filter-tabs" role="tablist">

        <button

          type="button"

          role="tab"

          aria-selected={tab === "not_collected"}

          className={`agent-filter-tab${tab === "not_collected" ? " active" : ""}`}

          onClick={() => setTab("not_collected")}

        >

          Not collected ({notCollected.length})

        </button>

        <button

          type="button"

          role="tab"

          aria-selected={tab === "collected"}

          className={`agent-filter-tab${tab === "collected" ? " active" : ""}`}

          onClick={() => setTab("collected")}

        >

          Collected ({collectedCustomers.length})

        </button>

      </div>



      <div className="agent-list">

        {tab === "not_collected" ? (

          notCollected.length === 0 ? (

            <p className="muted">

              {hydrated

                ? collectedSet.size >= activeCustomers.length

                  ? "All active customers collected for today."

                  : "No customers match your search."

                : "Loading customers…"}

            </p>

          ) : (

            notCollected.map((customer) => (

              <button

                type="button"

                key={customer.id}

                className="agent-list-item agent-list-item--button agent-customer-card"

                onClick={() => openCollection(customer, false)}

              >

                <div className="agent-customer-card-head">

                  <strong>{customer.fullName}</strong>

                  <span className="agent-collect-cta-pill">Collect</span>

                </div>

                <p className="agent-customer-location">

                  <span aria-hidden>📍</span> {formatCustomerAddress(customer)}

                </p>

                <p className="muted">

                  {customer.accountNumber ?? "No account #"} · GHS{" "}

                  {formatAccountAmount(customer.dailyContributionAmount)}/day

                </p>

              </button>

            ))

          )

        ) : collectedCustomers.length === 0 ? (

          <p className="muted">No collections recorded today yet.</p>

        ) : (

          collectedCustomers.map(({ customer, item }) => {

            const paymentCount = item.entryCount ?? 1;

            return (

              <article key={customer.id} className="agent-list-item agent-customer-card">

                <div className="agent-customer-card-head">

                  <strong>{customer.fullName}</strong>

                  <span className="status-pill status-pill--active">Collected</span>

                </div>

                <button

                  type="button"

                  className="button secondary agent-collect-topup-btn"

                  onClick={() => openCollection(customer, true)}

                >

                  Top up

                </button>

                <p className="agent-customer-location">

                  <span aria-hidden>📍</span> {formatCustomerAddress(customer)}

                </p>

                <p className="agent-customer-amount">

                  {item.amount > 0 ? formatTotal(item.amount) : "—"}

                  {paymentCount > 1 ? (

                    <span className="muted"> · {paymentCount} payments</span>

                  ) : null}

                </p>

                <p className="muted">{new Date(item.createdAt).toLocaleTimeString()}</p>

              </article>

            );

          })

        )}

      </div>



      <CollectionModal

        open={modalOpen}

        customer={selected}

        topUp={topUpMode}

        priorAmount={

          selected ? (items.find((i) => i.customerId === selected.id)?.amount ?? 0) : 0

        }

        onClose={() => setModalOpen(false)}

        onSaved={(customer, amount) => {

          if (customer) {

            handleSaved(customer, amount);

          }

        }}

      />

    </div>

  );

}

