import { useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import {
  bankLabelsMatch,
  bankProductAppliesToBranch,
  hasAnyPermission,
  type OpenBackOfficeDayInput
} from "@bms/shared";
import { useAuth } from "../../auth/AuthContext";
import { useToast } from "../../components/Toast";
import { toUserFacingError } from "../../lib/networkError";
import { useBankProductsLiveSync } from "../hooks/useBankProductsLiveSync";
import { useBranchesLiveSync } from "../hooks/useBranchesLiveSync";
import { useBackOfficeStore } from "../stores/backOfficeStore";
import { useBankProductsStore } from "../stores/bankProductsStore";
import { useBranchesStore } from "../stores/branchesStore";

export function statusLabel(status: string): string {
  if (status === "pending_bank") return "Pending";
  if (status === "pending_accountant") return "Awaiting accountant";
  return status;
}

export function branchLabel(name?: string, code?: string): string {
  if (!name) return "—";
  return code ? `${name} (${code})` : name;
}

export function useBackOfficeWorkspace() {
  const { user } = useAuth();
  const { showToast } = useToast();
  useBranchesLiveSync();
  useBankProductsLiveSync();

  const branches = useBranchesStore((s) => s.branches);
  const bankProducts = useBankProductsStore((s) => s.products);

  const store = useBackOfficeStore(
    useShallow((s) => ({
      data: s.data,
      loading: s.loading,
      branchId: s.branchId,
      dateFrom: s.dateFrom,
      dateTo: s.dateTo,
      busyId: s.busyId,
      error: s.error,
      lastFetchedAt: s.lastFetchedAt,
      executionAccountByDeposit: s.executionAccountByDeposit,
      hydrate: s.hydrate,
      refresh: s.refresh,
      setBranchId: s.setBranchId,
      setDateRange: s.setDateRange,
      setExecutionAccount: s.setExecutionAccount,
      openDay: s.openDay,
      markDepositDone: s.markDepositDone,
      approveAccountantDeposit: s.approveAccountantDeposit,
      approveEcash: s.approveEcash,
      requestEcash: s.requestEcash,
      agentTransfer: s.agentTransfer,
      startLiveSync: s.startLiveSync,
      stopLiveSync: s.stopLiveSync
    }))
  );

  useEffect(() => {
    store.hydrate({
      force: true,
      fallbackBranchId: user?.scopeType === "head_office" ? "all" : user?.branchId
    });
    store.startLiveSync();
    return () => store.stopLiveSync();
  }, [store.hydrate, store.startLiveSync, store.stopLiveSync, user?.branchId, user?.scopeType]);

  const isHeadOffice = user?.scopeType === "head_office";
  const viewingAllBranches = store.branchId === "all" || Boolean(store.data?.viewAllBranches);

  useEffect(() => {
    if (store.branchId || branches.length === 0) return;
    const preferred = isHeadOffice
      ? "all"
      : user?.branchId && branches.some((b) => b.id === user.branchId)
        ? user.branchId
        : branches[0].id;
    store.setBranchId(preferred);
  }, [store.branchId, branches, isHeadOffice, user?.branchId, store.setBranchId]);

  const allCompanyAccounts = useMemo(
    () =>
      bankProducts
        .filter((p) => p.isCompanyBankAccount && p.isActive)
        .map((p) => ({
          id: p.id,
          name: p.name,
          bankLabel: p.bankLabel,
          branchId: p.branchId ?? null,
          branchName: p.branchName
        })),
    [bankProducts]
  );

  const mergedCompanyAccounts = useMemo(() => {
    const byId = new Map(allCompanyAccounts.map((account) => [account.id, account]));
    for (const account of store.data?.companyAccounts ?? []) {
      if (!byId.has(account.id)) {
        byId.set(account.id, {
          id: account.id,
          name: account.name,
          bankLabel: account.bankLabel,
          branchId: account.branchId ?? null,
          branchName: account.branchName
        });
      }
    }
    return [...byId.values()];
  }, [allCompanyAccounts, store.data?.companyAccounts]);

  const operationalBranches = useMemo(
    () => branches.filter((b) => b.status === "active"),
    [branches]
  );

  const depositQueue = store.data?.depositQueue ?? [];
  const accountBalances = store.data?.accountBalances ?? [];
  const ecashRequests = store.data?.ecashRequests ?? [];
  const tellerReconciliation = store.data?.tellerReconciliation ?? [];
  const sessionOpen = Boolean(store.data?.sessionOpen);

  const kpis = useMemo(
    () => [
      { label: "Pending deposits", value: depositQueue.length, tone: "warning" as const },
      {
        label: "Awaiting accountant",
        value: store.data?.pendingAccountantCount ?? 0,
        tone: "primary" as const
      },
      {
        label: "Ecash requests",
        value: store.data?.pendingEcashCount ?? 0,
        tone: "success" as const
      }
    ],
    [store.data, depositQueue.length]
  );

  const updatedLabel = store.lastFetchedAt
    ? `Updated ${new Date(store.lastFetchedAt).toLocaleTimeString()}`
    : undefined;

  const canAccountantApprove = hasAnyPermission(user?.permissions, ["treasury.read"]);

  function depositBranchLabel(row: (typeof depositQueue)[0]): string {
    if (row.branchName) {
      return row.branchCode ? `${row.branchName} (${row.branchCode})` : row.branchName;
    }
    const branch = branches.find((b) => b.id === row.transactionBranchId);
    return branch ? `${branch.name} (${branch.code})` : "—";
  }

  function companyAccountsForDeposit(row: (typeof depositQueue)[0]) {
    if (row.eligibleCompanyAccounts != null) {
      return row.eligibleCompanyAccounts;
    }
    return mergedCompanyAccounts.filter((account) => {
      if (
        !bankProductAppliesToBranch(
          { branchId: account.branchId ?? undefined },
          row.transactionBranchId
        )
      ) {
        return false;
      }
      if (row.bankLabel?.trim()) {
        return bankLabelsMatch(account.bankLabel, row.bankLabel);
      }
      return true;
    });
  }

  async function handleOpenDay(payload: OpenBackOfficeDayInput) {
    try {
      await store.openDay(payload);
      showToast("Opening balances saved — day started", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not open day"), "error");
      throw err;
    }
  }

  async function handleDone(
    transactionId: string,
    accountId: string,
    row: (typeof depositQueue)[0]
  ) {
    if (!accountId?.trim()) {
      const bankHint = row.bankLabel ? `${row.bankLabel} ` : "";
      showToast(
        `No ${bankHint}company account for ${depositBranchLabel(row)} — add one under Bank Products → Company accounts`,
        "error"
      );
      return;
    }
    try {
      await store.markDepositDone(transactionId, accountId.trim());
      showToast("Deposit marked done — teller notified", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Could not complete deposit"), "error");
    }
  }

  async function handleEcashRequest(payload: {
    branchId: string;
    amount: number;
    notes?: string;
    bankProductId?: string;
  }) {
    try {
      await store.requestEcash(payload);
      showToast("Ecash request sent to accountant", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Ecash request failed"), "error");
      throw err;
    }
  }

  async function handleAgentTransfer(payload: {
    branchId: string;
    businessDate: string;
    fromBankProductId: string;
    toBankProductId: string;
    amount: number;
    notes?: string;
  }) {
    try {
      await store.agentTransfer(payload);
      showToast("Ecash transferred between agent accounts", "success");
    } catch (err) {
      showToast(toUserFacingError(err, "Transfer failed"), "error");
      throw err;
    }
  }

  return {
    user,
    showToast,
    branches,
    operationalBranches,
    mergedCompanyAccounts,
    depositQueue,
    accountBalances,
    ecashRequests,
    tellerReconciliation,
    sessionOpen,
    kpis,
    updatedLabel,
    canAccountantApprove,
    isHeadOffice,
    viewingAllBranches,
    depositBranchLabel,
    companyAccountsForDeposit,
    handleOpenDay,
    handleDone,
    handleEcashRequest,
    handleAgentTransfer,
    ...store
  };
}
