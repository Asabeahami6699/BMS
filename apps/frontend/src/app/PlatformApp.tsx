import { Navigate, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { PLATFORM_NAV } from "../config/platformNav";
import { DashboardShell } from "./DashboardShell";
import { PlatformLiveChatPage } from "./PlatformLiveChatPage";
import { CompaniesPage } from "./platform/CompaniesPage";
import { PlatformAddonPage } from "./platform/PlatformAddonPage";
import { PlatformProductPage } from "./platform/PlatformProductPage";
import { SubscriptionManagementPage } from "./platform/SubscriptionManagementPage";

function ProductRoute() {
  const { slug } = useParams();
  const map: Record<string, Parameters<typeof PlatformProductPage>[0]["product"]> = {
    banking: "banking",
    susu: "susu_management",
    loans: "loans_credit",
    treasury: "treasury",
    reports: "reports_analytics"
  };
  const product = map[slug ?? ""] ?? "banking";
  return <PlatformProductPage product={product} />;
}

function AddonRoute() {
  const { slug } = useParams();
  return <PlatformAddonPage slug={slug ?? ""} />;
}

export function PlatformApp() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const displayName = user?.fullName ?? user?.email?.split("@")[0] ?? "Super Admin";

  async function handleLogout() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <DashboardShell
      workspaceSubtitle="Register tenants and manage company subscriptions."
      navItems={PLATFORM_NAV}
      companyName="BMS Platform"
      userName={displayName}
      userRole="super admin"
      onLogout={handleLogout}
    >
      <Routes>
        <Route path="/" element={<Navigate to="companies" replace />} />
        <Route path="/companies" element={<CompaniesPage />} />
        <Route path="/subscriptions" element={<SubscriptionManagementPage />} />
        <Route path="/products/:slug" element={<ProductRoute />} />
        <Route path="/addons/:slug" element={<AddonRoute />} />
        <Route path="/live-chat" element={<PlatformLiveChatPage />} />
        <Route path="*" element={<Navigate to="companies" replace />} />
      </Routes>
    </DashboardShell>
  );
}
