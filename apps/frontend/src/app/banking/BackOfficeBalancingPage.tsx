import { BackOfficeBalancingPanel, BackOfficeFiltersBar } from "./BackOfficePanels";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";
import { useBackOfficeWorkspace } from "./useBackOfficeWorkspace";

type Props = { displayName?: string };

export function BackOfficeBalancingPage({ displayName }: Props) {
  const config = getRoleDeskConfig("back_officer");
  const ws = useBackOfficeWorkspace();

  return (
    <RoleDeskShell
      config={{
        ...config,
        title: "Account balancing",
        subtitle: "Opening balances, ecash requests, and agent-to-agent transfers."
      }}
      displayName={displayName}
      updatedLabel={ws.updatedLabel}
      error={ws.error}
      loading={ws.loading && !ws.data}
      kpis={[
        {
          label: "Company accounts",
          value: ws.accountBalances.length,
          tone: "primary"
        },
        {
          label: "Day status",
          value: ws.sessionOpen ? "Open" : "Closed",
          tone: ws.sessionOpen ? "success" : "warning"
        },
        {
          label: "Ecash requests",
          value: ws.data?.pendingEcashCount ?? 0,
          tone: "success"
        }
      ]}
      onRefresh={() => void ws.refresh()}
      refreshing={ws.loading}
    >
      <BackOfficeFiltersBar ws={ws} />
      <BackOfficeBalancingPanel ws={ws} />
    </RoleDeskShell>
  );
}
