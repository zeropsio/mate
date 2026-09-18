/**
 * The Gitea overview, read as the person: every repository they can reach
 * and the pull requests open across them (`giteaOverview.ts`).
 *
 * Two account-wide reads, issued together — Gitea's list of the person's
 * repositories and its search over open pull requests — and re-read every
 * sixty seconds while the page is open. Nothing here is per project; a
 * project's own flow is the provider's (`ZeropsProjectFlowProvider`).
 */
import {
  giteaOverview,
  type GiteaIssueSearchHit,
  type GiteaOverviewOwner,
  type GiteaRepository,
} from "@t3tools/client-runtime/zerops";
import { useEffect, useMemo, useState } from "react";

import { giteaClientFor } from "./giteaSession";

/** How often the overview is read again while the page is open. */
export const GITEA_OVERVIEW_REFRESH_MS = 60_000;

export interface ZeropsGiteaOverviewState {
  readonly owners: ReadonlyArray<GiteaOverviewOwner>;
  /** False until the first answer, so an empty page is "not read yet", never "nothing". */
  readonly read: boolean;
}

/** What Gitea answered, before it is grouped: the names come from the account, later or sooner. */
interface GiteaAnswer {
  readonly repositories: ReadonlyArray<GiteaRepository>;
  readonly pulls: ReadonlyArray<GiteaIssueSearchHit>;
}

const UNREAD: ZeropsGiteaOverviewState = { owners: [], read: false };

export function useZeropsGiteaOverview(input: {
  readonly giteaOrigin: string | undefined;
  readonly enabled: boolean;
  /** A Mate's name by its project (`giteaOverview`); the account's to know. */
  readonly mateName?: (projectId: string) => string | undefined;
}): ZeropsGiteaOverviewState {
  const { enabled, giteaOrigin, mateName } = input;
  const key = enabled && giteaOrigin !== undefined ? giteaOrigin : "";
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly answer: GiteaAnswer;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (key === "") return;
    const timer = window.setInterval(() => {
      setTick((count) => count + 1);
    }, GITEA_OVERVIEW_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [key]);

  useEffect(() => {
    if (key === "" || giteaOrigin === undefined) return;
    const client = giteaClientFor(giteaOrigin);
    if (client === null) return;
    const controller = new AbortController();
    void Promise.all([
      client.listUserRepositories().catch(() => []),
      client.searchPullRequests().catch(() => []),
    ]).then(([repositories, pulls]) => {
      if (controller.signal.aborted) return;
      setAnswer({ key, answer: { repositories, pulls } });
    });
    return () => {
      controller.abort();
    };
  }, [giteaOrigin, key, tick]);

  const read = answer?.key === key ? answer.answer : undefined;
  return useMemo<ZeropsGiteaOverviewState>(
    () =>
      read === undefined
        ? UNREAD
        : {
            owners: giteaOverview({
              repositories: read.repositories,
              pulls: read.pulls,
              ...(mateName === undefined ? {} : { mateName }),
            }),
            read: true,
          },
    [mateName, read],
  );
}
