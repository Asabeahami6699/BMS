import { useEffect } from "react";
import type { RoleWorkspaceKind } from "../stores/roleWorkspaceStore";
import { useRoleWorkspaceStore } from "../stores/roleWorkspaceStore";

export function useRoleWorkspaceSync(kind: RoleWorkspaceKind): void {
  const setKind = useRoleWorkspaceStore((s) => s.setKind);
  const hydrate = useRoleWorkspaceStore((s) => s.hydrate);
  const startLiveSync = useRoleWorkspaceStore((s) => s.startLiveSync);
  const stopLiveSync = useRoleWorkspaceStore((s) => s.stopLiveSync);

  useEffect(() => {
    setKind(kind);
    hydrate({ force: true });
    startLiveSync();
    return () => stopLiveSync();
  }, [kind, setKind, hydrate, startLiveSync, stopLiveSync]);
}
