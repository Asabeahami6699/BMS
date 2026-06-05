import { useEffect, useRef } from "react";
import type { BalanceDisclosure } from "../../app/api";
import { useToast } from "../../components/Toast";
import { balanceExpiresLabel, useAgentBalanceStore } from "../stores/agentBalanceStore";
import { useAgentCustomerStore } from "../stores/agentCustomerStore";

type Snapshot = { status: string; id: string };

function snapshot(disclosure: BalanceDisclosure | undefined): Snapshot | undefined {
  if (!disclosure) {
    return undefined;
  }
  return { status: disclosure.status, id: disclosure.id };
}

function formatMoney(amount: number): string {
  return `GHS ${amount.toFixed(2)}`;
}

export function useAgentRequestToasts(): void {
  const { showToast } = useToast();
  const byKey = useAgentBalanceStore((s) => s.byKey);
  const prevRef = useRef<Record<string, Snapshot | undefined>>({});

  useEffect(() => {
    for (const [key, disclosure] of Object.entries(byKey)) {
      const prev = prevRef.current[key];
      const next = snapshot(disclosure);
      if (!next || !prev || prev.id !== next.id || prev.status !== "pending") {
        prevRef.current[key] = next;
        continue;
      }
      if (next.status !== "approved" && next.status !== "rejected") {
        prevRef.current[key] = next;
        continue;
      }

      const name = customerName(disclosure.customerId) ?? "Customer";

      if (next.status === "approved") {
        if (disclosure.requestType === "balance") {
          const expiry = disclosure.expiresAt ? balanceExpiresLabel(disclosure.expiresAt) : "";
          showToast(
            `Balance approved — ${name}: ${formatMoney(disclosure.balanceAmount ?? 0)}${expiry ? ` (${expiry})` : ""}`,
            "success"
          );
        } else {
          showToast(
            `Withdrawal approved — ${name}: ${formatMoney(disclosure.withdrawalAmount ?? 0)}`,
            "success"
          );
        }
      } else {
        const reason = disclosure.rejectedReason?.trim();
        const label = disclosure.requestType === "withdrawal" ? "Withdrawal" : "Balance";
        showToast(
          reason ? `${label} declined — ${name}: ${reason}` : `${label} declined — ${name}`,
          "error"
        );
      }

      prevRef.current[key] = next;
    }

    for (const key of Object.keys(prevRef.current)) {
      if (!byKey[key]) {
        delete prevRef.current[key];
      }
    }
  }, [byKey, showToast]);
}

function customerName(customerId: string): string | undefined {
  return useAgentCustomerStore.getState().customers.find((c) => c.id === customerId)?.fullName;
}
