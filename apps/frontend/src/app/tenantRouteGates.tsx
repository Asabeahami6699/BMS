import type { ReactNode } from "react";
import {
  hasTenantModule,
  resolveAgencyRoutePermissions,
  resolveBankingRoutePermissions,
  resolveTreasuryRoutePermissions,
  type Permission,
  type TenantProductModule
} from "@bms/shared";
import type { AppRole } from "./api";
import { LoansPermissionGate } from "./loans/LoansPermissionGate";
import { InvestmentsPermissionGate } from "./investments/InvestmentsPermissionGate";
import { PermissionGate } from "./PermissionGate";
import { SettingsPermissionGate } from "./SettingsPermissionGate";
import { SusuPermissionGate } from "./SusuPermissionGate";
import type { AuthMe } from "./api";

export function AccessDenied() {
  return (
    <article className="card">
      <h2>Access Restricted</h2>
      <p className="muted">This page is not available for your role.</p>
    </article>
  );
}

type ModuleGateProps = {
  module: TenantProductModule;
  modules?: TenantProductModule[];
  children: ReactNode;
};

export function TenantModuleGate({ module, modules, children }: ModuleGateProps) {
  if (!hasTenantModule(modules, module)) {
    return (
      <article className="card">
        <h2>Product not enabled</h2>
        <p className="muted">This department is not on your company subscription.</p>
      </article>
    );
  }
  return <>{children}</>;
}

type LoansRouteProps = {
  route: string;
  modules?: TenantProductModule[];
  permissions?: Permission[];
  children: ReactNode;
};

export function TenantLoansRoute({ route, modules, permissions, children }: LoansRouteProps) {
  return (
    <TenantModuleGate module="loans_credit" modules={modules}>
      <LoansPermissionGate permissions={permissions} route={route} denied={<AccessDenied />}>
        {children}
      </LoansPermissionGate>
    </TenantModuleGate>
  );
}

type SusuRouteProps = {
  route: string;
  modules?: TenantProductModule[];
  role?: AppRole;
  permissions?: Permission[];
  susuNavVisibility?: AuthMe["susuNavVisibility"];
  children: ReactNode;
};

export function TenantSusuRoute({
  route,
  modules,
  role,
  permissions,
  susuNavVisibility,
  children
}: SusuRouteProps) {
  return (
    <TenantModuleGate module="susu_management" modules={modules}>
      <SusuPermissionGate
        role={role}
        permissions={permissions}
        route={route}
        susuNavVisibility={susuNavVisibility}
        denied={<AccessDenied />}
      >
        {children}
      </SusuPermissionGate>
    </TenantModuleGate>
  );
}

type SettingsRouteProps = {
  route: string;
  role?: AppRole;
  permissions?: Permission[];
  children: ReactNode;
};

export function TenantSettingsRoute({ route, role, permissions, children }: SettingsRouteProps) {
  return (
    <SettingsPermissionGate role={role} permissions={permissions} route={route} denied={<AccessDenied />}>
      {children}
    </SettingsPermissionGate>
  );
}

type BankingRouteProps = {
  route: string;
  modules?: TenantProductModule[];
  permissions?: Permission[];
  children: ReactNode;
};

export function TenantBankingRoute({ route, modules, permissions, children }: BankingRouteProps) {
  return (
    <TenantModuleGate module="banking" modules={modules}>
      <PermissionGate
        permissions={permissions}
        anyOf={resolveBankingRoutePermissions(route)}
        denied={<AccessDenied />}
      >
        {children}
      </PermissionGate>
    </TenantModuleGate>
  );
}

type AgencyRouteProps = {
  route: string;
  modules?: TenantProductModule[];
  permissions?: Permission[];
  children: ReactNode;
};

export function TenantAgencyRoute({ route, modules, permissions, children }: AgencyRouteProps) {
  return (
    <TenantModuleGate module="banking" modules={modules}>
      <PermissionGate
        permissions={permissions}
        anyOf={resolveAgencyRoutePermissions(route)}
        denied={<AccessDenied />}
      >
        {children}
      </PermissionGate>
    </TenantModuleGate>
  );
}

type InvestmentsRouteProps = {
  route: string;
  modules?: TenantProductModule[];
  permissions?: Permission[];
  children: ReactNode;
};

export function TenantInvestmentsRoute({ route, modules, permissions, children }: InvestmentsRouteProps) {
  return (
    <TenantModuleGate module="investment_management" modules={modules}>
      <InvestmentsPermissionGate permissions={permissions} route={route} denied={<AccessDenied />}>
        {children}
      </InvestmentsPermissionGate>
    </TenantModuleGate>
  );
}

type TreasuryRouteProps = {
  route: string;
  modules?: TenantProductModule[];
  permissions?: Permission[];
  children: ReactNode;
};

export function TenantTreasuryRoute({ route, modules, permissions, children }: TreasuryRouteProps) {
  return (
    <TenantModuleGate module="treasury" modules={modules}>
      <PermissionGate
        permissions={permissions}
        anyOf={resolveTreasuryRoutePermissions(route)}
        denied={<AccessDenied />}
      >
        {children}
      </PermissionGate>
    </TenantModuleGate>
  );
}
