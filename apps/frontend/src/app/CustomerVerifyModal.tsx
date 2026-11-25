import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  formatAccountAmount,
  formatIdCardTypeLabel,
  type WithdrawalVerificationReason,
  withdrawalVerificationRequirementMessage
} from "@bms/shared";
import type { Branch, Customer } from "./api";
import { useCustomerLedgerStore } from "./stores/customerLedgerStore";
import { useSusuCycleCommissionStore } from "./stores/susuCycleCommissionStore";
import { Modal } from "../components/Modal";
import { SusuPassbookCard } from "../components/SusuPassbookCard";

type Props = {
  open: boolean;
  customer: Customer | null;
  branches: Branch[];
  counterBranchId?: string;
  accountBalance: number;
  withdrawableBalance: number;
  loanReserveAmount?: number;
  lockedBalance?: number;
  verified: boolean;
  requiredReason?: WithdrawalVerificationReason | null;
  onMarkVerified: () => void;
  onClose: () => void;
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return `${parts[0]![0] ?? ""}${parts[parts.length - 1]![0] ?? ""}`.toUpperCase();
}

function formatDob(dob?: string | null): string {
  if (!dob) return "—";
  const parsed = new Date(dob);
  if (Number.isNaN(parsed.getTime())) return dob;
  return parsed.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function CustomerVerifyModal({
  open,
  customer,
  branches,
  counterBranchId,
  accountBalance,
  withdrawableBalance,
  loanReserveAmount = 0,
  lockedBalance = 0,
  verified,
  requiredReason = null,
  onMarkVerified,
  onClose
}: Props) {
  const [lightbox, setLightbox] = useState<{ src: string; label: string } | null>(null);
  const [failedPhoto, setFailedPhoto] = useState(false);
  const [failedIdPhoto, setFailedIdPhoto] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const customerId = customer?.id ?? "";
  const isSusu = (customer?.accountType ?? "susu") === "susu";

  useEffect(() => {
    setFailedPhoto(false);
    setFailedIdPhoto(false);
    setLightbox(null);
  }, [customerId, open]);

  useEffect(() => {
    if (!open || !customerId) {
      return;
    }
    const ledgerStore = useCustomerLedgerStore.getState();
    void ledgerStore.ensureDetail(customerId, { force: true });
    void ledgerStore.ensureLedger(customerId, { force: true });
    if (isSusu) {
      void useSusuCycleCommissionStore
        .getState()
        .ensureCustomerPassbook(customerId, { force: true });
    }
  }, [open, customerId, isSusu]);

  if (!customer) {
    return null;
  }

  const homeBranch = branches.find((b) => b.id === customer.homeBranchId);
  const counterBranch = counterBranchId
    ? branches.find((b) => b.id === counterBranchId)
    : undefined;
  const homeBranchLabel = homeBranch ? `${homeBranch.name} (${homeBranch.code})` : "—";
  const isCrossBranch = Boolean(
    customer.homeBranchId && counterBranchId && customer.homeBranchId !== counterBranchId
  );
  const isSimplifiedKyc = customer.kycTier === "simplified";
  const idTypeLabel = customer.idCardType ? formatIdCardTypeLabel(customer.idCardType) : "ID card";
  const address = [customer.location, customer.houseNumber].filter(Boolean).join(", ") || "—";
  const agentLabel =
    customer.assignedFieldAgentName || customer.createdByFieldAgentName || "—";
  const hasCustomerPhoto = Boolean(customer.photoUrl && !failedPhoto);
  const hasIdPhoto = Boolean(customer.idCardPhotoUrl && !failedIdPhoto);

  async function handleRefresh() {
    if (!customerId || refreshing) return;
    setRefreshing(true);
    try {
      const ledgerStore = useCustomerLedgerStore.getState();
      const tasks: Promise<unknown>[] = [
        ledgerStore.ensureDetail(customerId, { force: true }),
        ledgerStore.ensureLedger(customerId, { force: true })
      ];
      if (isSusu) {
        tasks.push(
          useSusuCycleCommissionStore
            .getState()
            .ensureCustomerPassbook(customerId, { force: true })
        );
      }
      await Promise.allSettled(tasks);
    } finally {
      setRefreshing(false);
    }
  }

  const statementUrl = `/app/susu/account-statements?customerId=${encodeURIComponent(customer.id)}&from=counter`;

  return (
    <>
      <Modal
        open={open}
        title={`Verify customer — ${customer.fullName}`}
        subtitle={`${customer.accountNumber ?? "No account #"} · ${(customer.accountType ?? "susu").replace(/_/g, " ")} · ${isSimplifiedKyc ? "Tier 1 Simplified KYC" : "Full KYC"}`}
        onClose={onClose}
        panelClassName="modal-panel--70 modal-panel--customer"
        footer={
          <div className="verify-modal__footer">
            <div className="verify-modal__footer-left">
              <Link
                to={statementUrl}
                className="button secondary"
                onClick={onClose}
              >
                Open full statement →
              </Link>
              <button
                type="button"
                className="button secondary"
                disabled={refreshing}
                onClick={() => void handleRefresh()}
              >
                {refreshing ? "Refreshing…" : "Refresh"}
              </button>
            </div>
            <div className="verify-modal__footer-right">
              <button type="button" className="button secondary" onClick={onClose}>
                Close
              </button>
              <button
                type="button"
                className="button"
                onClick={() => {
                  onMarkVerified();
                  onClose();
                }}
              >
                {verified ? "Verified ✓ — Return to counter" : "Mark verified & continue"}
              </button>
            </div>
          </div>
        }
      >
        <div className="verify-modal">
          {requiredReason && !verified ? (
            <div className="verify-modal__required" role="alert">
              <strong>Verification required for this withdrawal:</strong>{" "}
              {withdrawalVerificationRequirementMessage(requiredReason)}
            </div>
          ) : null}

          {isCrossBranch ? (
            <div className="verify-modal__cross-branch" role="status">
              <strong>Inter-branch withdrawal check:</strong> Customer&apos;s home branch is{" "}
              <strong>{homeBranchLabel}</strong>, while this counter is{" "}
              <strong>
                {counterBranch ? `${counterBranch.name} (${counterBranch.code})` : "another branch"}
              </strong>
              . Confirm the customer&apos;s face, ID document, and phone number carefully before
              paying cash.
            </div>
          ) : null}

          {isSimplifiedKyc && requiredReason !== "simplified_kyc" ? (
            <div className="verify-modal__cross-branch" role="status">
              <strong>Tier 1 Simplified KYC account:</strong> This customer has no national ID card
              on file. Confirm their photo and introducer details below before paying cash.
            </div>
          ) : null}

          <div className="verify-modal__media">
            <div className="verify-modal__media-card">
              <span className="verify-modal__media-label">Customer photo</span>
              {hasCustomerPhoto ? (
                <button
                  type="button"
                  className="verify-modal__photo-btn"
                  onClick={() =>
                    setLightbox({ src: customer.photoUrl!, label: `${customer.fullName} — Photo` })
                  }
                  title="Click to enlarge photo"
                >
                  <img
                    src={customer.photoUrl}
                    alt={`${customer.fullName} portrait`}
                    className="verify-modal__portrait"
                    onError={() => setFailedPhoto(true)}
                  />
                  <span className="verify-modal__zoom-hint">Click to enlarge</span>
                </button>
              ) : (
                <div className="verify-modal__photo-missing">
                  <span className="verify-modal__initials">{initialsFromName(customer.fullName)}</span>
                  <small className="muted">No customer photo on file</small>
                </div>
              )}
            </div>

            <div className="verify-modal__media-card">
              <span className="verify-modal__media-label">
                {isSimplifiedKyc ? "Simplified KYC (Tier 1 — Introducer)" : `${idTypeLabel} photo`}
              </span>
              {hasIdPhoto ? (
                <button
                  type="button"
                  className="verify-modal__photo-btn"
                  onClick={() =>
                    setLightbox({
                      src: customer.idCardPhotoUrl!,
                      label: `${customer.fullName} — ${idTypeLabel}`
                    })
                  }
                  title="Click to enlarge ID document"
                >
                  <img
                    src={customer.idCardPhotoUrl}
                    alt={`${customer.fullName} ID card`}
                    className="verify-modal__id-img"
                    onError={() => setFailedIdPhoto(true)}
                  />
                  <span className="verify-modal__zoom-hint">Click to enlarge</span>
                </button>
              ) : isSimplifiedKyc && customer.kycIntroducer ? (
                <div className="verify-modal__introducer">
                  <p>
                    <strong>Introducer:</strong> {customer.kycIntroducer.fullName}
                  </p>
                  <p>
                    <strong>Relationship:</strong> {customer.kycIntroducer.relationship || "—"}
                  </p>
                  <p>
                    <strong>Phone:</strong> {customer.kycIntroducer.phone || "—"}
                  </p>
                  <p>
                    <strong>Ghana Card:</strong> {customer.kycIntroducer.ghanaCardNumber || "—"}
                  </p>
                </div>
              ) : (
                <div className="verify-modal__photo-missing">
                  <small className="muted">No ID card photo uploaded</small>
                </div>
              )}
            </div>
          </div>

          <div className="verify-modal__details">
            <div className="verify-modal__detail">
              <span>Full name</span>
              <strong>{customer.fullName}</strong>
            </div>
            <div className="verify-modal__detail">
              <span>Account number</span>
              <strong>{customer.accountNumber ?? "—"}</strong>
            </div>
            <div className="verify-modal__detail">
              <span>Phone number</span>
              <strong>
                {customer.phone ? (
                  <a href={`tel:${customer.phone}`} className="verify-modal__tel">
                    {customer.phone}
                  </a>
                ) : (
                  "—"
                )}
              </strong>
            </div>
            <div className="verify-modal__detail">
              <span>{idTypeLabel} number</span>
              <strong>{customer.idCardNumber || "—"}</strong>
            </div>
            <div className="verify-modal__detail">
              <span>Date of birth</span>
              <strong>{formatDob(customer.dateOfBirth)}</strong>
            </div>
            <div className="verify-modal__detail">
              <span>Occupation</span>
              <strong>{customer.occupation || "—"}</strong>
            </div>
            <div className="verify-modal__detail">
              <span>Address</span>
              <strong>{address}</strong>
            </div>
            <div className="verify-modal__detail">
              <span>Home branch</span>
              <strong>{homeBranchLabel}</strong>
            </div>
            <div className="verify-modal__detail">
              <span>Field agent</span>
              <strong>{agentLabel}</strong>
            </div>
            <div className="verify-modal__detail">
              <span>Next of kin</span>
              <strong>
                {customer.nextOfKin?.fullName
                  ? `${customer.nextOfKin.fullName}${customer.nextOfKin.phone ? ` · ${customer.nextOfKin.phone}` : ""}`
                  : "—"}
              </strong>
            </div>
          </div>

          <div className="verify-modal__balances">
            <div className="verify-modal__balance verify-modal__balance--primary">
              <span>Account balance</span>
              <strong>GHS {formatAccountAmount(accountBalance)}</strong>
            </div>
            <div className="verify-modal__balance">
              <span>Withdrawable</span>
              <strong>GHS {formatAccountAmount(withdrawableBalance)}</strong>
            </div>
            {lockedBalance > 0 ? (
              <div className="verify-modal__balance">
                <span>Locked minimum</span>
                <strong>GHS {formatAccountAmount(lockedBalance)}</strong>
              </div>
            ) : null}
            {loanReserveAmount > 0 ? (
              <div className="verify-modal__balance">
                <span>Loan reserve</span>
                <strong>GHS {formatAccountAmount(loanReserveAmount)}</strong>
              </div>
            ) : null}
          </div>

          {isSusu ? (
            <SusuPassbookCard
              customerId={customer.id}
              customerName={customer.fullName}
              accountNumber={customer.accountNumber}
              compact
            />
          ) : null}
        </div>
      </Modal>

      <Modal
        open={Boolean(lightbox)}
        title={lightbox?.label ?? "Document preview"}
        onClose={() => setLightbox(null)}
        panelClassName="modal-panel--70"
        footer={
          <button type="button" className="button secondary" onClick={() => setLightbox(null)}>
            Close preview
          </button>
        }
      >
        {lightbox ? (
          <div className="verify-modal__lightbox">
            <img src={lightbox.src} alt={lightbox.label} />
          </div>
        ) : null}
      </Modal>
    </>
  );
}
