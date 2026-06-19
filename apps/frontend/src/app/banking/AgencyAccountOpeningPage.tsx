import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useShallow } from "zustand/react/shallow";
import type { TenantBankProduct } from "@bms/shared";
import { AdminDataTable } from "../../components/AdminDataTable";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { getRuntimeBranchId, listAccountOpeningProducts } from "../api";
import { usePageLoading } from "../hooks/usePageLoading";
import { useAgencyAccountsStore } from "../stores/agencyAccountsStore";
import { useBranchesStore } from "../stores/branchesStore";
import {
  AccountOpeningModal,
  buildAccountOpeningWorkflowPayload,
  type AccountOpeningFormValues
} from "./AccountOpeningModal";
import {
  accountOpenedBy,
  accountOpeningDate,
  accountOpeningEmail,
  accountOpeningInitialDeposit,
  accountOpeningPhone,
  accountOpeningTypeLabel
} from "./accountOpeningUi";

export function AgencyAccountOpeningPage() {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [search, setSearch] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [openingProducts, setOpeningProducts] = useState<TenantBankProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);

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

  const branches = useBranchesStore((s) => s.branches);
  const hydrateBranches = useBranchesStore((s) => s.hydrate);

  usePageLoading(accountsLoading || productsLoading, "agency-account-opening");

  const loadOpeningProducts = () => {
    setProductsLoading(true);
    return listAccountOpeningProducts({ branchId: getRuntimeBranchId() || undefined })
      .then((products) => {
        setOpeningProducts(products);
      })
      .catch((err) => {
        showToast(toUserFacingError(err, "Could not load account-opening products"), "error");
        setOpeningProducts([]);
      })
      .finally(() => setProductsLoading(false));
  };

  useEffect(() => {
    hydrateAccounts({ force: true });
    hydrateBranches({ force: true });
    void loadOpeningProducts();
  }, [hydrateAccounts, hydrateBranches]);

  const tableRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sorted = [...accounts].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    if (!q) {
      return sorted;
    }
    return sorted.filter((row) =>
      [
        row.accountNumber,
        row.accountName,
        accountOpeningPhone(row),
        accountOpeningEmail(row),
        accountOpenedBy(row),
        accountOpeningTypeLabel(row),
        row.branchName,
        accountOpeningDate(row)
      ]
        .join(" ")
        .toLowerCase()
        .includes(q)
    );
  }, [accounts, search]);

  const openedByName =
    user?.fullName?.trim() || user?.email?.split("@")[0]?.trim() || "Current user";

  async function handleCreate(values: AccountOpeningFormValues) {
    if (!values.bankProductId) {
      showToast("Select a type", "error");
      return;
    }
    if (!values.accountNumber.trim() || !values.accountName.trim()) {
      showToast("Account number and account name are required", "error");
      return;
    }
    if (!values.branchId) {
      showToast("Select a branch", "error");
      return;
    }

    try {
      await createAccount({
        bankProductId: values.bankProductId,
        accountNumber: values.accountNumber.trim(),
        accountName: values.accountName.trim(),
        branchId: values.branchId,
        workflowData: buildAccountOpeningWorkflowPayload(values)
      });
      showToast("Partner bank account recorded", "success");
      setModalOpen(false);
    } catch (err) {
      showToast(toUserFacingError(err, "Could not record account"), "error");
    }
  }

  return (
    <div className="agency-banking-page role-workspace account-opening-page">
      <header className="card role-workspace__hero workspace-animate-in">
        <p className="role-workspace__eyebrow">Agency banking · Customer service</p>
        <div className="role-workspace__hero-row">
          <div>
            <h2>Partner account opening</h2>
            <p className="muted role-workspace__subtitle">
              Record accounts opened on partner bank platforms and review recent openings.
            </p>
          </div>
          <div className="account-opening-page__hero-actions">
            <button type="button" className="button primary" onClick={() => setModalOpen(true)}>
              + Record opening
            </button>
            <Link to="/app/banking/customer-service" className="button secondary">
              ← CS desk
            </Link>
          </div>
        </div>
      </header>

      <section className="card desk-data-table workspace-animate-in workspace-animate-in--2">
        <AdminDataTable
          variant="desk"
          title="Account openings"
          subtitle="Partner bank accounts recorded by customer service."
          search={search}
          onSearchChange={setSearch}
          searchPlaceholder="Search account no., name, phone, email, branch…"
          emptyMessage={
            accountsLoading ? "Loading account openings…" : "No partner accounts recorded yet."
          }
          rowKey={(row) => row.id}
          rows={tableRows}
          toolbar={
            <button type="button" className="button secondary" onClick={() => setModalOpen(true)}>
              New opening
            </button>
          }
          columns={[
            {
              key: "accountNumber",
              label: "Account No.",
              className: "admin-table-mono",
              render: (row) => row.accountNumber
            },
            {
              key: "accountName",
              label: "Account Name",
              render: (row) => row.accountName
            },
            {
              key: "openedBy",
              label: "Opened By",
              render: (row) => accountOpenedBy(row)
            },
            {
              key: "phone",
              label: "Phone",
              render: (row) => accountOpeningPhone(row)
            },
            {
              key: "email",
              label: "Email",
              render: (row) => accountOpeningEmail(row)
            },
            {
              key: "initialDeposit",
              label: "Initial Deposit",
              render: (row) => accountOpeningInitialDeposit(row)
            },
            {
              key: "type",
              label: "Type",
              render: (row) => accountOpeningTypeLabel(row)
            },
            {
              key: "branch",
              label: "Branch",
              render: (row) => row.branchName ?? "—"
            },
            {
              key: "date",
              label: "Date",
              render: (row) => accountOpeningDate(row)
            }
          ]}
        />
      </section>

      <AccountOpeningModal
        open={modalOpen}
        posting={posting}
        productsLoading={productsLoading}
        branches={branches.filter((b) => b.status !== "inactive")}
        openingProducts={openingProducts}
        openedByName={openedByName}
        defaultBranchId={getRuntimeBranchId() || undefined}
        onClose={() => setModalOpen(false)}
        onSubmit={handleCreate}
      />
    </div>
  );
}
