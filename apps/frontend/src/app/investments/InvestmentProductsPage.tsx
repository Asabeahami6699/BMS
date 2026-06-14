import { useMemo, useState } from "react";
import { INVESTMENT_PRODUCT_TYPE_LABELS } from "@bms/shared";
import type { AppRole } from "../api";
import { updateInvestmentProductApi } from "../api";
import { RowActionsMenu, type RowActionItem } from "../../components/RowActionsMenu";
import { useToast } from "../../components/Toast";
import { useInvestmentPermissions } from "../hooks/useInvestmentPermissions";
import { useInvestmentStore } from "../stores/investmentStore";
import { CreateInvestmentProductModal } from "./CreateInvestmentProductModal";
import { EditInvestmentProductTiersModal } from "./EditInvestmentProductTiersModal";
import { formatInvestmentMoney } from "./investmentUi";
import { InvestmentsLayout } from "./InvestmentsLayout";

type Props = { role: AppRole };

function formatTierSummary(
  product: {
    defaultRatePercent: number;
    defaultTenureDays: number;
    rateTiers?: Array<{ tenureDays: number; ratePercent: number }>;
  }
): string {
  const tiers = product.rateTiers ?? [];
  if (!tiers.length) {
    return `${product.defaultTenureDays}d · ${product.defaultRatePercent}%`;
  }
  return tiers.map((tier) => `${tier.tenureDays}d · ${tier.ratePercent}%`).join(", ");
}

export function InvestmentProductsPage({ role: _role }: Props) {
  const { canManageProducts } = useInvestmentPermissions();
  const products = useInvestmentStore((s) => s.products);
  const upsertProduct = useInvestmentStore((s) => s.upsertProduct);
  const { showToast } = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [editProduct, setEditProduct] = useState<(typeof products)[number] | null>(null);

  async function toggleStatus(productId: string, status: "active" | "inactive") {
    try {
      const product = await updateInvestmentProductApi(productId, { status });
      upsertProduct(product);
      showToast(status === "active" ? "Product activated" : "Product deactivated", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to update product", "error");
    }
  }

  function buildProductActions(product: (typeof products)[number]): RowActionItem[] {
    return [
      { label: "Edit tiers", onClick: () => setEditProduct(product) },
      {
        label: product.status === "active" ? "Deactivate" : "Activate",
        onClick: () => void toggleStatus(product.id, product.status === "active" ? "inactive" : "active")
      }
    ];
  }

  const activeCount = useMemo(() => products.filter((p) => p.status === "active").length, [products]);

  return (
    <InvestmentsLayout
      activeNav="products"
      title="Products & rates"
      subtitle={`${activeCount} active product${activeCount === 1 ? "" : "s"}`}
      actions={
        canManageProducts ? (
          <button type="button" className="button primary" onClick={() => setCreateOpen(true)}>
            Create product
          </button>
        ) : null
      }
    >
      <section className="overview-panel">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Tiers</th>
              <th>Range</th>
              <th>Status</th>
              {canManageProducts ? <th className="admin-table__actions-col">Action</th> : null}
            </tr>
          </thead>
          <tbody>
            {products.map((p) => (
              <tr key={p.id}>
                <td>{p.name}</td>
                <td>{INVESTMENT_PRODUCT_TYPE_LABELS[p.productType]}</td>
                <td>{formatTierSummary(p)}</td>
                <td>
                  {formatInvestmentMoney(p.minAmount)} – {formatInvestmentMoney(p.maxAmount)}
                </td>
                <td>
                  <span className={`status-pill status-pill--${p.status === "active" ? "active" : "inactive"}`}>
                    {p.status}
                  </span>
                </td>
                {canManageProducts ? (
                  <td className="admin-table__actions-col">
                    <RowActionsMenu
                      triggerLabel="Action"
                      ariaLabel={`Actions for ${p.name}`}
                      items={buildProductActions(p)}
                    />
                  </td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
        {products.length === 0 ? <p className="muted">No products yet.</p> : null}
      </section>

      <CreateInvestmentProductModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => void useInvestmentStore.getState().refreshSilent()}
      />
      <EditInvestmentProductTiersModal
        open={Boolean(editProduct)}
        product={editProduct}
        onClose={() => setEditProduct(null)}
        onSaved={() => void useInvestmentStore.getState().refreshSilent()}
      />
    </InvestmentsLayout>
  );
}
