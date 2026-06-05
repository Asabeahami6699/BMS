import type { DashboardNavItem } from "../app/DashboardShell";

export const PLATFORM_NAV: DashboardNavItem[] = [
  { kind: "link", to: "companies", label: "Companies" },
  { kind: "link", to: "subscriptions", label: "Subscription Management" },
  {
    kind: "group",
    id: "products",
    label: "Products",
    children: [
      { to: "products/banking", label: "Banking" },
      { to: "products/susu", label: "Susu Management" },
      { to: "products/loans", label: "Loans" },
      { to: "products/treasury", label: "Treasury" },
      { to: "products/reports", label: "Reports & Analytics" }
    ]
  },
  {
    kind: "group",
    id: "addons",
    label: "Add-ons",
    children: [
      { to: "addons/mobile-money", label: "Mobile Money Integration" },
      { to: "addons/sms", label: "SMS Notifications" },
      { to: "addons/email", label: "Email Notifications" },
      { to: "addons/api", label: "API Access" },
      { to: "addons/multi-branch", label: "Multi-Branch" },
      { to: "addons/analytics", label: "Advanced Analytics" },
      { to: "addons/bulk-import", label: "Bulk Import" },
      { to: "addons/branding", label: "Custom Branding" }
    ]
  },
  { kind: "link", to: "live-chat", label: "Live chat" }
];
