/**
 * The Gitea half of the Git tab, read as the person (guide 4.5).
 *
 * One pass per repository: what the repository is and what **this person** may
 * do in it (`GET /repos/{o}/{r}` and its `permissions`, never the mirrored
 * role), the pull request whose head is the branch the container is on, and
 * the commit statuses on that pull request's head.
 *
 * ## Freshness
 *
 * The checkout side is a live subscription and needs nothing from here. This
 * side has no event stream at all (Gitea's API has none), so it is re-read when
 * the tab opens, after each action — the caller bumps `generation` — and every
 * sixty seconds while the tab is open. A poll that ran while the tab was closed
 * would cost a request a minute for a panel nobody is looking at.
 *
 * A read that fails answers nothing rather than something: an empty forge state
 * is a block that says the checkout and stops, which is what a person who is
 * signed out of Gitea should see too.
 */

import type { GiteaClient, GitForgeState } from "@t3tools/client-runtime/zerops";
import { useEffect, useState } from "react";

import { giteaClientFor } from "./giteaSession";

/** How often the forge side is re-read while the tab is open. */
export const GIT_FORGE_REFRESH_MS = 60_000;

const EMPTY_FORGE: GitForgeState = { repository: undefined, pullRequest: undefined, checks: [] };

export type ZeropsGitForgeStates = ReadonlyMap<string, GitForgeState>;

const EMPTY: ZeropsGitForgeStates = new Map();

/** One repository to ask about: its name in the org, and the branch to match. */
export interface ZeropsGitForgeTarget {
  readonly repository: string;
  readonly branch: string | null;
}

export function useZeropsGitForge(input: {
  readonly giteaOrigin: string | undefined;
  /** The group's Gitea org. */
  readonly owner: string | undefined;
  readonly targets: ReadonlyArray<ZeropsGitForgeTarget>;
  /** Bumped by the caller after an action, to re-read at once. */
  readonly generation: number;
  /** False while the tab is closed: a closed tab polls nothing. */
  readonly enabled: boolean;
}): ZeropsGitForgeStates {
  const { enabled, generation, giteaOrigin, owner } = input;
  const key =
    enabled && giteaOrigin !== undefined && owner !== undefined
      ? JSON.stringify([
          giteaOrigin,
          owner,
          input.targets.map((target) => [target.repository, target.branch ?? ""]),
        ])
      : "";
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly forges: ZeropsGitForgeStates;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (key === "") return;
    const timer = setInterval(() => setTick((current) => current + 1), GIT_FORGE_REFRESH_MS);
    return () => {
      clearInterval(timer);
    };
  }, [key]);

  useEffect(() => {
    if (key === "" || giteaOrigin === undefined || owner === undefined) return;
    const client = giteaClientFor(giteaOrigin);
    if (client === null) return;
    const controller = new AbortController();
    void (async () => {
      const forges = new Map<string, GitForgeState>();
      for (const target of input.targets) {
        const state = await readForge(client, owner, target).catch(() => EMPTY_FORGE);
        if (controller.signal.aborted) return;
        forges.set(target.repository, state);
      }
      if (!controller.signal.aborted) setAnswer({ key, forges });
    })();
    return () => {
      controller.abort();
    };
    // `key` carries every target; `generation` and `tick` are the two reasons
    // to ask again for the same one.
  }, [generation, giteaOrigin, input.targets, key, owner, tick]);

  return answer?.key === key ? answer.forges : EMPTY;
}

async function readForge(
  client: GiteaClient,
  owner: string,
  target: ZeropsGitForgeTarget,
): Promise<GitForgeState> {
  const repository = await client.getRepository(owner, target.repository);
  if (repository === undefined) return EMPTY_FORGE;
  if (target.branch === null) return { repository, pullRequest: undefined, checks: [] };
  // Gitea has no "pull requests by head branch" filter worth trusting across
  // versions, so the open list is matched here — it is a handful of entries.
  const pulls = await client.listPullRequests(owner, target.repository, { state: "all" });
  const pullRequest = pulls.find((pull) => pull.head?.ref === target.branch);
  const head = pullRequest?.head?.sha;
  const checks =
    head === undefined ? [] : await client.listCommitStatuses(owner, target.repository, head);
  return { repository, pullRequest, checks };
}
