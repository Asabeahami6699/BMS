import type { InvestmentFormConfig, InvestmentRecord } from "@bms/shared";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { embedInvestmentImages } from "./investmentImages";
import {
  buildInvestmentApplicationHtml,
  buildInvestmentCustomerDetailsHtml
} from "./investmentDocumentHtml";
import { formatInvestmentMoney } from "./investmentUi";

function certificateHtml(investment: InvestmentRecord): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Investment Certificate — ${investment.investmentNumber}</title>
  <style>body{font-family:Georgia,serif;padding:40px;} h1{text-align:center;} .meta{margin:24px 0;}</style></head>
  <body>
  <h1>Investment Certificate</h1>
  <p class="meta"><strong>Investment No:</strong> ${investment.investmentNumber}</p>
  <p><strong>Customer:</strong> ${investment.customerName}</p>
  <p><strong>Product:</strong> ${investment.productName} (${investment.productType})</p>
  <p><strong>Principal:</strong> ${formatInvestmentMoney(investment.principalAmount)}</p>
  <p><strong>Rate:</strong> ${investment.interestRatePercent}%</p>
  <p><strong>Tenure:</strong> ${investment.tenureDays} days</p>
  <p><strong>Start:</strong> ${investment.startDate}</p>
  <p><strong>Maturity:</strong> ${investment.maturityDate}</p>
  <p><strong>Expected maturity value:</strong> ${formatInvestmentMoney(investment.expectedMaturityValue)}</p>
  <p><strong>Status:</strong> ${investment.status}</p>
  </body></html>`;
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

function downloadHtml(html: string, filename: string): void {
  downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), filename);
}

async function waitForImages(root: ParentNode): Promise<void> {
  const images = Array.from(root.querySelectorAll("img"));
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
    throw new Error("Could not prepare PDF export.");
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

  const body = doc.body;
  await waitForImages(body);

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

function printHtml(html: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "none";
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument;
  if (!doc) {
    document.body.removeChild(iframe);
    throw new Error("Could not open print preview.");
  }
  doc.open();
  doc.write(html);
  doc.close();
  const trigger = () => {
    iframe.contentWindow?.focus();
    iframe.contentWindow?.print();
    window.setTimeout(() => iframe.remove(), 1000);
  };
  if (doc.readyState === "complete") {
    window.setTimeout(trigger, 150);
  } else {
    iframe.onload = () => window.setTimeout(trigger, 150);
  }
}

export function printInvestmentCertificate(investment: InvestmentRecord): void {
  printHtml(certificateHtml(investment));
}

export async function printInvestmentApplication(
  investment: InvestmentRecord,
  formConfig: InvestmentFormConfig
): Promise<void> {
  const images = await embedInvestmentImages(investment);
  printHtml(buildInvestmentApplicationHtml(investment, formConfig, images));
}

export function downloadInvestmentCertificatePdf(investment: InvestmentRecord): void {
  downloadHtml(certificateHtml(investment), `${investment.investmentNumber}-certificate.html`);
}

export async function downloadInvestmentApplicationPdf(
  investment: InvestmentRecord,
  formConfig: InvestmentFormConfig
): Promise<void> {
  const images = await embedInvestmentImages(investment);
  const html = buildInvestmentApplicationHtml(investment, formConfig, images);
  const blob = await htmlToPdfBlob(html);
  downloadBlob(blob, `${investment.investmentNumber}-application.pdf`);
}

export async function downloadInvestmentCustomerDetailsPdf(
  investment: InvestmentRecord,
  formConfig: InvestmentFormConfig
): Promise<void> {
  const images = await embedInvestmentImages(investment);
  const html = buildInvestmentCustomerDetailsHtml(investment, formConfig, images);
  const blob = await htmlToPdfBlob(html);
  downloadBlob(blob, `${investment.investmentNumber}-customer-record.pdf`);
}
