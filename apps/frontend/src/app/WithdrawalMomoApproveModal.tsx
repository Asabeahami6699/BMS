import { useEffect, useRef, useState } from "react";
import type { BalanceDisclosure } from "./api";
import { approveBalanceDisclosure } from "./api";
import { CameraCaptureModal } from "../components/CameraCaptureModal";
import { Modal } from "../components/Modal";
import { useToast } from "../components/Toast";
import { compressImageDataUrl, isDataUrlWithinLimit } from "../lib/imageCompress";
import { generateMomoReceiptDataUrl } from "../lib/generateMomoReceipt";
import { toUserFacingError } from "../lib/networkError";

type Props = {
  open: boolean;
  request: BalanceDisclosure | null;
  onClose: () => void;
  onApproved: () => void;
};

export function WithdrawalMomoApproveModal({ open, request, onClose, onApproved }: Props) {
  const { showToast } = useToast();
  const [reference, setReference] = useState("");
  const [proofPreview, setProofPreview] = useState<string | undefined>();
  const [proofName, setProofName] = useState<string | undefined>();
  const [receiptPreview, setReceiptPreview] = useState<string | undefined>();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const uploadRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setReference("");
      setProofPreview(undefined);
      setProofName(undefined);
      setReceiptPreview(undefined);
    }
  }, [open, request?.id]);

  useEffect(() => {
    if (!open || !request || request.fulfillmentMode !== "momo") {
      return;
    }
    void generateMomoReceiptDataUrl({
      customerName: request.customerName ?? "Customer",
      amount: request.withdrawalAmount ?? 0,
      momoNumber: request.momoNumber ?? "",
      momoAccountName: request.momoAccountName ?? "",
      payoutReference: reference.trim() || undefined
    })
      .then(setReceiptPreview)
      .catch(() => setReceiptPreview(undefined));
  }, [open, request, reference]);

  async function readProofFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      void compressImageDataUrl(dataUrl)
        .then((compressed) => {
          setProofPreview(compressed);
          setProofName(file.name);
        })
        .catch(() => showToast("Could not process image", "error"));
    };
    reader.readAsDataURL(file);
  }

  async function handleApprove() {
    if (!request?.withdrawalAmount || !request.momoNumber || !request.momoAccountName) {
      return;
    }
    if (!proofPreview) {
      showToast("Add the MoMo transaction screenshot first", "error");
      return;
    }
    setSubmitting(true);
    try {
      let proof = proofPreview;
      if (!isDataUrlWithinLimit(proof)) {
        proof = await compressImageDataUrl(proof);
      }
      const generatedReceiptImage = await generateMomoReceiptDataUrl({
        customerName: request.customerName ?? "Customer",
        amount: request.withdrawalAmount,
        momoNumber: request.momoNumber,
        momoAccountName: request.momoAccountName,
        payoutReference: reference.trim() || undefined
      });
      await approveBalanceDisclosure(request.id, {
        payoutReference: reference.trim() || undefined,
        transactionProofImage: proof,
        generatedReceiptImage
      });
      showToast("MoMo sent — receipt sent to field agent", "success");
      onApproved();
      onClose();
    } catch (error) {
      showToast(toUserFacingError(error, "Could not complete MoMo approval"), "error");
    } finally {
      setSubmitting(false);
    }
  }

  if (!request) {
    return null;
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Approve MoMo withdrawal"
        subtitle={`Send GHS ${request.withdrawalAmount?.toFixed(2)} to ${request.momoAccountName} (${request.momoNumber})`}
      >
        <p className="muted">Upload proof from your MoMo app. A receipt is generated for the field agent alert.</p>
        {request.requestReason ? <p className="muted">Agent reason: {request.requestReason}</p> : null}

        <label className="field">
          <span>Transaction reference (optional)</span>
          <input
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="e.g. MoMo transaction ID"
            disabled={submitting}
          />
        </label>

        <div className="field">
          <span>Transaction screenshot</span>
          <div className="agent-photo-actions">
            <button type="button" className="button secondary" onClick={() => setCameraOpen(true)}>
              Take photo
            </button>
            <button type="button" className="button secondary" onClick={() => uploadRef.current?.click()}>
              Upload image
            </button>
          </div>
          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            className="agent-photo-input"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void readProofFile(file);
              }
            }}
          />
          {proofPreview ? (
            <div className="agent-photo-preview">
              <img src={proofPreview} alt="Transaction proof" />
              <span className="muted">{proofName ?? "Screenshot attached"}</span>
            </div>
          ) : null}
        </div>

        {receiptPreview ? (
          <div className="field">
            <span>Receipt preview (sent to agent)</span>
            <div className="agent-photo-preview">
              <img src={receiptPreview} alt="Generated receipt preview" />
            </div>
          </div>
        ) : null}

        <div className="modal-actions">
          <button type="button" className="button secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button type="button" className="button" disabled={submitting || !proofPreview} onClick={() => void handleApprove()}>
            {submitting ? "Sending…" : "Approve & send MoMo"}
          </button>
        </div>
      </Modal>

      <CameraCaptureModal
        open={cameraOpen}
        onClose={() => setCameraOpen(false)}
        onCapture={(dataUrl, name) => {
          setProofPreview(dataUrl);
          setProofName(name);
          setCameraOpen(false);
        }}
      />
    </>
  );
}
