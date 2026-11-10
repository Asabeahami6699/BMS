import {
  BackOfficeApprovalsPanel,
  BackOfficeDepositQueuePanel,
  BackOfficeFiltersBar
} from "./BackOfficePanels";
import { getRoleDeskConfig } from "./roleDeskConfig";
import { RoleDeskShell } from "./RoleDeskShell";
import { useBackOfficeWorkspace } from "./useBackOfficeWorkspace";

type Props = { displayName?: string };

export function BackOfficeDepositQueuePage({ displayName }: Props) {
  const config = getRoleDeskConfig("back_officer");
  const ws = useBackOfficeWorkspace();

  return (
    <RoleDeskShell
      config={{
        ...config,
        title: "Deposit queue",
        subtitle: "Execute teller deposits at the partner bank and mark them done."
      }}
      displayName={displayName}
      updatedLabel={ws.updatedLabel}
      error={ws.error}
      loading={ws.loading && !ws.data}
      kpis={[
        { label: "Pending deposits", value: ws.depositQueue.length, tone: "warning" },
        {
          label: "Awaiting accountant",
          value: ws.data?.pendingAccountantCount ?? 0,
          tone: "primary"
        }
      ]}
      onRefresh={() => void ws.refresh()}
      refreshing={ws.loading}
    >
      <BackOfficeFiltersBar ws={ws} />
      <BackOfficeApprovalsPanel ws={ws} />
      <BackOfficeDepositQueuePanel ws={ws} />
    </RoleDeskShell>
  );
}
