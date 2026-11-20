import {
  hasCompleteProviderWorkspaceSnapshot,
  workspaceSnapshotRetryDelayMs,
} from "@t3tools/client-runtime/providerSkills";
import type { EnvironmentId, ScopedThreadRef, ServerProvider } from "@t3tools/contracts";
import { useEffect, useReducer, useRef, useState } from "react";
import { type DraftId, useComposerDraftWordsChange } from "../../composerDraftStore";
import type { ProviderInstanceEntry } from "../../providerInstances";
import { serverEnvironment } from "../../state/server";
import { useAtomCommand } from "../../state/use-atom-command";

/** Asks the Mate's server again for a workspace's commands and skills until its snapshot is complete,
 * spacing the asks out while scans come back without them. */
export function useWorkspaceSnapshotRefresh({
  environmentId,
  gitCwd,
  selectedProviderEntry,
  selectedProviderStatus,
  composerDraftTarget,
}: {
  environmentId: EnvironmentId;
  gitCwd: string | null;
  selectedProviderEntry: ProviderInstanceEntry | undefined;
  selectedProviderStatus: ServerProvider | null;
  composerDraftTarget: ScopedThreadRef | DraftId;
}): void {
  const refreshProviders = useAtomCommand(serverEnvironment.refreshProviders, {
    reportFailure: false,
  });
  const workspaceRefreshKeyRef = useRef<string | null>(null);
  // Scans in a row that came back without the workspace's commands; the wait
  // before the next one grows with it (workspaceSnapshotRetryDelayMs).
  const workspaceRefreshFailuresRef = useRef<{ key: string; failures: number } | null>(null);
  const [workspaceRefreshRetry, setWorkspaceRefreshRetry] = useState<{
    key: string;
    notBefore: number;
  } | null>(null);
  const workspaceRefreshScopeKey =
    gitCwd && selectedProviderEntry
      ? `${environmentId}:${selectedProviderEntry.instanceId}:${gitCwd}`
      : null;
  const workspaceSlashCommandsPending =
    selectedProviderStatus?.workspaceSnapshots?.some(
      (snapshot) => snapshot.cwd === gitCwd && snapshot.slashCommandsPending === true,
    ) ?? false;
  useEffect(() => {
    if (
      !workspaceSlashCommandsPending ||
      !workspaceRefreshRetry ||
      workspaceRefreshRetry.key !== workspaceRefreshScopeKey
    )
      return;
    const timeout = setTimeout(
      () => {
        setWorkspaceRefreshRetry((current) => (current === workspaceRefreshRetry ? null : current));
      },
      Math.max(0, workspaceRefreshRetry.notBefore - Date.now()),
    );
    return () => clearTimeout(timeout);
  }, [workspaceRefreshRetry, workspaceRefreshScopeKey, workspaceSlashCommandsPending]);
  const hadWorkspaceSnapshotRef = useRef(false);
  useEffect(() => {
    const hasWorkspaceSnapshot = hasCompleteProviderWorkspaceSnapshot(
      selectedProviderStatus,
      gitCwd,
    );
    if (hadWorkspaceSnapshotRef.current && !hasWorkspaceSnapshot) {
      workspaceRefreshKeyRef.current = null;
      workspaceRefreshFailuresRef.current = null;
      setWorkspaceRefreshRetry(null);
    }
    hadWorkspaceSnapshotRef.current = hasWorkspaceSnapshot;
  }, [gitCwd, selectedProviderStatus]);
  // A key typed asks again for a workspace whose commands have not come. The words are watched
  // for that only while they have not, and only a key that would ask draws the composer.
  const [workspaceRefreshNudge, nudgeWorkspaceRefresh] = useReducer(
    (nudges: number) => nudges + 1,
    0,
  );
  const awaitsWorkspaceSnapshot =
    workspaceRefreshScopeKey !== null &&
    !hasCompleteProviderWorkspaceSnapshot(selectedProviderStatus, gitCwd);
  useComposerDraftWordsChange(composerDraftTarget, awaitsWorkspaceSnapshot, () => {
    if (workspaceRefreshKeyRef.current === workspaceRefreshScopeKey) return;
    if (
      workspaceRefreshRetry?.key === workspaceRefreshScopeKey &&
      Date.now() < workspaceRefreshRetry.notBefore
    ) {
      return;
    }
    nudgeWorkspaceRefresh();
  });
  useEffect(() => {
    if (!gitCwd || !selectedProviderEntry) return;
    const key = `${environmentId}:${selectedProviderEntry.instanceId}:${gitCwd}`;
    const hasWorkspaceSnapshot = hasCompleteProviderWorkspaceSnapshot(
      selectedProviderStatus,
      gitCwd,
    );
    if (workspaceRefreshKeyRef.current === key) return;
    if (hasWorkspaceSnapshot) {
      workspaceRefreshKeyRef.current = key;
      workspaceRefreshFailuresRef.current = null;
      setWorkspaceRefreshRetry(null);
      return;
    }
    const retry = workspaceRefreshRetry;
    if (retry?.key === key && Date.now() < retry.notBefore) return;
    workspaceRefreshKeyRef.current = key;
    const retryLater = () => {
      if (workspaceRefreshKeyRef.current !== key) return;
      workspaceRefreshKeyRef.current = null;
      const previous = workspaceRefreshFailuresRef.current;
      const failures = previous?.key === key ? previous.failures + 1 : 1;
      workspaceRefreshFailuresRef.current = { key, failures };
      setWorkspaceRefreshRetry({
        key,
        notBefore: Date.now() + workspaceSnapshotRetryDelayMs(failures),
      });
    };
    void refreshProviders({
      environmentId,
      input: { instanceId: selectedProviderEntry.instanceId, cwd: gitCwd },
    }).then((result) => {
      const hasWorkspaceSnapshot =
        result._tag === "Success" &&
        hasCompleteProviderWorkspaceSnapshot(
          result.value.providers.find(
            (provider) => provider.instanceId === selectedProviderEntry.instanceId,
          ),
          gitCwd,
        );
      if (!hasWorkspaceSnapshot && workspaceRefreshKeyRef.current === key) {
        retryLater();
      }
    }, retryLater);
  }, [
    environmentId,
    gitCwd,
    workspaceRefreshNudge,
    refreshProviders,
    selectedProviderEntry,
    workspaceRefreshRetry,
  ]);
}
