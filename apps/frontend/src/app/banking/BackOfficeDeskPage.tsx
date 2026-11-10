import {
  BackOfficeApprovalsPanel,
  BackOfficeBalancingPanel,
  BackOfficeDepositQueuePanel,
  BackOfficeFiltersBar,
  BackOfficeReconciliationPanel
} from "./BackOfficePanels";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";
import { useBackOfficeWorkspace } from "./useBackOfficeWorkspace";

type Props = { displayName?: string };

export function BackOfficeDeskPage({ displayName }: Props) {
  const config = getRoleDeskConfig("back_officer");
  const ws = useBackOfficeWorkspace();

  return (
    <RoleDeskShell
      config={config}
      displayName={displayName}
      updatedLabel={ws.updatedLabel}
      error={ws.error}
      loading={ws.loading && !ws.data}
      kpis={ws.kpis}
      onRefresh={() => void ws.refresh()}
      refreshing={ws.loading}
    >
      <BackOfficeFiltersBar ws={ws} />
      <BackOfficeApprovalsPanel ws={ws} />
      <BackOfficeDepositQueuePanel ws={ws} />
      <BackOfficeBalancingPanel ws={ws} />
      <BackOfficeReconciliationPanel ws={ws} />
    </RoleDeskShell>
  );
}
