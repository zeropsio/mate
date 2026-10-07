/** Retained archives and their independent read failures; unknown never means no archived chats. */
import type { EnvironmentId } from "@t3tools/contracts";
import type { ArchivedThreadSnapshotsState } from "../../state/archivedThreads.ts";
import { archiveScope } from "../families/mateArchive.ts";
import type { Coverage } from "../model.ts";
import type { Projection } from "../store.ts";
import { sameValue } from "./equal.ts";

export interface ArchiveKey {
  readonly environmentIds: ReadonlyArray<EnvironmentId>;
  readonly connectedIds: ReadonlyArray<EnvironmentId>;
}
export interface ArchiveReading extends ArchivedThreadSnapshotsState {
  readonly failures: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly message: string;
  }>;
  readonly coverage: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly coverage: Coverage;
  }>;
}
export const mateArchive: Projection<ArchiveKey, ArchiveReading> = {
  name: "mateArchive",
  keyOf: (key) => JSON.stringify([key.environmentIds, key.connectedIds]),
  derive: (read, key) => {
    const snapshots: ArchiveReading["snapshots"][number][] = [];
    const failures: ArchiveReading["failures"][number][] = [];
    const coverage: ArchiveReading["coverage"][number][] = [];
    let isLoading = false;
    let unreadDisconnected = false;
    for (const environmentId of key.environmentIds) {
      const scope = archiveScope(environmentId);
      const stream = read.stream(scope);
      const fact = read.fact("mateArchive", environmentId);
      coverage.push({ environmentId, coverage: read.coverage(scope) });
      unreadDisconnected ||= fact.kind === "unknown" && !key.connectedIds.includes(environmentId);
      if (fact.kind === "known")
        snapshots.push({
          environmentId,
          snapshot: {
            ...fact.value,
            threads: fact.value.threads.filter((thread) => thread.crew === undefined),
          },
        });
      if (stream.fault !== null) failures.push({ environmentId, message: stream.fault.message });
      isLoading ||=
        key.connectedIds.includes(environmentId) &&
        ["idle", "connecting", "baselining"].includes(stream.phase);
    }
    return {
      snapshots,
      failures,
      coverage,
      isLoading,
      error:
        failures[0]?.message ??
        (unreadDisconnected
          ? "Connect to the remaining Mates to read their archived chats."
          : null),
    };
  },
  equals: sameValue,
};
