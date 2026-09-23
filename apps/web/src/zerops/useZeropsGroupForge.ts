/**
 * The Gitea half of a project's flow, read as the person: every open pull
 * request on the project's repositories and every release of its group repo
 * (`projectFlow.ts`).
 *
 * One read per group: the org's repositories, the pull requests open on each
 * and the checks on each one's head, then the group repo's `v*` tags and the
 * broker's verdict on each (`release.ts`). Each group is published the moment
 * its read completes (`flow/groupAnswers.ts`), every group is read again every
 * sixty seconds, and a verb re-reads at once only the part it changed
 * (`flow/verbs.ts`). Gitea has no event stream, so a clock is the only
 * freshness there is. A part that does not answer keeps what it had. A
 * repository never read is left out of what the answer holds, rather than
 * held as having no pull requests — `repositories` names the ones its pull
 * requests cover — and releases that did not answer carry why, whether or not
 * earlier ones are kept.
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
import {
  createGroupAnswers,
  type ForgeScope,
  type GroupAnswers,
  type GroupUpdate,
} from "@t3tools/client-runtime/zerops/flow";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import { useCallback, useEffect, useRef, useState } from "react";

import { giteaClientFor } from "./accountGiteaSessions";

/** How often the forge is read again while the app is open. */
export const GROUP_FORGE_REFRESH_MS = 60_000;

export interface ZeropsGroupForgeState {
  /** The org's repositories whose pull requests this answer holds, in the forge's order. */
  readonly repositories: ReadonlyArray<string>;
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  /** The landed ones, newest first as the forge lists them. */
  readonly merged: ReadonlyArray<FlowPullRequest>;
  /** The group repo's releases, or why they have never answered. */
  readonly released: ForgeReleases | { readonly failure: string };
}

export interface ForgeReleases {
  /** Newest first. */
  readonly releases: ReadonlyArray<FlowRelease>;
  /** Every `v*` tag, so the next one can be suggested without reusing a name. */
  readonly tags: ReadonlyArray<string>;
  /** Why the latest read of them failed, while the ones read before are kept. */
  readonly failure?: string;
}

export type ZeropsGroupForges = ReadonlyMap<string, ZeropsGroupForgeState>;

export interface ZeropsGroupForge {
  readonly forges: ZeropsGroupForges;
  /** Why each group's latest forge read failed, while it keeps failing. */
  readonly failures: ReadonlyMap<string, string>;
  /** Re-reads one part of one group at once: what a verb changed. */
  readonly invalidate: (groupId: string, scope: ForgeScope) => void;
}

/**
 * How many of a repository's closed changes are read for the landings a
 * conversation places. A group's closed list only grows, and a change that
 * landed long before the conversation was opened has nothing to add to it.
 */
const MERGED_PER_REPOSITORY = 20;

export function useZeropsGroupForge(input: {
  readonly giteaOrigin: string | undefined;
  readonly groups: ReadonlyArray<{ readonly groupId: string; readonly slug: string }>;
  readonly enabled: boolean;
}): ZeropsGroupForge {
  const { answers, failures, invalidate } = useGroupAnswers<
    { readonly groupId: string; readonly slug: string },
    ForgeScope,
    ZeropsGroupForgeState
  >({
    pass: "forge",
    giteaOrigin: input.giteaOrigin,
    enabled: input.enabled,
    groups: input.groups,
    refreshMs: GROUP_FORGE_REFRESH_MS,
    keyOf: (group) => group.slug,
    read: (client, group, scope) => readForge(client, group.slug, scope),
  });
  return { forges: answers, failures, invalidate };
}

/**
 * One group's answers, per group and kept across reads, for as long as the
 * tab holds a Gitea session with this origin — the React half of
 * `createGroupAnswers`, shared by the flow's two halves, with why each
 * failing group's reads fail. Losing the session stops the reads and keeps
 * what was read; another Gitea starts from nothing.
 */
export function useGroupAnswers<Group extends { readonly groupId: string }, Scope, Answer>(input: {
  readonly pass: "forge" | "deploys";
  readonly giteaOrigin: string | undefined;
  readonly enabled: boolean;
  readonly groups: ReadonlyArray<Group>;
  readonly refreshMs: number;
  readonly keyOf: (group: Group) => string;
  readonly read: (
    client: GiteaClient,
    group: Group,
    scope: Scope | "group",
    signal: AbortSignal,
    held: Answer | undefined,
  ) => Promise<GroupUpdate<Answer>>;
}): {
  readonly answers: ReadonlyMap<string, Answer>;
  readonly failures: ReadonlyMap<string, string>;
  readonly invalidate: (groupId: string, scope: Scope | "group") => void;
} {
  const { enabled, giteaOrigin, groups, pass, refreshMs } = input;
  const [held, setHeld] = useState<{
    readonly origin: string | undefined;
    readonly answers: ReadonlyMap<string, Answer>;
    readonly failures: ReadonlyMap<string, string>;
  }>({ origin: undefined, answers: new Map(), failures: new Map() });
  // The reads run off the driver, never off the inputs' identity: the groups
  // are rebuilt from an inventory that moves with every read, and keying the
  // effect on them read the group repo about 700 times a minute once (the
  // owner's org, 2026-09-17). The driver reads a group again only when its
  // key changes, and takes the latest inputs from here.
  const latest = useRef({ input, held });
  useEffect(() => {
    latest.current = { input, held };
  });
  const driver = useRef<GroupAnswers<Group, Scope> | null>(null);

  useEffect(() => {
    if (!enabled || giteaOrigin === undefined) return;
    const client = giteaClientFor(giteaOrigin);
    if (client === null) return;
    const kept =
      latest.current.held.origin === giteaOrigin ? latest.current.held.answers : undefined;
    const answers = createGroupAnswers<Group, Scope, Answer>({
      pass,
      idOf: (group) => group.groupId,
      keyOf: (group) => latest.current.input.keyOf(group),
      read: (group, scope, signal, previous) =>
        latest.current.input.read(client, group, scope, signal, previous),
      publish: (groupId, answer) => {
        setHeld((current) => {
          const same = current.origin === giteaOrigin;
          return {
            origin: giteaOrigin,
            answers: new Map(same ? current.answers : []).set(groupId, answer),
            failures: same ? current.failures : new Map(),
          };
        });
      },
      forget: (groupIds) => {
        setHeld((current) => {
          const answers = new Map(current.answers);
          const failures = new Map(current.failures);
          for (const groupId of groupIds) {
            answers.delete(groupId);
            failures.delete(groupId);
          }
          return { origin: current.origin, answers, failures };
        });
      },
      failure: (groupId, cause) => {
        setHeld((current) => {
          const same = current.origin === giteaOrigin;
          const failures = new Map(same ? current.failures : []);
          if (cause === null) failures.delete(groupId);
          else failures.set(groupId, cause);
          return {
            origin: giteaOrigin,
            answers: same ? current.answers : new Map(),
            failures,
          };
        });
      },
      ...(kept === undefined ? {} : { initial: kept }),
    });
    driver.current = answers;
    answers.setGroups(latest.current.input.groups);
    const timer = window.setInterval(answers.refresh, refreshMs);
    return () => {
      window.clearInterval(timer);
      answers.dispose();
      driver.current = null;
    };
  }, [enabled, giteaOrigin, pass, refreshMs]);

  useEffect(() => {
    driver.current?.setGroups(groups);
  }, [groups]);

  const invalidate = useCallback((groupId: string, scope: Scope | "group") => {
    driver.current?.invalidate(groupId, scope);
  }, []);

  const current = held.origin === giteaOrigin;
  return {
    answers: current ? held.answers : EMPTY_ANSWERS,
    failures: current ? held.failures : EMPTY_ANSWERS,
    invalidate,
  };
}

const EMPTY_ANSWERS: ReadonlyMap<string, never> = new Map<string, never>();

/** One repository's changes: the open ones with their checks, and the recent landings. */
interface RepositoryPulls {
  readonly pullRequests: ReadonlyArray<FlowPullRequest>;
  readonly merged: ReadonlyArray<FlowPullRequest>;
}

/** A part of a read that may not answer, and why when it did not. */
type Answered<T> = { readonly value: T } | { readonly failure: string };

async function answered<T>(read: () => Promise<T>): Promise<Answered<T>> {
  try {
    return { value: await read() };
  } catch (cause) {
    return { failure: zeropsErrorMessage(cause) };
  }
}

/**
 * Reads one scope of a group's forge. A whole read keeps, per repository and
 * for the releases, what is held where that part did not answer. A repository
 * that did not answer and was never read is left out; releases that did not
 * answer say why, beside the ones kept from an earlier read.
 */
export async function readForge(
  client: GiteaClient,
  slug: string,
  scope: ForgeScope | "group",
): Promise<GroupUpdate<ZeropsGroupForgeState>> {
  if (scope !== "group" && scope.kind === "repository") {
    const pulls = await readRepositoryPulls(client, slug, scope.repository);
    return (held) =>
      held === undefined
        ? undefined
        : withRepositories(
            held,
            held.repositories.includes(scope.repository)
              ? held.repositories
              : [...held.repositories, scope.repository],
            new Map([[scope.repository, pulls]]),
          );
  }
  if (scope !== "group") {
    const released = await readReleases(client, slug);
    return (held) => (held === undefined ? undefined : { ...held, released });
  }
  const repositories = (await client.listOrganizationRepositories(slug)).map(
    (repository) => repository.name,
  );
  const read = new Map<string, RepositoryPulls>();
  for (const repository of repositories) {
    const pulls = await answered(() => readRepositoryPulls(client, slug, repository));
    if ("value" in pulls) read.set(repository, pulls.value);
  }
  const releases = await answered(() => readReleases(client, slug));
  return (held) => {
    const covered = repositories.filter(
      (repository) => read.has(repository) || (held?.repositories.includes(repository) ?? false),
    );
    const released =
      "value" in releases
        ? releases.value
        : held !== undefined && "releases" in held.released
          ? { ...held.released, failure: releases.failure }
          : { failure: releases.failure };
    const base = held ?? { repositories: [], pullRequests: [], merged: [], released };
    return { ...withRepositories(base, covered, read), released };
  };
}

/** The held answer with the given repositories' rows replaced, in `repositories` order. */
function withRepositories(
  held: ZeropsGroupForgeState,
  repositories: ReadonlyArray<string>,
  fresh: ReadonlyMap<string, RepositoryPulls>,
): ZeropsGroupForgeState {
  const rows = (repository: string, part: keyof RepositoryPulls) =>
    fresh.get(repository)?.[part] ?? held[part].filter((pull) => pull.repository === repository);
  return {
    ...held,
    repositories,
    pullRequests: repositories.flatMap((repository) => rows(repository, "pullRequests")),
    merged: repositories.flatMap((repository) => rows(repository, "merged")),
  };
}

async function readRepositoryPulls(
  client: GiteaClient,
  slug: string,
  repository: string,
): Promise<RepositoryPulls> {
  const pullRequests: Array<FlowPullRequest> = [];
  for (const pull of await client.listPullRequests(slug, repository, { state: "open" })) {
    const head = pull.head?.sha;
    const checks =
      head === undefined
        ? []
        : await client.listCommitStatuses(slug, repository, head).catch(() => []);
    pullRequests.push(flowPullRequest({ repository, pull, checks }));
  }
  // The landed ones, so a conversation can place its own work landing on its
  // timeline. No checks are read for them: a change that is over is not waiting
  // on CI. Capped, because a long-lived group's closed list is unbounded and
  // only the recent ones sit inside a conversation anybody still has open.
  const closed = await client.listPullRequests(slug, repository, { state: "closed" });
  const merged = closed
    .slice(0, MERGED_PER_REPOSITORY)
    .filter((pull) => pull.merged === true)
    .map((pull) => flowPullRequest({ repository, pull, checks: [] }));
  return { pullRequests, merged };
}

async function readReleases(client: GiteaClient, slug: string): Promise<ForgeReleases> {
  const tags = await client.listTags(slug, GROUP_REPOSITORY);
  // Filtered into a fresh array, so the sort touches nothing else.
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
  return { releases, tags: releaseTags.map((tag) => tag.name) };
}

/** Newest release first, by version rather than by name. */
function byVersionDescending(left: { readonly name: string }, right: { readonly name: string }) {
  const a = readSemver(left.name);
  const b = readSemver(right.name);
  if (a === undefined || b === undefined) return 0;
  return b.major - a.major || b.minor - a.minor || b.patch - a.patch;
}
