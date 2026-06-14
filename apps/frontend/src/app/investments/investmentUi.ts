import type { InvestmentFormConfig, InvestmentFormField } from "@bms/shared";

export function formatInvestmentMoney(value: number): string {
  return new Intl.NumberFormat("en-GH", {
    style: "currency",
    currency: "GHS",
    minimumFractionDigits: 2
  }).format(value);
}

export function visibleInvestmentFields(config: InvestmentFormConfig): InvestmentFormField[] {
  const sectionOrder = new Map(config.sections.map((s) => [s.id, s.sortOrder]));
  return [...config.fields]
    .filter((field) => field.requirement !== "hidden")
    .sort((a, b) => {
      const sectionDiff = (sectionOrder.get(a.sectionId) ?? 0) - (sectionOrder.get(b.sectionId) ?? 0);
      if (sectionDiff !== 0) {
        return sectionDiff;
      }
      return a.sortOrder - b.sortOrder;
    });
}

export function investmentSectionsOrdered(config: InvestmentFormConfig) {
  return [...config.sections].sort((a, b) => a.sortOrder - b.sortOrder);
}
