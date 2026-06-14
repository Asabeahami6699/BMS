import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { InvestmentAuditEvent, InvestmentRecord } from "@bms/shared";
import type { AppRole } from "../api";
import {
  cancelInvestment,
  closeInvestment,
  getInvestmentDetail,
  listInvestmentAudit,
  redeemInvestment
} from "../api";
import { RowActionsMenu, type RowActionItem } from "../../components/RowActionsMenu";
import { useToast } from "../../components/Toast";
import { useInvestmentPermissions } from "../hooks/useInvestmentPermissions";
import { useInvestmentStore } from "../stores/investmentStore";
import { InvestmentCustomerDetailModal } from "./InvestmentCustomerDetailModal";
import { formatInvestmentMoney } from "./investmentUi";
import {
  downloadInvestmentApplicationPdf,
  downloadInvestmentCertificatePdf,
  printInvestmentApplication,
  printInvestmentCertificate
} from "./investmentPrint";
import { InvestmentsLayout } from "./InvestmentsLayout";

type Props = { role: AppRole };

export function InvestmentDetailPage({ role: _role }: Props) {
  const { investmentId = "" } = useParams();
  const formConfig = useInvestmentStore((s) => s.formConfig);
  const upsertInvestment = useInvestmentStore((s) => s.upsertInvestment);
  const { canRedeem } = useInvestmentPermissions();
  const { showToast } = useToast();
  const [investment, setInvestment] = useState<InvestmentRecord | null>(null);
  const [audit, setAudit] = useState<InvestmentAuditEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    if (!investmentId) {
      return;
    }
    setLoading(true);
    void Promise.all([getInvestmentDetail(investmentId), listInvestmentAudit(investmentId)])
      .then(([row, events]) => {
        setInvestment(row);
        setAudit(events);
        upsertInvestment(row);
      })
      .catch((error) => {
        showToast(error instanceof Error ? error.message : "Failed to load investment", "error");
      })
      .finally(() => setLoading(false));
  }, [investmentId, showToast, upsertInvestment]);

  async function runAction(action: "redeem" | "close" | "cancel") {
    if (!investment) return;
    try {
      const fn =
        action === "redeem" ? redeemInvestment : action === "close" ? closeInvestment : cancelInvestment;
      const updated = await fn(investment.id);
      setInvestment(updated);
      upsertInvestment(updated);
      showToast(`Investment ${action}d`, "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Action failed", "error");
    }
  }

  const actionItems: RowActionItem[] = useMemo(() => {
    if (!investment || !formConfig) {
      return [];
    }
    const items: RowActionItem[] = [
      {
        label: "Print certificate",
        onClick: () => {
          try {
            printInvestmentCertificate(investment);
          } catch (error) {
            showToast(error instanceof Error ? error.message : "Failed to print certificate", "error");
          }
        }
      },
      {
        label: "Print application",
        onClick: () => {
          void printInvestmentApplication(investment, formConfig).catch((error) => {
            showToast(error instanceof Error ? error.message : "Failed to print application", "error");
          });
        }
      },
      {
        label: "Download certificate PDF",
        onClick: () => {
          downloadInvestmentCertificatePdf(investment);
          showToast("Certificate downloaded", "success");
        }
      },
      {
        label: "Download application PDF",
        onClick: () => {
          void downloadInvestmentApplicationPdf(investment, formConfig)
            .then(() => showToast("Application downloaded as PDF", "success"))
            .catch((error) => {
              showToast(error instanceof Error ? error.message : "Failed to download application", "error");
            });
        }
      }
    ];
    if (canRedeem && investment.status === "active") {
      items.push(
        { label: "Redeem", onClick: () => void runAction("redeem") },
        { label: "Close", onClick: () => void runAction("close") },
        { label: "Cancel", onClick: () => void runAction("cancel"), danger: true }
      );
    }
    return items;
  }, [canRedeem, formConfig, investment, showToast]);

  if (loading) {
    return (
      <InvestmentsLayout activeNav="applications" title="Investment detail">
        <p className="muted">Loading…</p>
      </InvestmentsLayout>
    );
  }

  if (!investment || !formConfig) {
    return (
      <InvestmentsLayout activeNav="applications" title="Investment detail">
        <p className="muted">Investment not found.</p>
      </InvestmentsLayout>
    );
  }

  return (
    <InvestmentsLayout
      activeNav="applications"
      title={investment.investmentNumber}
      subtitle={`${investment.customerName} · ${investment.productName}`}
      actions={<RowActionsMenu items={actionItems} ariaLabel="Investment actions" />}
    >
      <section className="kpi-grid overview-kpis">
        <article className="kpi-card kpi-card--primary">
          <p className="kpi-label">Principal</p>
          <p className="kpi-value">{formatInvestmentMoney(investment.principalAmount)}</p>
        </article>
        <article className="kpi-card">
          <p className="kpi-label">Expected maturity</p>
          <p className="kpi-value">{formatInvestmentMoney(investment.expectedMaturityValue)}</p>
        </article>
        <article className="kpi-card kpi-card--purple">
          <p className="kpi-label">Maturity date</p>
          <p className="kpi-value">{investment.maturityDate}</p>
        </article>
        <article className="kpi-card kpi-card--success">
          <p className="kpi-label">Status</p>
          <p className="kpi-value">{investment.status}</p>
        </article>
      </section>

      <section className="overview-panel investment-detail-summary">
        <div className="investment-detail-summary__head">
          <div>
            <h2 className="overview-panel__title">Customer & application</h2>
            <p className="overview-panel__lead muted">
              {investment.customerName}
              {investment.customerPhone ? ` · ${investment.customerPhone}` : ""}
            </p>
          </div>
          <button type="button" className="button primary" onClick={() => setDetailsOpen(true)}>
            View customer details
          </button>
        </div>
        <dl className="investment-review-grid">
          <div>
            <dt>Product</dt>
            <dd>{investment.productName}</dd>
          </div>
          <div>
            <dt>Rate</dt>
            <dd>{investment.interestRatePercent}%</dd>
          </div>
          <div>
            <dt>Tenure</dt>
            <dd>{investment.tenureDays} days</dd>
          </div>
          <div>
            <dt>Branch</dt>
            <dd>{investment.branchName ?? investment.branchId}</dd>
          </div>
        </dl>
      </section>

      <section className="overview-panel">
        <h2 className="overview-panel__title">Audit trail</h2>
        {audit.length === 0 ? (
          <p className="muted">No audit events yet.</p>
        ) : (
          <ul className="investment-audit-list">
            {audit.map((event) => (
              <li key={event.id}>
                <strong>{event.action}</strong> — {event.actorName ?? event.actorUserId} —{" "}
                {new Date(event.createdAt).toLocaleString()}
              </li>
            ))}
          </ul>
        )}
      </section>

      <InvestmentCustomerDetailModal
        open={detailsOpen}
        investment={investment}
        formConfig={formConfig}
        onClose={() => setDetailsOpen(false)}
      />
    </InvestmentsLayout>
  );
}
