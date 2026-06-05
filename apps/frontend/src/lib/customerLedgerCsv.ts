import type { Customer, LedgerEntry } from "../app/api";

function escapeCsvCell(value: string | number): string {
  const text = String(value);
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(cells: Array<string | number>): string {
  return cells.map(escapeCsvCell).join(",");
}

function downloadCsv(filename: string, content: string): void {
  const blob = new Blob(["\uFEFF" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function formatIsoForCsv(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function entryToCsvRow(entry: LedgerEntry): string {
  return csvRow([
    formatIsoForCsv(entry.createdAt),
    entry.entryType === "credit" ? "Credit" : "Debit",
    entry.amount.toFixed(2),
    entry.balanceAfter.toFixed(2),
    entry.performedByName ?? entry.recordedByName ?? "",
    entry.transactionType ?? "",
    entry.transactionId
  ]);
}

export function buildCustomerLedgerCsv(customer: Customer, ledger: LedgerEntry[]): string {
  const rows: string[] = [];
  rows.push(csvRow(["Customer ledger"]));
  rows.push(csvRow(["Name", customer.fullName]));
  rows.push(csvRow(["Account", customer.accountNumber ?? ""]));
  rows.push(csvRow(["Exported", new Date().toLocaleString()]));
  rows.push("");
  rows.push(
    csvRow([
      "Date",
      "Type",
      "Amount (GHS)",
      "Balance after (GHS)",
      "Recorded by",
      "Transaction type",
      "Transaction ID"
    ])
  );
  for (const entry of ledger) {
    rows.push(entryToCsvRow(entry));
  }
  return rows.join("\r\n");
}

export function downloadCustomerLedgerCsv(customer: Customer, ledger: LedgerEntry[]): void {
  const safeAccount =
    (customer.accountNumber ?? customer.id).replace(/[^\w\-]+/g, "_").slice(0, 40) || "account";
  const date = new Date().toISOString().slice(0, 10);
  const filename = `ledger-${safeAccount}-${date}.csv`;
  downloadCsv(filename, buildCustomerLedgerCsv(customer, ledger));
}
