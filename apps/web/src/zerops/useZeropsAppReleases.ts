/** Releases and repository heads from the account's HQ stream; no per-app load requests. */
import { useAtomValue } from "@effect/atom-react";
import { hqRefusalWords } from "@t3tools/client-runtime/zerops/hq";
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { Release } from "@t3tools/shared/hqRelease";
import { useMemo } from "react";

import { hqAppReadsAtom } from "../state/zerops";

export interface ZeropsAppReleases {
  readonly releases: ReadonlyMap<string, ReadonlyArray<Release>>;
  readonly repos: ReadonlyMap<string, ReadonlyArray<RepoListEntry>>;
  readonly failures: ReadonlyMap<string, string>;
}

export function useZeropsAppReleases(): ZeropsAppReleases {
  const reads = useAtomValue(hqAppReadsAtom);
  return useMemo(() => {
    const releases = new Map<string, ReadonlyArray<Release>>();
    const repos = new Map<string, ReadonlyArray<RepoListEntry>>();
    const failures = new Map<string, string>();
    // Missing keys mean unread, never an earned "no releases" for an app.
    if (reads === null) return { releases, repos, failures };
    for (const [appId, read] of reads) {
      if (read.value !== null) {
        releases.set(appId, read.value.releases);
        repos.set(appId, read.value.repos);
      }
      if (read.failure !== null)
        failures.set(
          appId,
          hqRefusalWords({ code: read.failure.code, reason: read.failure.reason ?? undefined }),
        );
    }
    return { releases, repos, failures };
  }, [reads]);
}
