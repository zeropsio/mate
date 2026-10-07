/** Lazy data mentions read the account catalog projection while the composer asks for them. */
import {
  type DataMentionEntry,
  searchDataMentions,
} from "@t3tools/client-runtime/zerops/dataConsole";
import type { EnvironmentId } from "@t3tools/contracts";
import { useMemo } from "react";
import { useDatabaseCatalog, useDatabaseCatalogDemand } from "./useDatabase";
import { useZeropsDataConsole } from "./useZeropsFeeds";

const NO_MENTIONS: ReadonlyArray<DataMentionEntry> = [];

/** `query` is null when no mention is being typed: the catalog has no demand then. */
export function useZeropsDataMentions(
  environmentId: EnvironmentId | null,
  query: string | null,
): ReadonlyArray<DataMentionEntry> {
  const session = useZeropsDataConsole(environmentId);
  const catalog = useDatabaseCatalog(environmentId);
  useDatabaseCatalogDemand(
    environmentId,
    query !== null && (session?.status === "idle" || session?.status === "ready"),
  );
  return useMemo(
    () =>
      query === null || catalog.status !== "ready"
        ? NO_MENTIONS
        : searchDataMentions(catalog.entries, query),
    [catalog, query],
  );
}
