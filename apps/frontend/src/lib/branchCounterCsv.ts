import type { BranchCounterStatement, BranchCounterStatementLine } from "../app/api";

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

const TX_LABELS: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  daily_susu: "Daily Susu"
};

function formatIsoForCsv(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function buildBranchCounterStatementCsv(
  branchLabel: string,
  statement: BranchCounterStatement
): string {
  const { summary, lines } = statement;
  const rows: string[] = [];

  rows.push(csvRow(["Branch counter daily statement"]));
  rows.push(csvRow(["Branch", branchLabel]));
  rows.push(csvRow(["Date", summary.date]));
  rows.push("");
  rows.push(csvRow(["Summary"]));
  rows.push(csvRow(["Transactions", summary.transactionCount]));
  rows.push(csvRow(["Deposits (GHS)", summary.totalDeposits.toFixed(2)]));
  rows.push(csvRow(["Withdrawals (GHS)", summary.totalWithdrawals.toFixed(2)]));
  rows.push(csvRow(["Daily Susu (GHS)", summary.totalDailySusu.toFixed(2)]));
  rows.push(csvRow(["Net (GHS)", summary.netAmount.toFixed(2)]));

  if (summary.byStaff.length > 0) {
    rows.push("");
    rows.push(csvRow(["Staff", "Role", "Transaction count", "Total amount (GHS)"]));
    for (const staff of summary.byStaff) {
      rows.push(
        csvRow([staff.name, staff.role, staff.count, staff.totalAmount.toFixed(2)])
      );
    }
  }

  rows.push("");
  rows.push(
    csvRow([
      "Time",
      "Customer",
      "Account",
      "Type",
      "Amount (GHS)",
      "Posted by",
      "Role",
      "Notes"
    ])
  );

  for (const line of lines) {
    rows.push(lineToCsvRow(line));
  }

  return rows.join("\r\n");
}

function lineToCsvRow(line: BranchCounterStatementLine): string {
  return csvRow([
    formatIsoForCsv(line.createdAt),
    line.customerName,
    line.customerAccountNumber ?? "",
    TX_LABELS[line.type] ?? line.type,
    line.amount.toFixed(2),
    line.recordedByName,
    line.recordedByRole,
    line.notes ?? ""
  ]);
}

export function downloadBranchCounterStatementCsv(
  branchLabel: string,
  statement: BranchCounterStatement
): void {
  const safeBranch = branchLabel.replace(/[^\w\-]+/g, "_").slice(0, 40) || "branch";
  const filename = `branch-counter-${safeBranch}-${statement.summary.date}.csv`;
  downloadCsv(filename, buildBranchCounterStatementCsv(branchLabel, statement));
}
