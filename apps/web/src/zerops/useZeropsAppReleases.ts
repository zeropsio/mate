/**
 * Each application's releases (`GET /api/apps/:appId/releases`), and the repositories a release
 * reads with them (`GET /api/apps/:appId/repos`: each production runtime's `main`, and the
 * recipe's, which a release tags), read as the person through the organization's official HQ.
 * The one read of an application's repositories: the Git page lists them from the flow.
 *
 * An application is read once, and again only when its reason moves — HQ's stream saying its
 * releases or repositories moved, its production's deploys moving, a release just made — never on
 * a clock (audit R4). Each on its own: one HQ is slow to answer for holds no other back. One whose
 * read fails keeps what it read before and says why beside it, and never takes another's answer
 * with it — nor ever answers "no releases".
 */
import type { RepoListEntry } from "@t3tools/shared/hqChanges";
import type { Release } from "@t3tools/shared/hqRelease";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useOfficialHq } from "./accountHq";

export interface ZeropsAppReleases {
  /** Each application's releases, newest first by version, as HQ last listed them. */
  readonly releases: ReadonlyMap<string, ReadonlyArray<Release>>;
  /** Each application's repositories, read with its releases. */
  readonly repos: ReadonlyMap<string, ReadonlyArray<RepoListEntry>>;
  /** Why an application's last read did not answer, beside what it read before. */
  readonly failures: ReadonlyMap<string, string>;
  /** Reads one application's again at once: what a release or a rollback of it changed. */
  readonly refresh: (appId: string) => void;
}

/** What each application was last read for at one HQ, and the reads of it still out. */
interface Reading {
  readonly address: string;
  readonly reasons: Map<string, string>;
  readonly out: Map<string, AbortController>;
}

/** One application's read: what HQ answered, or why it did not. */
type AppAnswer =
  | {
      readonly releases: ReadonlyArray<Release>;
      readonly repos: ReadonlyArray<RepoListEntry>;
    }
  | { readonly failure: string };

/** What HQ last answered each application, for one HQ. */
interface Held {
  readonly address: string;
  readonly releases: ReadonlyMap<string, ReadonlyArray<Release>>;
  readonly repos: ReadonlyMap<string, ReadonlyArray<RepoListEntry>>;
  readonly failures: ReadonlyMap<string, string>;
}

export function useZeropsAppReleases(
  /**
   * Each application, by its id, with what its releases are read again on: where HQ says they
   * moved, and its production's deploys.
   */
  apps: ReadonlyMap<string, string>,
): ZeropsAppReleases {
  const hq = useOfficialHq();
  const [held, setHeld] = useState<Held | null>(null);
  /** How many times each application was asked to be read again at once. */
  const [asked, setAsked] = useState<ReadonlyMap<string, number>>(() => new Map());
  // Each application's reason to be read now, one string for all of them, whatever order the
  // caller lists them in: an application is read again when its own changes, and not otherwise.
  const due = JSON.stringify(
    [...apps]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([appId, moved]) => [appId, `${String(asked.get(appId) ?? 0)}\n${moved}`]),
  );
  /** What each application was last read for at one HQ, and the reads of it still out. */
  const reading = useRef<Reading | null>(null);

  // Another HQ, or none: the reads still out at the last one are stopped, and nothing it was read
  // for counts at the next.
  useEffect(() => {
    if (hq === null) return;
    const at: Reading = { address: hq.address, reasons: new Map(), out: new Map() };
    reading.current = at;
    return () => {
      for (const stop of at.out.values()) stop.abort();
      if (reading.current === at) reading.current = null;
    };
  }, [hq]);

  useEffect(() => {
    const at = reading.current;
    if (hq === null || at === null || at.address !== hq.address) return;
    for (const [appId, reason] of JSON.parse(due) as Array<[string, string]>) {
      if (at.reasons.get(appId) === reason) continue;
      at.reasons.set(appId, reason);
      // A read for an older reason answers nothing now.
      at.out.get(appId)?.abort();
      const stop = new AbortController();
      at.out.set(appId, stop);
      // Each application on its own: one HQ is slow to answer for holds no other back.
      const settle = (answer: AppAnswer) => {
        if (stop.signal.aborted) return;
        at.out.delete(appId);
        setHeld((last) => {
          const kept = last?.address === at.address ? last : undefined;
          const releases = new Map(kept?.releases);
          const repos = new Map(kept?.repos);
          const failures = new Map(kept?.failures);
          if ("failure" in answer) {
            failures.set(appId, answer.failure);
          } else {
            releases.set(appId, answer.releases);
            repos.set(appId, answer.repos);
            failures.delete(appId);
          }
          return { address: at.address, releases, repos, failures };
        });
      };
      void Promise.all([
        hq.api.releases(appId, stop.signal),
        hq.api.appRepos(appId, stop.signal),
      ]).then(
        ([releases, repos]) => settle({ releases, repos }),
        (cause: unknown) => settle({ failure: zeropsErrorMessage(cause) }),
      );
    }
  }, [hq, due]);

  const refresh = useCallback((appId: string) => {
    setAsked((current) => new Map(current).set(appId, (current.get(appId) ?? 0) + 1));
  }, []);

  return useMemo(() => {
    const current = hq !== null && held?.address === hq.address ? held : null;
    return {
      releases: current?.releases ?? NONE_READ,
      repos: current?.repos ?? NO_REPOS,
      failures: current?.failures ?? NO_FAILURES,
      refresh,
    };
  }, [held, hq, refresh]);
}

/** Nothing answered yet: not "no releases". */
const NONE_READ: ReadonlyMap<string, ReadonlyArray<Release>> = new Map();
const NO_REPOS: ReadonlyMap<string, ReadonlyArray<RepoListEntry>> = new Map();
const NO_FAILURES: ReadonlyMap<string, string> = new Map();
