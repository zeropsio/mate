/**
 * Each application's releases (`GET /api/apps/:appId/releases`), and the repositories a release
 * reads with them (`GET /api/apps/:appId/repos`: each production runtime's `main`, and the
 * recipe's, which a release tags), read as the person through the organization's official HQ.
 *
 * An application whose read fails keeps what it read before and says why beside it, and never
 * takes another's answer with it — nor ever answers "no releases".
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

/** What HQ last answered each application, for one HQ. */
interface Held {
  readonly address: string;
  readonly releases: ReadonlyMap<string, ReadonlyArray<Release>>;
  readonly repos: ReadonlyMap<string, ReadonlyArray<RepoListEntry>>;
  readonly failures: ReadonlyMap<string, string>;
}

/** How often every application's releases are read again while the app is open. */
export const APP_RELEASES_REFRESH_MS = 60_000;

export function useZeropsAppReleases(
  /** Each application, by its id, with what its releases are read again on: its production moving. */
  apps: ReadonlyMap<string, string>,
): ZeropsAppReleases {
  const hq = useOfficialHq();
  const [held, setHeld] = useState<Held | null>(null);
  const [tick, setTick] = useState(0);
  /** How many times each application was asked to be read again at once. */
  const [asked, setAsked] = useState<ReadonlyMap<string, number>>(() => new Map());
  // Each application's reason to be read now, one string for all of them, whatever order the
  // caller lists them in: an application is read again when its own changes, and not otherwise.
  const due = JSON.stringify(
    [...apps]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([appId, moved]) => [
        appId,
        `${String(tick)}\n${String(asked.get(appId) ?? 0)}\n${moved}`,
      ]),
  );
  /** The reason each application was last read for, at one HQ. */
  const read = useRef<{ readonly address: string; readonly reasons: Map<string, string> }>(null);

  useEffect(() => {
    if (hq === null) return;
    const timer = setInterval(() => {
      setTick((count) => count + 1);
    }, APP_RELEASES_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [hq]);

  useEffect(() => {
    if (hq === null) return;
    if (read.current?.address !== hq.address) {
      read.current = { address: hq.address, reasons: new Map() };
    }
    const { reasons } = read.current;
    const reading = (JSON.parse(due) as Array<[string, string]>).filter(
      ([appId, reason]) => reasons.get(appId) !== reason,
    );
    if (reading.length === 0) return;
    for (const [appId, reason] of reading) reasons.set(appId, reason);
    const stop = new AbortController();
    let answered = false;
    void Promise.allSettled(
      reading.map(([appId]) =>
        Promise.all([hq.api.releases(appId, stop.signal), hq.api.appRepos(appId, stop.signal)]),
      ),
    ).then((answers) => {
      if (stop.signal.aborted) return;
      answered = true;
      setHeld((last) => {
        const kept = last?.address === hq.address ? last : undefined;
        const releases = new Map(kept?.releases);
        const repos = new Map(kept?.repos);
        const failures = new Map(kept?.failures);
        answers.forEach((answer, index) => {
          const appId = reading[index]?.[0];
          if (appId === undefined) return;
          if (answer.status === "fulfilled") {
            releases.set(appId, answer.value[0]);
            repos.set(appId, answer.value[1]);
            failures.delete(appId);
          } else {
            failures.set(appId, zeropsErrorMessage(answer.reason));
          }
        });
        return { address: hq.address, releases, repos, failures };
      });
    });
    return () => {
      stop.abort();
      // A read cut short answered nothing: its applications are read again.
      if (answered) return;
      for (const [appId, reason] of reading)
        if (reasons.get(appId) === reason) reasons.delete(appId);
    };
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
