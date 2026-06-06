import type { AiLoanReviewRequest } from "@bms/shared";
import type { LoanReviewSnapshot } from "./loanDocument";

export function loanReviewSnapshotToAiRequest(
  snapshot: LoanReviewSnapshot,
  options?: { loanType?: "individual" | "group_solidarity" }
): AiLoanReviewRequest {
  const q = snapshot.qualification;
  return {
    loanType: options?.loanType ?? (snapshot.groupName ? "group_solidarity" : "individual"),
    groupName: snapshot.groupName,
    productName: snapshot.productName,
    principalAmount: snapshot.principalAmount,
    interestRatePercent: snapshot.interestRatePercent,
    termMonths: snapshot.termMonths,
    repaymentFrequency: snapshot.repaymentFrequency,
    installmentAmount: snapshot.installmentAmount,
    totalRepayable: snapshot.totalRepayable,
    applicantName: snapshot.applicant.fullName,
    occupation: q.occupation?.trim() || undefined,
    monthlyIncome: q.monthlyIncome,
    monthlyExpenses: q.monthlyExpenses,
    existingLoanBalance: q.existingLoanBalance,
    loanPurpose: q.loanPurpose,
    guarantorName: q.guarantor.fullName?.trim() || undefined,
    guarantorRelationship: q.guarantor.relationship?.trim() || undefined,
    hasPassportPhoto: Boolean(snapshot.applicant.photoUrl),
    hasIdPhoto: Boolean(snapshot.applicant.idCardPhotoUrl)
  };
}
