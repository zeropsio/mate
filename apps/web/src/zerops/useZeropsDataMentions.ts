/**
 * Component-facing read of the composer's `@` data catalog: the services and
 * tables of the project this thread runs in, matched against what the user
 * has typed so far.
 *
 * Loading is lazy and gated on the Data session reporting `idle` or
 * `ready` — the `refresh` call it makes is what starts the console, so
 * waiting for `ready` alone would wait forever in a thread that never opened
 * the Data tab. A thread with no Data session at all (no Zerops project, an
 * unsupported or unavailable engine) never issues a request and always
 * answers with nothing.
 */
import {
  type DataMentionEntry,
  searchDataMentions,
} from "@t3tools/client-runtime/zerops/dataConsole";
import type { EnvironmentId, ZeropsDataConsoleRequest } from "@t3tools/contracts";
import { useEffect, useMemo } from "react";

import { zeropsCommands } from "../state/zeropsCommands";
import { useAtomCommand } from "../state/use-atom-command";
import { useZeropsDataCatalogStore } from "./dataCatalog";
import { useZeropsDataConsole } from "./useZeropsFeeds";

const NO_MENTIONS: ReadonlyArray<DataMentionEntry> = [];

/** `query` is `null` whenever no `@` mention is being typed — nothing loads and nothing matches. */
export function useZeropsDataMentions(
  environmentId: EnvironmentId | null,
  query: string | null,
): ReadonlyArray<DataMentionEntry> {
  const callDataConsole = useAtomCommand(zeropsCommands.dataConsoleCall, {
    label: "zerops data mention catalog",
    reportFailure: false,
    reportDefect: false,
  });
  const session = useZeropsDataConsole(environmentId);
  const load = useZeropsDataCatalogStore((store) => store.load);
  const catalog = useZeropsDataCatalogStore((store) =>
    environmentId === null ? undefined : store.byEnvironment[environmentId],
  );
  const canLoad = session?.status === "idle" || session?.status === "ready";

  useEffect(() => {
    if (environmentId === null || query === null || !canLoad) return;
    void load(environmentId, async (request: ZeropsDataConsoleRequest) => {
      const result = await callDataConsole({ environmentId, input: request });
      return result._tag === "Success" ? result.value : undefined;
    });
  }, [callDataConsole, environmentId, load, query, canLoad]);

  return useMemo(
    () =>
      query === null || catalog === undefined || catalog.status !== "ready"
        ? NO_MENTIONS
        : searchDataMentions(catalog.entries, query),
    [catalog, query],
  );
}
