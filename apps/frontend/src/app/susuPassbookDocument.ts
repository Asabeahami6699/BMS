import { formatAccountAmount, type SusuPassbookCard as SusuPassbookCardModel } from "@bms/shared";
import { getCompanyProfile } from "./api";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export async function printSusuPassbookCard(options: {
  card: SusuPassbookCardModel;
  customerName: string;
  accountNumber?: string;
  companyName?: string;
}): Promise<void> {
  const { card, customerName, accountNumber } = options;
  let companyName = options.companyName?.trim() || "Company";
  let logoUrl: string | undefined;
  try {
    const profile = await getCompanyProfile();
    if (profile.name?.trim()) companyName = profile.name.trim();
    if (profile.logoUrl?.startsWith("data:image/")) logoUrl = profile.logoUrl;
  } catch {
    /* non-blocking */
  }

  const isCancelled = card.status === "closed";
  const statusLabel =
    card.status === "matured" ? "COMPLETED" : isCancelled ? "CANCELLED (SETTLED)" : "ACTIVE";

  const boxesHtml = card.boxes
    .map((b) => {
      const cls =
        b.status === "checked"
          ? "box box--checked"
          : b.status === "partial"
            ? "box box--partial"
            : "box";
      const amt =
        b.status === "checked"
          ? `✓ ${formatAccountAmount(b.filledAmount)}`
          : b.status === "partial"
            ? `${formatAccountAmount(b.filledAmount)}/${formatAccountAmount(b.targetAmount)}`
            : "—";
      const dt = b.filledAt
        ? new Date(b.filledAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })
        : "";
      return `<div class="${cls}">
        <div class="box__top"><span>#${b.boxNumber}</span>${b.isFeeBox ? '<span class="fee">FEE</span>' : ""}</div>
        <div class="box__val">${escapeHtml(amt)}</div>
        <div class="box__dt">${escapeHtml(dt)}</div>
      </div>`;
    })
    .join("");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Susu Passbook — ${escapeHtml(customerName)} (Page #${card.cycleNumber})</title>
<style>
  @page { size: A4 portrait; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; color: #0f172a; margin: 0; font-size: 12px; }
  .head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #0f172a; padding-bottom: 10px; margin-bottom: 12px; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { width: 40px; height: 40px; object-fit: contain; border-radius: 6px; }
  .brand h1 { margin: 0; font-size: 16px; }
  .brand p { margin: 2px 0 0; color: #475569; font-size: 11px; }
  .badge { display: inline-block; padding: 3px 9px; border-radius: 999px; font-weight: 700; font-size: 11px; background: #e2e8f0; }
  .badge--cancelled { background: #fee2e2; color: #b91c1c; }
  .badge--matured { background: #dcfce7; color: #15803d; }
  .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-bottom: 12px; }
  .meta-box { border: 1px solid #cbd5e1; border-radius: 8px; padding: 7px 9px; background: #f8fafc; }
  .meta-box span { display: block; font-size: 10px; text-transform: uppercase; color: #475569; }
  .meta-box strong { display: block; font-size: 13px; margin-top: 2px; }
  .bbf { border: 1px solid #93c5fd; background: #eff6ff; color: #1e3a8a; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; font-size: 11.5px; }
  .cancelled-banner { border: 1px solid #fca5a5; background: #fef2f2; color: #991b1b; border-radius: 8px; padding: 8px 10px; margin-bottom: 10px; font-size: 11.5px; }
  .grid-wrap { position: relative; }
  .grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; }
  .box { border: 1px solid #cbd5e1; border-radius: 6px; padding: 6px; min-height: 58px; display: flex; flex-direction: column; justify-content: space-between; }
  .box--checked { border-color: #16a34a; background: #f0fdf4; }
  .box--partial { border-color: #d97706; background: #fffbeb; }
  .box__top { display: flex; justify-content: space-between; font-size: 10px; font-weight: 700; color: #475569; }
  .fee { background: #dbeafe; color: #1d4ed8; padding: 0 4px; border-radius: 4px; font-size: 9px; }
  .box__val { font-size: 11px; font-weight: 700; color: #0f172a; }
  .box__dt { font-size: 9.5px; color: #64748b; }
  .cancel-slash { position: absolute; inset: 0; pointer-events: none; background: linear-gradient(to bottom right, transparent 48.5%, rgba(220,38,38,0.6) 49.3%, rgba(220,38,38,0.6) 50.7%, transparent 51.5%); }
  .foot { margin-top: 14px; font-size: 10px; color: #64748b; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <header class="head">
    <div class="brand">
      ${logoUrl ? `<img src="${logoUrl}" alt="" />` : ""}
      <div>
        <h1>${escapeHtml(companyName)}</h1>
        <p>Official Virtual Susu Passbook · Page #${card.cycleNumber}</p>
      </div>
    </div>
    <div>
      <span class="badge ${isCancelled ? "badge--cancelled" : card.status === "matured" ? "badge--matured" : ""}">${statusLabel}</span>
    </div>
  </header>

  <section class="meta">
    <div class="meta-box"><span>Customer</span><strong>${escapeHtml(customerName)}</strong></div>
    <div class="meta-box"><span>Account no.</span><strong>${escapeHtml(accountNumber || "—")}</strong></div>
    <div class="meta-box"><span>Daily rate</span><strong>GHS ${formatAccountAmount(card.dailyContributionAmount)}</strong></div>
    <div class="meta-box"><span>Boxes filled</span><strong>${card.checkedBoxes} / ${card.cycleDays}</strong></div>
  </section>

  ${
    (card.balanceBroughtForward ?? 0) > 0
      ? `<div class="bbf"><strong>Balance Brought Forward (BBF):</strong> GHS ${formatAccountAmount(card.balanceBroughtForward ?? 0)} (carried over from previous settled page · spent first at GHS 0 fee)</div>`
      : ""
  }
  ${
    isCancelled
      ? `<div class="cancelled-banner"><strong>Page cancelled:</strong> Settled by withdrawal. Leftover savings (if any) rolled forward as Balance Brought Forward (BBF) onto the next card.</div>`
      : ""
  }

  <div class="grid-wrap">
    <div class="grid">${boxesHtml}</div>
    ${isCancelled ? '<div class="cancel-slash"></div>' : ""}
  </div>

  <footer class="foot">
    <span>Total gross on card: GHS ${formatAccountAmount(card.grossContributions)} · Fee collected: GHS ${formatAccountAmount(card.commissionCollected)}</span>
    <span>Printed: ${escapeHtml(new Date().toLocaleString())}</span>
  </footer>
</body>
</html>`;

  await printHtmlViaIframe(html);
}

function printHtmlViaIframe(html: string): Promise<void> {
  return new Promise((resolve, reject) => {
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

    const triggerPrint = () => {
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
    };

    // Wait briefly so inline images (company logo data URL) finish decoding before print.
    window.setTimeout(triggerPrint, 120);
  });
}
