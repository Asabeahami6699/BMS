import { APP_BRAND_NAME, type AccountType } from "@bms/shared";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { getCompanyProfile, type Customer, type LedgerEntry } from "./api";

const DOCUMENT_STYLES = `
  * { box-sizing: border-box; }
  html, body {
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  @page { size: A4; margin: 12mm 18mm; }
  body {
    font-family: "Segoe UI", Tahoma, Geneva, Verdana, sans-serif;
    font-size: 10.5pt;
    color: #000;
    margin: 0;
    padding: 12mm 18mm;
    line-height: 1.35;
    background: #fff;
  }
  .stmt {
    position: relative;
    width: 100%;
    overflow: hidden;
  }
  .stmt__watermark {
    position: absolute;
    inset: -18%;
    z-index: 0;
    pointer-events: none;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .stmt__watermark-grid {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 64px 36px;
    width: 145%;
    min-height: 145%;
    align-content: space-evenly;
    opacity: 0.09;
    transform: rotate(-28deg);
  }
  .stmt__watermark-grid img {
    width: 132px;
    max-width: 100%;
    height: auto;
    object-fit: contain;
    display: block;
    margin: 0 auto;
  }
  .stmt__body {
    position: relative;
    z-index: 1;
  }
  .stmt__header {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
    margin: 0 0 4px;
  }
  .stmt__logo {
    width: 58px;
    height: 58px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .stmt__company {
    text-align: center;
    margin: 0;
    font-size: 1.2rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .stmt__title {
    text-align: center;
    margin: 0 0 12px;
    font-size: 0.95rem;
    font-weight: 700;
    text-transform: uppercase;
    border-bottom: 2px solid #000;
    padding-bottom: 6px;
  }
  .stmt__meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 6px 16px;
    margin-bottom: 12px;
  }
  .stmt__label {
    font-size: 0.7rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }
  .stmt__value { font-weight: 600; }
  table {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }
  th, td {
    border: 1px solid #000;
    padding: 4px 6px;
    vertical-align: top;
    font-size: 0.85rem;
  }
  th {
    text-transform: uppercase;
    font-size: 0.68rem;
    letter-spacing: 0.04em;
    text-align: left;
  }
  .num { text-align: right; white-space: nowrap; }
  .stmt__footer {
    margin-top: 10px;
    font-size: 0.75rem;
  }
`;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function accountTypeLabel(type: AccountType | undefined): string {
  if (!type) {
    return "Account";
  }
  if (type === "meba_daakye") {
    return "Meba Daakye";
  }
  return type.replace(/_/g, " ");
}

function typeLabel(entry: LedgerEntry): string {
  if (entry.transactionType === "susu_reversal") {
    return "Reversal";
  }
  return entry.entryType === "credit" ? "Credit" : "Debit";
}

function startOfLocalDay(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 0, 0, 0, 0).getTime();
}

function endOfLocalDay(isoDate: string): number {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime();
}

function formatPeriodDate(isoDate: string): string {
  try {
    const [y, m, d] = isoDate.split("-").map(Number);
    return new Date(y!, m! - 1, d!).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  } catch {
    return isoDate;
  }
}

/** Filter ledger entries to an inclusive local-date range (YYYY-MM-DD). */
export function filterLedgerForStatement(
  ledger: LedgerEntry[],
  fromDate?: string,
  toDate?: string
): LedgerEntry[] {
  const from = fromDate?.trim() || "";
  const to = toDate?.trim() || "";
  const fromMs = from ? startOfLocalDay(from) : null;
  const toMs = to ? endOfLocalDay(to) : null;
  if (fromMs == null && toMs == null) {
    return ledger;
  }
  return ledger.filter((entry) => {
    const t = new Date(entry.createdAt).getTime();
    if (Number.isNaN(t)) {
      return false;
    }
    if (fromMs != null && t < fromMs) {
      return false;
    }
    if (toMs != null && t > toMs) {
      return false;
    }
    return true;
  });
}

function periodLabel(fromDate?: string, toDate?: string): string {
  const from = fromDate?.trim() || "";
  const to = toDate?.trim() || "";
  if (from && to) {
    return `${formatPeriodDate(from)} – ${formatPeriodDate(to)}`;
  }
  if (from) {
    return `From ${formatPeriodDate(from)}`;
  }
  if (to) {
    return `Through ${formatPeriodDate(to)}`;
  }
  return "All transactions";
}

function isUsableLogoUrl(logoUrl: string | undefined | null): logoUrl is string {
  if (!logoUrl?.trim()) {
    return false;
  }
  const value = logoUrl.trim();
  return (
    /^data:image\/(jpeg|png|webp|gif|svg\+xml)/i.test(value) || /^https?:\/\//i.test(value)
  );
}

async function resolveCompanyLogoUrl(explicit?: string): Promise<string | undefined> {
  if (isUsableLogoUrl(explicit)) {
    return explicit.trim();
  }
  try {
    const profile = await getCompanyProfile();
    return isUsableLogoUrl(profile.logoUrl) ? profile.logoUrl.trim() : undefined;
  } catch {
    return undefined;
  }
}

export function buildCustomerAccountStatementHtml(options: {
  customer: Customer;
  ledger: LedgerEntry[];
  companyName?: string;
  logoUrl?: string;
  openingBalance?: number;
  closingBalance?: number;
  fromDate?: string;
  toDate?: string;
}): string {
  const company = options.companyName?.trim() || APP_BRAND_NAME;
  const customer = options.customer;
  const logoUrl = isUsableLogoUrl(options.logoUrl) ? options.logoUrl.trim() : undefined;
  const ledgerOldestFirst = [...options.ledger].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const closing =
    options.closingBalance ??
    (ledgerOldestFirst.length > 0
      ? ledgerOldestFirst[ledgerOldestFirst.length - 1]!.balanceAfter
      : customer.accountBalance ?? 0);
  const opening =
    options.openingBalance ??
    (ledgerOldestFirst.length > 0
      ? ledgerOldestFirst[0]!.entryType === "credit"
        ? ledgerOldestFirst[0]!.balanceAfter - ledgerOldestFirst[0]!.amount
        : ledgerOldestFirst[0]!.balanceAfter + ledgerOldestFirst[0]!.amount
      : closing);
  const period = periodLabel(options.fromDate, options.toDate);

  const rows = ledgerOldestFirst
    .map(
      (entry) => `<tr>
      <td>${escapeHtml(formatWhen(entry.createdAt))}</td>
      <td>${escapeHtml(typeLabel(entry))}${entry.reversalStatus === "reversed" ? " · Reversed" : ""}</td>
      <td class="num">${entry.amount.toFixed(2)}</td>
      <td class="num">${entry.balanceAfter.toFixed(2)}</td>
      <td>${escapeHtml(entry.performedByName ?? entry.recordedByName ?? "—")}</td>
    </tr>`
    )
    .join("");

  const headerLogo = logoUrl
    ? `<img class="stmt__logo" src="${logoUrl}" alt="" />`
    : "";
  const watermarkTiles = Math.max(24, Math.ceil((ledgerOldestFirst.length + 8) / 4) * 4);
  const watermark = logoUrl
    ? `<div class="stmt__watermark" aria-hidden="true">
        <div class="stmt__watermark-grid">
          ${Array.from({ length: watermarkTiles }, () => `<img src="${logoUrl}" alt="" />`).join("")}
        </div>
      </div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Account Statement</title>
  <style>${DOCUMENT_STYLES}</style>
</head>
<body>
  <article class="stmt">
    ${watermark}
    <div class="stmt__body">
      <header class="stmt__header">
        ${headerLogo}
        <h1 class="stmt__company">${escapeHtml(company)}</h1>
      </header>
      <p class="stmt__title">Account statement</p>
      <div class="stmt__meta">
        <div>
          <div class="stmt__label">Customer</div>
          <div class="stmt__value">${escapeHtml(customer.fullName)}</div>
        </div>
        <div>
          <div class="stmt__label">Account number</div>
          <div class="stmt__value">${escapeHtml(customer.accountNumber ?? "—")}</div>
        </div>
        <div>
          <div class="stmt__label">Account type</div>
          <div class="stmt__value">${escapeHtml(accountTypeLabel(customer.accountType))}</div>
        </div>
        <div>
          <div class="stmt__label">Phone</div>
          <div class="stmt__value">${escapeHtml(customer.phone)}</div>
        </div>
        <div>
          <div class="stmt__label">Statement period</div>
          <div class="stmt__value">${escapeHtml(period)}</div>
        </div>
        <div>
          <div class="stmt__label">Entries</div>
          <div class="stmt__value">${ledgerOldestFirst.length}</div>
        </div>
        <div>
          <div class="stmt__label">Opening balance</div>
          <div class="stmt__value">GHS ${opening.toFixed(2)}</div>
        </div>
        <div>
          <div class="stmt__label">Closing balance</div>
          <div class="stmt__value">GHS ${closing.toFixed(2)}</div>
        </div>
      </div>
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Type</th>
            <th class="num">Amount (GHS)</th>
            <th class="num">Balance after</th>
            <th>Recorded by</th>
          </tr>
        </thead>
        <tbody>
          ${
            rows ||
            `<tr><td colspan="5">No account history entries for this customer.</td></tr>`
          }
        </tbody>
      </table>
      <p class="stmt__footer">Printed from ${escapeHtml(APP_BRAND_NAME)} · ${escapeHtml(new Date().toLocaleString())}</p>
    </div>
  </article>
</body>
</html>`;
}

function statementFilename(customer: Customer): string {
  const safeAccount =
    (customer.accountNumber ?? customer.id).replace(/[^\w\-]+/g, "_").slice(0, 40) || "account";
  return `account-statement-${safeAccount}.pdf`;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function htmlToPdfBlob(html: string): Promise<Blob> {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.left = "-10000px";
  iframe.style.top = "0";
  iframe.style.width = "980px";
  iframe.style.height = "1200px";
  iframe.style.border = "none";
  document.body.appendChild(iframe);

  const doc = iframe.contentDocument;
  if (!doc) {
    iframe.remove();
    throw new Error("Could not prepare the account statement PDF.");
  }

  doc.open();
  doc.write(html);
  doc.close();

  await new Promise<void>((resolve) => {
    if (doc.readyState === "complete") {
      resolve();
      return;
    }
    iframe.onload = () => resolve();
  });

  const images = Array.from(doc.images);
  await Promise.all(
    images.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          img.onload = () => resolve();
          img.onerror = () => resolve();
        })
    )
  );

  const body = doc.body;
  const canvas = await html2canvas(body, {
    scale: 2,
    useCORS: true,
    logging: false,
    backgroundColor: "#ffffff",
    windowWidth: body.scrollWidth,
    windowHeight: body.scrollHeight
  });

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  /* Side margins come from HTML body padding so they stay proportional on every page. */
  const imgWidth = pageWidth;
  const imgHeight = (canvas.height * imgWidth) / canvas.width;
  const imgData = canvas.toDataURL("image/jpeg", 0.92);

  let heightLeft = imgHeight;
  let position = 0;

  pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    position = heightLeft - imgHeight;
    pdf.addPage();
    pdf.addImage(imgData, "JPEG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  iframe.remove();
  return pdf.output("blob");
}

export type CustomerAccountStatementOptions = {
  customer: Customer;
  ledger: LedgerEntry[];
  companyName?: string;
  logoUrl?: string;
  fromDate?: string;
  toDate?: string;
};

async function buildStatementPdfBlob(
  options: CustomerAccountStatementOptions
): Promise<Blob> {
  const filtered = filterLedgerForStatement(options.ledger, options.fromDate, options.toDate);
  if (filtered.length === 0) {
    throw new Error("No account history entries in the selected date range.");
  }
  const logoUrl = await resolveCompanyLogoUrl(options.logoUrl);
  return htmlToPdfBlob(
    buildCustomerAccountStatementHtml({
      ...options,
      ledger: filtered,
      logoUrl
    })
  );
}

export async function printCustomerAccountStatement(
  options: CustomerAccountStatementOptions
): Promise<void> {
  const blob = await buildStatementPdfBlob(options);
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  if (!win) {
    downloadBlob(blob, statementFilename(options.customer));
    URL.revokeObjectURL(url);
    throw new Error("Pop-up blocked. The account statement PDF was downloaded instead.");
  }
  win.addEventListener("load", () => {
    try {
      win.focus();
      win.print();
    } catch {
      /* browser may block auto-print; user can print from the PDF tab */
    }
  });
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function downloadCustomerAccountStatement(
  options: CustomerAccountStatementOptions
): Promise<void> {
  const blob = await buildStatementPdfBlob(options);
  downloadBlob(blob, statementFilename(options.customer));
}
