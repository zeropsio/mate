import { useCallback, useMemo, useState } from "react";
import type {
  EnvironmentId,
  ProviderInstanceId,
  ServerProvider,
  UsageLimitSourceSnapshots,
} from "@t3tools/contracts";
import { collectProviderUsageLimits, hasProviderUsageLimits } from "@t3tools/shared/usageLimits";
import { usageLimitsNotice } from "./chat/UsageLimitsNotice";
import { toastManager } from "~/lib/toasts";

/** What `/usage-limits` answers in this conversation (`ConversationView`): the open answer row,
 * whether the client owns the command, and its open and clear. */
export function useUsageLimitsPanel({
  usageLimitsKey,
  routeThreadKey,
  environmentId,
  activeProviderInstanceId,
  activeProviderStatus,
  providerStatuses,
  usageLimitSources,
}: {
  usageLimitsKey: string | null;
  routeThreadKey: string;
  environmentId: EnvironmentId;
  activeProviderInstanceId: ProviderInstanceId | null;
  activeProviderStatus: ServerProvider | null;
  providerStatuses: ReadonlyArray<ServerProvider>;
  usageLimitSources: UsageLimitSourceSnapshots;
}) {
  // The open /usage-limits panel for this thread, model and turn. Only the open
  // moment is stored: the rows read live provider data, so a redeemed reset
  // credit or refreshed probe shows through. Anything that spends quota closes
  // it: a new turn from any source, or the agent resuming after an approval or
  // answered question.
  const [usageLimitsPanel, setUsageLimitsPanel] = useState<{
    readonly key: string;
    readonly threadKey: string;
    readonly now: number;
  } | null>(null);
  // Drop the snapshot as soon as the thread or model changes so it cannot resurface stale.
  if (
    usageLimitsPanel !== null &&
    usageLimitsKey !== null &&
    usageLimitsPanel.key !== usageLimitsKey
  ) {
    setUsageLimitsPanel(null);
  }
  const usageLimitsReport = useMemo(
    () =>
      usageLimitsPanel !== null &&
      usageLimitsKey !== null &&
      usageLimitsPanel.key === usageLimitsKey &&
      activeProviderInstanceId !== null
        ? collectProviderUsageLimits(
            activeProviderInstanceId,
            providerStatuses,
            usageLimitSources,
            usageLimitsPanel.now,
          )
        : null,
    [
      activeProviderInstanceId,
      providerStatuses,
      usageLimitSources,
      usageLimitsKey,
      usageLimitsPanel,
    ],
  );
  const usageLimitsAnswer = useMemo(
    () =>
      usageLimitsReport !== null && usageLimitsPanel !== null
        ? // A fresh id per opening: each answer is a row of its own.
          usageLimitsNotice(
            `usage-limits:${usageLimitsPanel.key}:${usageLimitsPanel.now}`,
            usageLimitsReport,
            environmentId,
            () => setUsageLimitsPanel(null),
          )
        : null,
    [environmentId, usageLimitsPanel, usageLimitsReport],
  );
  // The client owns /usage-limits only where Limits has data for the selected
  // provider; elsewhere the name stays the provider's own and is sent through untouched.
  const usageLimitsOffered =
    activeProviderStatus !== null &&
    hasProviderUsageLimits(activeProviderStatus.driver, providerStatuses, usageLimitSources);
  // Answered locally from the last Limits snapshot; the agent never sees it.
  const openUsageLimits = useCallback(() => {
    const now = Date.now();
    const report =
      activeProviderInstanceId !== null && usageLimitsKey !== null
        ? collectProviderUsageLimits(
            activeProviderInstanceId,
            providerStatuses,
            usageLimitSources,
            now,
          )
        : null;
    if (report && usageLimitsKey !== null) {
      setUsageLimitsPanel({ key: usageLimitsKey, threadKey: routeThreadKey, now });
      return true;
    }
    setUsageLimitsPanel(null);
    toastManager.add({ type: "info", title: "Usage limits are unavailable for this provider" });
    return false;
  }, [
    activeProviderInstanceId,
    providerStatuses,
    routeThreadKey,
    usageLimitSources,
    usageLimitsKey,
  ]);
  // Responses can resolve after navigating away; only the originating thread's panel clears.
  const clearUsageLimitsFor = useCallback(
    (threadKey: string) =>
      setUsageLimitsPanel((current) =>
        current !== null && current.threadKey === threadKey ? null : current,
      ),
    [],
  );
  return { usageLimitsAnswer, usageLimitsOffered, openUsageLimits, clearUsageLimitsFor };
}
