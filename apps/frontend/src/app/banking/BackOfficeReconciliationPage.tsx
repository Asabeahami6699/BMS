import { BackOfficeFiltersBar, BackOfficeReconciliationPanel } from "./BackOfficePanels";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";
import { useBackOfficeWorkspace } from "./useBackOfficeWorkspace";

type Props = { displayName?: string };

export function BackOfficeReconciliationPage({ displayName }: Props) {
  const config = getRoleDeskConfig("back_officer");
  const ws = useBackOfficeWorkspace();

  const mismatched = ws.tellerReconciliation.filter((row) => row.difference !== 0).length;

  return (
    <RoleDeskShell
      config={{
        ...config,
        title: "Teller/Back Officer reconciliation",
        subtitle: "Compare teller deposits against back-office bank execution per drawer."
      }}
      displayName={displayName}
      updatedLabel={ws.updatedLabel}
      error={ws.error}
      loading={ws.loading && !ws.data}
      kpis={[
        {
          label: "Teller drawers",
          value: ws.tellerReconciliation.length,
          tone: "primary"
        },
        {
          label: "Differences",
          value: mismatched,
          tone: mismatched > 0 ? "warning" : "success"
        }
      ]}
      onRefresh={() => void ws.refresh()}
      refreshing={ws.loading}
    >
      <BackOfficeFiltersBar ws={ws} />
      <BackOfficeReconciliationPanel ws={ws} />
    </RoleDeskShell>
  );
}
