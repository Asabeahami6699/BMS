import { buildLoanDocumentHtml, type LoanReviewSnapshot } from "./loanDocument";

const EMPTY_QUALIFICATION = {
  loanPurpose: "personal" as const,
  sourceOfIncome: "salary" as const,
  occupation: "",
  monthlyIncome: 0,
  guarantor: { fullName: "", phone: "", relationship: "", occupation: "", location: "" }
};

export function printLoanDocument(data: LoanReviewSnapshot, options?: { title?: string }): void {
  const html = buildLoanDocumentHtml({ data, title: options?.title });
  openAndPrint(html);
}

export function printBlankLoanForm(companyName?: string): void {
  const html = buildLoanDocumentHtml({
    blank: true,
    data: {
      companyName,
      applicant: { fullName: "", phone: "" },
      productName: "",
      principalAmount: 0,
      interestRatePercent: 0,
      termMonths: 0,
      repaymentFrequency: "monthly",
      qualification: EMPTY_QUALIFICATION
    },
    title: "Loan Application Form (Blank)"
  });
  openAndPrint(html);
}

export function downloadBlankLoanFormHtml(companyName?: string): void {
  const html = buildLoanDocumentHtml({
    blank: true,
    data: {
      companyName,
      applicant: { fullName: "", phone: "" },
      productName: "",
      principalAmount: 0,
      interestRatePercent: 0,
      termMonths: 0,
      repaymentFrequency: "monthly",
      qualification: EMPTY_QUALIFICATION
    },
    title: "Loan Application Form (Blank)"
  });
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "loan-application-form.html";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function openAndPrint(html: string): void {
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) {
    throw new Error("Pop-up blocked. Allow pop-ups to print the loan document.");
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  const trigger = () => {
    win.print();
  };
  if (win.document.readyState === "complete") {
    setTimeout(trigger, 250);
  } else {
    win.onload = () => setTimeout(trigger, 250);
  }
}
