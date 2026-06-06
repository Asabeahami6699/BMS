import type { LoanApplication } from "@bms/shared";
import { LOAN_WORKFLOW_STEPS } from "./loanUi";

type Props = { application: LoanApplication };

function stepIndex(status: LoanApplication["status"]): number {
  if (status === "pending_approval") {
    return 0;
  }
  if (status === "approved") {
    return 1;
  }
  if (status === "rejected") {
    return 1;
  }
  if (status === "disbursed") {
    return 2;
  }
  return 4;
}

export function LoanStatusTimeline({ application }: Props) {
  const active = stepIndex(application.status);
  const rejected = application.status === "rejected";

  return (
    <ol className="loans-timeline" aria-label="Loan lifecycle">
      {LOAN_WORKFLOW_STEPS.map((step, index) => {
        const done = index < active || (index === 4 && application.status === "closed");
        const current =
          index === active ||
          (rejected && index === 1) ||
          (application.status === "disbursed" && index === 3) ||
          (application.status === "closed" && index === 4);
        const failed = rejected && index === 1;

        return (
          <li
            key={step.key}
            className={`loans-timeline__step${done ? " loans-timeline__step--done" : ""}${
              current ? " loans-timeline__step--current" : ""
            }${failed ? " loans-timeline__step--failed" : ""}`}
          >
            <span className="loans-timeline__dot">{done && !failed ? "✓" : index + 1}</span>
            <span className="loans-timeline__label">{step.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
