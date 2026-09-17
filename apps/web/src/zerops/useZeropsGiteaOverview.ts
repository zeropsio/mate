/**
 * The Gitea overview, read as the person: every repository they can reach
 * and the pull requests open across them (`giteaOverview.ts`).
 *
 * Two account-wide reads, issued together — Gitea's list of the person's
 * repositories and its search over open pull requests — and re-read every
 * sixty seconds while the page is open. Nothing here is per project; a
 * project's own flow is the provider's (`ZeropsProjectFlowProvider`).
 */
import { giteaOverview, type GiteaOverviewOwner } from "@t3tools/client-runtime/zerops";
import { useEffect, useState } from "react";

import { giteaClientFor } from "./giteaSession";

/** How often the overview is read again while the page is open. */
export const GITEA_OVERVIEW_REFRESH_MS = 60_000;

export interface ZeropsGiteaOverviewState {
  readonly owners: ReadonlyArray<GiteaOverviewOwner>;
  /** False until the first answer, so an empty page is "not read yet", never "nothing". */
  readonly read: boolean;
}

const UNREAD: ZeropsGiteaOverviewState = { owners: [], read: false };

export function useZeropsGiteaOverview(input: {
  readonly giteaOrigin: string | undefined;
  readonly enabled: boolean;
}): ZeropsGiteaOverviewState {
  const { enabled, giteaOrigin } = input;
  const key = enabled && giteaOrigin !== undefined ? giteaOrigin : "";
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly state: ZeropsGiteaOverviewState;
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
      setAnswer({ key, state: { owners: giteaOverview({ repositories, pulls }), read: true } });
    });
    return () => {
      controller.abort();
    };
  }, [giteaOrigin, key, tick]);

  return answer?.key === key ? answer.state : UNREAD;
}
