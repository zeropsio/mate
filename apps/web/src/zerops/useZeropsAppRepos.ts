/**
 * Each application's repositories for the Git page, read as the person through the
 * organization's official HQ (`GET /api/apps/:appId/repos`): the applications whose changes they
 * may read, together, and again every minute while the page is open.
 *
 * Each application stands on its own: one whose read fails keeps what it read before and names its
 * cause beside it, and never takes another's answer with it — nor ever answers "no repositories".
 * The changes open on them come down HQ's stream, the flow's (`ZeropsProjectFlowProvider`).
 */
import type { HqAppRepo } from "@t3tools/client-runtime/zerops/hq";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useEffect, useMemo, useState } from "react";

import { useOfficialHq } from "./accountHq";

/** How often the repositories are read again while the page is open. */
export const APP_REPOS_REFRESH_MS = 60_000;

export interface ZeropsAppRepos {
  /** Each application's repositories, as HQ last listed them; absent until its first answer. */
  readonly repos: ReadonlyMap<string, ReadonlyArray<HqAppRepo>>;
  /** Why an application's last read did not answer, beside what it read before. */
  readonly failures: ReadonlyMap<string, string>;
}

/** What HQ last answered each application, for one HQ. */
interface Held {
  readonly address: string;
  readonly repos: ReadonlyMap<string, ReadonlyArray<HqAppRepo>>;
  readonly failures: ReadonlyMap<string, string>;
}

export function useZeropsAppRepos(appIds: ReadonlyArray<string>): ZeropsAppRepos {
  const hq = useOfficialHq();
  // One read per set of applications, whatever order the caller lists them in.
  const key = [...appIds].sort().join("\n");
  const [held, setHeld] = useState<Held | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (hq === null) return;
    const timer = setInterval(() => {
      setTick((count) => count + 1);
    }, APP_REPOS_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [hq]);

  useEffect(() => {
    if (hq === null || key === "") return;
    const stop = new AbortController();
    const asked = key.split("\n");
    void Promise.allSettled(asked.map((appId) => hq.api.appRepos(appId, stop.signal))).then(
      (answers) => {
        if (stop.signal.aborted) return;
        setHeld((last) => {
          const kept = last?.address === hq.address ? last : undefined;
          const repos = new Map(kept?.repos);
          const failures = new Map(kept?.failures);
          answers.forEach((answer, index) => {
            const appId = asked[index];
            if (appId === undefined) return;
            if (answer.status === "fulfilled") {
              repos.set(appId, answer.value);
              failures.delete(appId);
            } else {
              failures.set(appId, zeropsErrorMessage(answer.reason));
            }
          });
          return { address: hq.address, repos, failures };
        });
      },
    );
    return () => {
      stop.abort();
    };
  }, [hq, key, tick]);

  return useMemo(() => {
    const current = hq !== null && held?.address === hq.address ? held : null;
    return {
      repos: current?.repos ?? NONE_READ,
      failures: current?.failures ?? NO_FAILURES,
    };
  }, [held, hq]);
}

/** Nothing answered yet: not "no repositories". */
const NONE_READ: ReadonlyMap<string, ReadonlyArray<HqAppRepo>> = new Map();
const NO_FAILURES: ReadonlyMap<string, string> = new Map();
