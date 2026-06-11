import type { ReactNode } from "react";
import { getRoleDeskConfig } from "../roleDeskConfig";
import { RoleDeskShell } from "../RoleDeskShell";

type Props = {
  title: string;
  subtitle: string;
  displayName?: string;
  children: ReactNode;
  loading?: boolean;
  error?: string | null;
  updatedLabel?: string;
  onRefresh?: () => void;
  refreshing?: boolean;
};

export function HrSectionShell({
  title,
  subtitle,
  displayName,
  children,
  loading,
  error,
  updatedLabel,
  onRefresh,
  refreshing
}: Props) {
  const config = getRoleDeskConfig("hrm");
  return (
    <RoleDeskShell
      config={{ ...config, title, subtitle }}
      displayName={displayName}
      loading={loading}
      error={error}
      updatedLabel={updatedLabel}
      onRefresh={onRefresh}
      refreshing={refreshing}
    >
      {children}
    </RoleDeskShell>
  );
}
