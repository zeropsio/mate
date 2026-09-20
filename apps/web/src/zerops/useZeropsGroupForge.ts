/**
 * The Gitea half of a project's flow, read as the person: every open pull
 * request on the project's repositories and every release of its group repo
 * (`projectFlow.ts`).
 *
 * One pass per group: the org's repositories, the pull requests open on each
 * and the checks on each one's head, then the group repo's `v*` tags and the
 * broker's verdict on each (`release.ts`). Re-read every sixty seconds, and
 * at once after a verb — the caller bumps `generation`. Gitea has no event
 * stream, so a clock is the only freshness there is; a read that fails
 * answers nothing for that group rather than something, and the surfaces
 * keep what they had.
 *
 * What an environment runs is not read here: that is the account's to prove
 * (`useZeropsGroupDeploys`), and the two are joined in the provider.
 */
import {
  flowPullRequest,
  GROUP_REPOSITORY,
  isReleaseTag,
  readReleaseMessage,
  readSemver,
  releaseVerdict,
  shortCommit,
  type FlowPullRequest,
  type FlowRelease,
  type GiteaClient,
} from "@t3tools/client-runtime/zerops";
import { useEffect, useState } from "react";

import { giteaClientFor } from "./giteaSession";

/** How often the forge is read again while the app is open. */
export const GROUP_FORGE_REFRESH_MS = 60_000;

export interface ZeropsGroupForgeState {
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  /** The landed ones, newest first as the forge lists them. */
  readonly merged: ReadonlyArray<FlowPullRequest>;
  /** Newest first. */
  readonly releases: ReadonlyArray<FlowRelease>;
  /** Every `v*` tag, so the next one can be suggested without reusing a name. */
  readonly tags: ReadonlyArray<string>;
}

export type ZeropsGroupForges = ReadonlyMap<string, ZeropsGroupForgeState>;

const EMPTY: ZeropsGroupForges = new Map();

/**
 * How many of a repository's closed changes are read for the landings a
 * conversation places. A group's closed list only grows, and a change that
 * landed long before the conversation was opened has nothing to add to it.
 */
const MERGED_PER_REPOSITORY = 20;

export function useZeropsGroupForge(input: {
  readonly giteaOrigin: string | undefined;
  readonly groups: ReadonlyArray<{ readonly groupId: string; readonly slug: string }>;
  /** Bumped by the caller after a verb, to read again at once. */
  readonly generation: number;
  readonly enabled: boolean;
}): ZeropsGroupForges {
  const { enabled, generation, giteaOrigin } = input;
  const key =
    enabled && giteaOrigin !== undefined
      ? JSON.stringify([giteaOrigin, input.groups.map((group) => [group.groupId, group.slug])])
      : "";
  const [answer, setAnswer] = useState<{
    readonly key: string;
    readonly forges: ZeropsGroupForges;
  } | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (key === "") return;
    const timer = window.setInterval(() => {
      setTick((count) => count + 1);
    }, GROUP_FORGE_REFRESH_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [key]);

  useEffect(() => {
    if (key === "" || giteaOrigin === undefined) return;
    const client = giteaClientFor(giteaOrigin);
    if (client === null) return;
    const controller = new AbortController();
    const groups = input.groups;
    void (async () => {
      const forges = new Map<string, ZeropsGroupForgeState>();
      for (const group of groups) {
        const state = await readForge(client, group.slug).catch(() => undefined);
        if (controller.signal.aborted) return;
        if (state !== undefined) forges.set(group.groupId, state);
      }
      if (!controller.signal.aborted) setAnswer({ key, forges });
    })();
    return () => {
      controller.abort();
    };
    // `key` carries every group; `generation` and `tick` are the two reasons
    // to read the same ones again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generation, giteaOrigin, key, tick]);

  return answer?.key === key ? answer.forges : EMPTY;
}

async function readForge(client: GiteaClient, slug: string): Promise<ZeropsGroupForgeState> {
  const repositories = await client.listOrganizationRepositories(slug);
  const pullRequests: Array<FlowPullRequest> = [];
  for (const repository of repositories) {
    const pulls = await client
      .listPullRequests(slug, repository.name, { state: "open" })
      .catch(() => []);
    for (const pull of pulls) {
      const head = pull.head?.sha;
      const checks =
        head === undefined
          ? []
          : await client.listCommitStatuses(slug, repository.name, head).catch(() => []);
      pullRequests.push(flowPullRequest({ repository: repository.name, pull, checks }));
    }
  }

  // The landed ones, so a conversation can place its own work landing on its
  // timeline. No checks are read for them: a change that is over is not waiting
  // on CI, and the read is per repository already. Capped, because a long-lived
  // group's closed list is unbounded and only the recent ones sit inside a
  // conversation anybody still has open.
  const merged: Array<FlowPullRequest> = [];
  for (const repository of repositories) {
    const closed = await client
      .listPullRequests(slug, repository.name, { state: "closed" })
      .catch(() => []);
    for (const pull of closed.slice(0, MERGED_PER_REPOSITORY)) {
      if (pull.merged !== true) continue;
      merged.push(flowPullRequest({ repository: repository.name, pull, checks: [] }));
    }
  }

  const tags = await client.listTags(slug, GROUP_REPOSITORY).catch(() => []);
  const releaseTags = tags.filter((tag) => isReleaseTag(tag.name)).sort(byVersionDescending);
  const releases: Array<FlowRelease> = [];
  for (const tag of releaseTags) {
    const entries = readReleaseMessage(tag.message ?? "");
    const sha = tag.commit?.sha;
    const statuses =
      sha === undefined
        ? []
        : await client.listCommitStatuses(slug, GROUP_REPOSITORY, sha).catch(() => []);
    const { verdict, detail } = releaseVerdict(tag.name, statuses);
    releases.push({
      tag: tag.name,
      verdict,
      detail: verdict === "refused" ? detail : undefined,
      line: entries.map((entry) => `${entry.service} ${shortCommit(entry.commit)}`).join(" · "),
    });
  }

  return { pullRequests, merged, releases, tags: releaseTags.map((tag) => tag.name) };
}

/** Newest release first, by version rather than by name. */
function byVersionDescending(left: { readonly name: string }, right: { readonly name: string }) {
  const a = readSemver(left.name);
  const b = readSemver(right.name);
  if (a === undefined || b === undefined) return 0;
  return b.major - a.major || b.minor - a.minor || b.patch - a.patch;
}
