import type { DashboardNavItem } from "../app/DashboardShell";

export const PLATFORM_NAV: DashboardNavItem[] = [
  { kind: "link", to: "companies", label: "Companies" },
  { kind: "link", to: "subscriptions", label: "Subscription Management" },
  {
    kind: "group",
    id: "products",
    label: "Products",
    children: [
      { kind: "link", to: "products/banking", label: "Agency Banking" },
      { kind: "link", to: "products/susu", label: "Susu Management" },
      { kind: "link", to: "products/loans", label: "Loans" },
      { kind: "link", to: "products/treasury", label: "Treasury" },
      { kind: "link", to: "products/reports", label: "Reports & Analytics" }
    ]
  },
  {
    kind: "group",
    id: "addons",
    label: "Add-ons",
    children: [
      { kind: "link", to: "addons/mobile-money", label: "Mobile Money Integration" },
      { kind: "link", to: "addons/sms", label: "SMS Notifications" },
      { kind: "link", to: "addons/email", label: "Email Notifications" },
      { kind: "link", to: "addons/api", label: "API Access" },
      { kind: "link", to: "addons/multi-branch", label: "Multi-Branch" },
      { kind: "link", to: "addons/analytics", label: "Advanced Analytics" },
      { kind: "link", to: "addons/bulk-import", label: "Bulk Import" },
      { kind: "link", to: "addons/branding", label: "Custom Branding" }
    ]
  },
  { kind: "link", to: "live-chat", label: "Live chat" }
];
