import { Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute } from "../auth/ProtectedRoute";
import { LandingPage } from "../pages/LandingPage";
import { LoginPage } from "../pages/LoginPage";
import { PlatformApp } from "./PlatformApp";
import { TenantApp } from "./TenantApp";

export function RootApp() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/platform/*"
        element={
          <ProtectedRoute allowedRoles={["super_admin"]}>
            <PlatformApp />
          </ProtectedRoute>
        }
      />
      <Route
        path="/app/*"
        element={
          <ProtectedRoute forbiddenRoles={["super_admin"]}>
            <TenantApp />
          </ProtectedRoute>
        }
      />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
