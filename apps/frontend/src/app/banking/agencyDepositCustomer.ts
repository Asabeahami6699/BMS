import type { Customer } from "../api";
import { lookupPartnerBankAccount, searchCustomers } from "../api";

export function isSusuCustomer(customer: Customer): boolean {
  return customer.accountType === "susu";
}

function matchByAccountNumber(customers: Customer[], accountNumber: string): Customer | undefined {
  const normalized = accountNumber.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  return customers.find((customer) => customer.accountNumber?.toLowerCase() === normalized);
}

export async function resolveDepositCustomerByAccountNumber(
  accountNumber: string,
  localCustomers: Customer[]
): Promise<{ customer: Customer; partnerAccountNumber?: string; partnerBankLabel?: string } | null> {
  const trimmed = accountNumber.trim();
  if (!trimmed) {
    return null;
  }

  const localMatch = matchByAccountNumber(localCustomers, trimmed);
  if (localMatch) {
    return { customer: localMatch };
  }

  try {
    const searchResults = await searchCustomers(trimmed);
    const exact = matchByAccountNumber(searchResults, trimmed);
    if (exact) {
      return { customer: exact };
    }
  } catch {
    /* fall through to partner lookup */
  }

  try {
    const partnerAccount = await lookupPartnerBankAccount(trimmed);
    if (!partnerAccount) {
      return null;
    }
    const linked = localCustomers.find((customer) => customer.id === partnerAccount.customerId);
    if (linked) {
      return {
        customer: linked,
        partnerAccountNumber: partnerAccount.accountNumber,
        partnerBankLabel: partnerAccount.bankLabel
      };
    }

    const searchResults = await searchCustomers(partnerAccount.customerId);
    const fromSearch = searchResults.find((customer) => customer.id === partnerAccount.customerId);
    if (fromSearch) {
      return {
        customer: fromSearch,
        partnerAccountNumber: partnerAccount.accountNumber,
        partnerBankLabel: partnerAccount.bankLabel
      };
    }

    return {
      customer: {
        id: partnerAccount.customerId,
        fullName: partnerAccount.accountName || partnerAccount.customerName || "Account holder",
        phone: "",
        homeBranchId: partnerAccount.branchId ?? "",
        dailyContributionAmount: 0,
        status: "active",
        accountNumber: partnerAccount.accountNumber
      },
      partnerAccountNumber: partnerAccount.accountNumber,
      partnerBankLabel: partnerAccount.bankLabel
    };
  } catch {
    return null;
  }
}
