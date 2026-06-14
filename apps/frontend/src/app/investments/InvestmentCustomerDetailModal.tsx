import { useState } from "react";
import type { InvestmentFormConfig, InvestmentRecord } from "@bms/shared";
import { Modal } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { InvestmentDetailsView } from "./InvestmentDetailsView";
import { downloadInvestmentCustomerDetailsPdf } from "./investmentPrint";

type Props = {
  open: boolean;
  investment: InvestmentRecord | null;
  formConfig: InvestmentFormConfig | null;
  onClose: () => void;
};

export function InvestmentCustomerDetailModal({ open, investment, formConfig, onClose }: Props) {
  const { showToast } = useToast();
  const [downloading, setDownloading] = useState(false);

  if (!investment || !formConfig) {
    return null;
  }

  const record = investment;
  const config = formConfig;

  const subtitle = [record.productName, record.customerPhone, record.status]
    .filter(Boolean)
    .join(" · ");

  async function handleDownloadPdf() {
    setDownloading(true);
    try {
      await downloadInvestmentCustomerDetailsPdf(record, config);
      showToast("Customer record downloaded as PDF", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to download PDF", "error");
    } finally {
      setDownloading(false);
    }
  }

  return (
    <Modal
      open={open}
      title={record.customerName}
      subtitle={subtitle || "Investment customer record"}
      onClose={onClose}
      panelClassName="modal-panel--70 modal-panel--customer"
      footer={
        <>
          <button
            type="button"
            className="button primary"
            disabled={downloading}
            onClick={() => void handleDownloadPdf()}
          >
            {downloading ? "Preparing PDF…" : "Download PDF"}
          </button>
          <button type="button" className="button secondary" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <InvestmentDetailsView investment={record} formConfig={config} />
    </Modal>
  );
}
