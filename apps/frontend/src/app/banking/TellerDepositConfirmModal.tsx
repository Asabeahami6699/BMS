type DepositPreview = {
  accountHolderName: string;
  accountTypeLabel?: string;
  amount: number;
  amountInWords?: string;
  branchName: string;
  productLabel?: string;
  accountNumber?: string;
  depositorName?: string;
  commission?: number;
  notes?: string;
  queuesForBackOffice: boolean;
};

type Props = {
  open: boolean;
  preview: DepositPreview | null;
  confirming?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

function money(amount: number): string {
  return new Intl.NumberFormat("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(amount);
}

export function TellerDepositConfirmModal({
  open,
  preview,
  confirming = false,
  onConfirm,
  onCancel
}: Props) {
  if (!open || !preview) {
    return null;
  }

  return (
    <div className="session-expiry-backdrop" role="presentation" onClick={onCancel}>
      <div
        className="modal-panel teller-deposit-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="teller-deposit-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="modal-header">
          <div>
            <h2 id="teller-deposit-confirm-title">Confirm deposit</h2>
            <p className="muted modal-subtitle">Review the details before recording this deposit.</p>
          </div>
        </header>
        <div className="modal-body teller-deposit-confirm__body">
          <dl className="teller-deposit-confirm__list">
            <div>
              <dt>Account holder</dt>
              <dd>
                <strong>{preview.accountHolderName}</strong>
                {preview.accountTypeLabel ? (
                  <span className="muted teller-deposit-confirm__type"> · {preview.accountTypeLabel}</span>
                ) : null}
              </dd>
            </div>
            <div>
              <dt>Branch</dt>
              <dd>{preview.branchName}</dd>
            </div>
            <div>
              <dt>Amount</dt>
              <dd>
                <strong>GHS {money(preview.amount)}</strong>
                {preview.amountInWords ? (
                  <span className="muted teller-deposit-confirm__amount-words"> · {preview.amountInWords}</span>
                ) : null}
              </dd>
            </div>
            {preview.productLabel ? (
              <div>
                <dt>Deposit product</dt>
                <dd>{preview.productLabel}</dd>
              </div>
            ) : null}
            {preview.accountNumber ? (
              <div>
                <dt>Account / phone</dt>
                <dd>{preview.accountNumber}</dd>
              </div>
            ) : null}
            {preview.depositorName ? (
              <div>
                <dt>Depositor</dt>
                <dd>{preview.depositorName}</dd>
              </div>
            ) : null}
            {preview.commission != null && preview.commission > 0 ? (
              <div>
                <dt>Commission</dt>
                <dd>GHS {money(preview.commission)}</dd>
              </div>
            ) : null}
            {preview.notes ? (
              <div>
                <dt>Notes</dt>
                <dd>{preview.notes}</dd>
              </div>
            ) : null}
          </dl>
          <p className="muted teller-deposit-confirm__hint">
            {preview.queuesForBackOffice
              ? "This deposit will queue for back-office bank execution."
              : "This deposit will credit the customer account immediately."}
          </p>
        </div>
        <footer className="modal-footer teller-deposit-confirm__actions">
          <button type="button" className="button secondary" onClick={onCancel} disabled={confirming}>
            Go back
          </button>
          <button
            type="button"
            className="button primary"
            onClick={onConfirm}
            disabled={confirming}
          >
            {confirming ? "Verifying…" : "Record deposit"}
          </button>
        </footer>
      </div>
    </div>
  );
}

export type { DepositPreview };
