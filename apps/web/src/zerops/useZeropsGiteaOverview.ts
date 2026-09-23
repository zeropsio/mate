/**
 * The Gitea overview, read as the person: every repository they can reach
 * and the pull requests open across them (`giteaOverview.ts`).
 *
 * Two account-wide reads, issued together — Gitea's list of the person's
 * repositories and its search over open pull requests — and re-read every
 * sixty seconds while the page is open, and at once when the Gitea session is
 * readable again. A read that fails keeps what was read before it and names
 * its cause beside it; it never answers "no repositories" or "no pull
 * requests". Nothing here is per project; a project's own flow is the
 * provider's (`ZeropsProjectFlowProvider`).
 */
import {
  giteaOverview,
  type GiteaIssueSearchHit,
  type GiteaOverviewOwner,
  type GiteaRepository,
} from "@t3tools/client-runtime/zerops";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useEffect, useMemo, useState } from "react";

import { giteaClientFor, useGiteaReadable } from "./accountGiteaSessions";

/** How often the overview is read again while the page is open. */
export const GITEA_OVERVIEW_REFRESH_MS = 60_000;

export interface ZeropsGiteaOverviewState {
  readonly owners: ReadonlyArray<GiteaOverviewOwner>;
  /** False until the first answer, so an empty page is "not read yet", never "nothing". */
  readonly read: boolean;
  /** Why the last read did not answer, beside what was read before it; null once one answers. */
  readonly failure: string | null;
}

/** What Gitea answered, before it is grouped: the names come from the account, later or sooner. */
interface GiteaAnswer {
  readonly repositories: ReadonlyArray<GiteaRepository>;
  readonly pulls: ReadonlyArray<GiteaIssueSearchHit>;
}

/** What was read for one Gitea, and why the read after it did not answer. */
interface HeldOverview {
  readonly key: string;
  readonly answer: GiteaAnswer | undefined;
  readonly failure: string | null;
}

export function useZeropsGiteaOverview(input: {
  readonly giteaOrigin: string | undefined;
  readonly enabled: boolean;
  /** A Mate's name by its project (`giteaOverview`); the account's to know. */
  readonly mateName?: (projectId: string) => string | undefined;
}): ZeropsGiteaOverviewState {
  const { enabled, giteaOrigin, mateName } = input;
  const key = enabled && giteaOrigin !== undefined ? giteaOrigin : "";
  const readable = useGiteaReadable(giteaOrigin);
  const [held, setHeld] = useState<HeldOverview | null>(null);
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
    if (key === "" || giteaOrigin === undefined || !readable) return;
    // A read whose 401 no token recovered answers nothing, not an empty account (DESIGN §4.6).
    let unauthorized = false;
    const client = giteaClientFor(giteaOrigin, () => {
      unauthorized = true;
    });
    if (client === null) return;
    const controller = new AbortController();
    void Promise.all([client.listUserRepositories(), client.searchPullRequests()]).then(
      ([repositories, pulls]) => {
        if (controller.signal.aborted || unauthorized) return;
        setHeld({ key, answer: { repositories, pulls }, failure: null });
      },
      (error: unknown) => {
        // The session names a 401's cause; what was read stands either way.
        if (controller.signal.aborted || unauthorized) return;
        setHeld((last) => ({
          key,
          answer: last?.key === key ? last.answer : undefined,
          failure: zeropsErrorMessage(error),
        }));
      },
    );
    return () => {
      controller.abort();
    };
  }, [giteaOrigin, key, readable, tick]);

  const current = held?.key === key ? held : undefined;
  const read = current?.answer;
  const failure = current?.failure ?? null;
  return useMemo<ZeropsGiteaOverviewState>(
    () =>
      read === undefined
        ? { owners: [], read: false, failure }
        : {
            owners: giteaOverview({
              repositories: read.repositories,
              pulls: read.pulls,
              ...(mateName === undefined ? {} : { mateName }),
            }),
            read: true,
            failure,
          },
    [failure, mateName, read],
  );
}
