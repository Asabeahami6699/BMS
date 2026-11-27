import { formatAccountAmount } from "@bms/shared";
import type { SusuClosingBalanceSnapshot } from "./api";
import { getCompanyProfile } from "./api";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(amount: number): string {
  return `GHS ${formatAccountAmount(amount)}`;
}

export async function printBranchEodSummary(options: {
  snapshot: SusuClosingBalanceSnapshot;
  branchLabel: string;
  companyName?: string;
  preparedBy?: string;
}): Promise<void> {
  const { snapshot, branchLabel } = options;
  let companyName = options.companyName?.trim() || "Company";
  let logoUrl: string | undefined;
  try {
    const profile = await getCompanyProfile();
    if (profile.name?.trim()) companyName = profile.name.trim();
    if (profile.logoUrl?.startsWith("data:image/")) logoUrl = profile.logoUrl;
  } catch {
    /* non-blocking */
  }

  const counted = snapshot.closingVaultCounted;
  const variance =
    snapshot.vaultCountVariance ??
    (counted != null ? Math.round((counted - snapshot.expectedClosingVault) * 100) / 100 : null);
  const printedAt = new Date().toLocaleString();

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Daily Branch EOD Sign-Off — ${escapeHtml(branchLabel)} (${escapeHtml(snapshot.businessDate)})</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; margin: 0; font-size: 12px; line-height: 1.45; }
  .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 14px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 42px; height: 42px; object-fit: contain; border-radius: 6px; }
  .brand h1 { margin: 0; font-size: 16px; }
  .brand p { margin: 2px 0 0; color: #475569; font-size: 11px; }
  .meta { text-align: right; font-size: 11px; color: #334155; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 14px; }
  .kpi { border: 1px solid #cbd5e1; border-radius: 8px; padding: 8px 10px; background: #f8fafc; }
  .kpi span { display: block; font-size: 10px; text-transform: uppercase; letter-spacing: 0.04em; color: #475569; }
  .kpi strong { display: block; font-size: 14px; margin-top: 2px; font-variant-numeric: tabular-nums; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  th, td { border: 1px solid #cbd5e1; padding: 6px 9px; text-align: left; }
  th { background: #f1f5f9; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: #334155; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; font-weight: 600; }
  tr.total td { background: #e2e8f0; font-weight: 700; }
  .note { border: 1px solid #cbd5e1; border-radius: 6px; padding: 8px 10px; margin-bottom: 18px; background: #f8fafc; }
  .sigs { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-top: 26px; }
  .sig { border-top: 1px solid #334155; padding-top: 6px; font-size: 11px; color: #334155; }
  .sig strong { display: block; color: #0f172a; }
  .foot { margin-top: 18px; font-size: 10px; color: #64748b; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <header class="head">
    <div class="brand">
      ${logoUrl ? `<img src="${logoUrl}" alt="" />` : ""}
      <div>
        <h1>${escapeHtml(companyName)}</h1>
        <p>Daily Branch Vault End-of-Day Sign-Off Report</p>
      </div>
    </div>
    <div class="meta">
      <div><strong>Branch:</strong> ${escapeHtml(branchLabel)}</div>
      <div><strong>Business date:</strong> ${escapeHtml(snapshot.businessDate)}</div>
      <div><strong>Status:</strong> ${snapshot.usingSavedInputs ? "Saved" : "Draft (not yet saved)"}</div>
    </div>
  </header>

  <section class="kpis">
    <div class="kpi"><span>Opening vault</span><strong>${money(snapshot.openingVault)}</strong></div>
    <div class="kpi"><span>Expected closing vault</span><strong>${money(snapshot.expectedClosingVault)}</strong></div>
    <div class="kpi"><span>Physical vault count</span><strong>${counted != null ? money(counted) : "Not counted"}</strong></div>
    <div class="kpi"><span>Vault variance</span><strong>${variance != null ? `${variance >= 0 ? "+" : ""}${money(variance)}` : "—"}</strong></div>
  </section>

  <table>
    <thead>
      <tr>
        <th>Cash flow line item</th>
        <th style="text-align:right">Amount (GHS)</th>
      </tr>
    </thead>
    <tbody>
      <tr><td>Opening vault balance (Suggested: ${money(snapshot.suggestedOpeningVault)})</td><td class="num">${money(snapshot.openingVault)}</td></tr>
      <tr><td>+ Business capital added today</td><td class="num">+${money(snapshot.capitalInjectedToday ?? 0)}</td></tr>
      <tr><td>− Business capital drawings today</td><td class="num">−${money(snapshot.capitalDrawingsToday ?? 0)}</td></tr>
      <tr><td>− Cash issued to teller tills (${snapshot.tillSessionCount} session(s))</td><td class="num">−${money(snapshot.tillPhysicalCash)}</td></tr>
      <tr><td>+ Closed teller tills returned to vault</td><td class="num">+${money(snapshot.cashReturnedFromClosedTills)}</td></tr>
      <tr><td>+ Field agent callover deposits posted</td><td class="num">+${money(snapshot.fieldAgentDeposits)}</td></tr>
      ${(snapshot.directToVaultDeposits ?? 0) > 0 ? `<tr><td>+ Direct / approval deposits (off-till into vault)</td><td class="num">+${money(snapshot.directToVaultDeposits ?? 0)}</td></tr>` : ""}
      <tr><td>− Field agent withdrawals from vault</td><td class="num">−${money(snapshot.fieldAgentWithdrawals)}</td></tr>
      ${(snapshot.directFromVaultWithdrawals ?? 0) > 0 ? `<tr><td>− Direct withdrawals (off-till from vault)</td><td class="num">−${money(snapshot.directFromVaultWithdrawals ?? 0)}</td></tr>` : ""}
      <tr><td>− Cash banked (Cash to bank)</td><td class="num">−${money(snapshot.cashToBank)}</td></tr>
      <tr><td>− Extra branch expenses</td><td class="num">−${money(Math.max(0, snapshot.susuExpenses - snapshot.tillExpenses))}</td></tr>
      <tr class="total"><td>Expected closing vault (in safe)</td><td class="num">${money(snapshot.expectedClosingVault)}</td></tr>
      <tr><td>Cash still held in open teller tills</td><td class="num">${money(snapshot.cashStillInOpenTills)}</td></tr>
      <tr class="total"><td>Total branch cash position (vault + open tills)</td><td class="num">${money(snapshot.branchCashPosition)}</td></tr>
    </tbody>
  </table>

  <div class="note">
    <strong>Notes / remarks:</strong> ${escapeHtml(snapshot.notes?.trim() || "None recorded.")}
  </div>

  <section class="sigs">
    <div class="sig">
      <strong>Coordinator / Prepared by</strong>
      <span>${escapeHtml(options.preparedBy || "Name & signature")}</span><br />
      <span>Date / time: __________________</span>
    </div>
    <div class="sig">
      <strong>Branch Manager</strong>
      <span>Name &amp; signature</span><br />
      <span>Date / time: __________________</span>
    </div>
    <div class="sig">
      <strong>Internal Audit / Accounts</strong>
      <span>Name &amp; signature</span><br />
      <span>Date / time: __________________</span>
    </div>
  </section>

  <footer class="foot">
    <span>Generated by ${escapeHtml(companyName)} BMS</span>
    <span>Printed: ${escapeHtml(printedAt)}</span>
  </footer>
</body>
</html>`;

  await new Promise<void>((resolve, reject) => {
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.visibility = "hidden";
    document.body.appendChild(iframe);

    const cleanup = () => {
      window.setTimeout(() => {
        if (iframe.parentNode) {
          iframe.parentNode.removeChild(iframe);
        }
      }, 1500);
    };

    const win = iframe.contentWindow;
    const doc = iframe.contentDocument ?? win?.document;
    if (!win || !doc) {
      cleanup();
      reject(new Error("Could not prepare print preview."));
      return;
    }

    doc.open();
    doc.write(html);
    doc.close();

    window.setTimeout(() => {
      try {
        win.focus();
        win.onafterprint = () => cleanup();
        win.print();
        window.setTimeout(cleanup, 60_000);
        resolve();
      } catch (err) {
        cleanup();
        reject(err instanceof Error ? err : new Error("Could not open print dialog."));
      }
    }, 120);
  });
}
