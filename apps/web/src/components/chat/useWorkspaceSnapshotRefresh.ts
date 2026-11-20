import { hasCompleteProviderWorkspaceSnapshot } from "@t3tools/client-runtime/providerSkills";
import type { EnvironmentId, ServerProvider } from "@t3tools/contracts";
import { useEffect, useRef } from "react";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

/** Asks the Mate's server once for a workspace's commands and skills while its snapshot is not
 * complete: the composer's demand, never repeated. A scan that comes back pending is completed by
 * the server itself, on the agent's next change or a session in that folder. */
export function useWorkspaceSnapshotRefresh({
  environmentId,
  gitCwd,
  selectedProviderEntry,
  selectedProviderStatus,
}: {
  environmentId: EnvironmentId;
  gitCwd: string | null;
  selectedProviderEntry: ProviderInstanceEntry | undefined;
  selectedProviderStatus: ServerProvider | null;
}): void {
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const askedKeysRef = useRef(new Set<string>());
  const instanceId = selectedProviderEntry?.instanceId;
  const hasWorkspaceSnapshot = hasCompleteProviderWorkspaceSnapshot(selectedProviderStatus, gitCwd);
  useEffect(() => {
    if (!gitCwd || !instanceId || hasWorkspaceSnapshot) return;
    const key = `${environmentId}:${instanceId}:${gitCwd}`;
    if (askedKeysRef.current.has(key)) return;
    askedKeysRef.current.add(key);
    void refreshProviders({ environmentId, input: { instanceId, cwd: gitCwd } });
  }, [environmentId, gitCwd, hasWorkspaceSnapshot, instanceId, refreshProviders]);
}
