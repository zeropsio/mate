/**
 * The Gitea half of a project's flow, read as the person: every open pull
 * request on the project's repositories and every release of its group repo
 * (`projectFlow.ts`).
 *
 * One read per group: the org's repositories, the pull requests open on each
 * and the checks on each one's head, then the group repo's `v*` tags and the
 * broker's verdict on each (`release.ts`). Each group is published the moment
 * its read completes (`flow/groupAnswers.ts`), every group is read again every
 * sixty seconds — a repository with a pull request still checking at the
 * forge store's rungs too — and a verb re-reads at once only the part it changed
 * (`flow/verbs.ts`). Gitea has no event stream, so a clock is the only
 * freshness there is, and it stops while the tab is hidden (`refreshClock.ts`).
 * On each tick a group costs one listing of its org, shared with the deploy
 * half; only what that listing says moved is asked again, and the rest is
 * answered from what was read (`forge/forgeReads.ts`). A commit's checks are
 * kept while settled and read again on a back-off while pending
 * (`forge/statusMemo.ts`). Whether a pull request merges is what its reads so far
 * came to (`forge/mergeState.ts`), never one answer: Gitea says "no" for a
 * moment after every push. A part that does not answer keeps what it had. A
 * repository never read is left out of what the answer holds, rather than
 * held as having no pull requests — `repositories` names the ones its pull
 * requests cover — and releases that did not answer carry why, whether or not
 * earlier ones are kept. A read that meets a Gitea 401 no token recovered is
 * not an answer, and the token coming back reads every group again.
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
  RELEASE_IN_FLIGHT_MS,
  releaseVerdict,
  shortCommit,
  type FlowPullRequest,
  type FlowRelease,
  type ReleaseAttempt,
  type GiteaClient,
  type GiteaCommitStatus,
  type GiteaPullRequest,
} from "@t3tools/client-runtime/zerops";
import {
  createGroupAnswers,
  type ForgeScope,
  type GroupAnswers,
  type GroupUpdate,
} from "@t3tools/client-runtime/zerops/flow";
import { zeropsErrorMessage } from "@t3tools/client-runtime/zerops/errors";
import {
  createForgeReads,
  createMergeabilityTracker,
  giteaNotFound,
  giteaUnauthorized,
  MERGE_RECHECK_AFTER_MS,
  mergeReadOf,
  TAGS_MAX_AGE_MS,
  VERDICT_RECHECK_LADDER_MS,
  type ForgePart,
  type ForgeReads,
  type MergeabilityTracker,
  type StatusReadOptions,
} from "@t3tools/client-runtime/zerops/forge";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { giteaClientFor } from "./accountGiteaSessions";
import { startRefreshClock } from "./refreshClock";

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
  /** The newest tag with what it lists and when it was made — what `releaseInFlight` reads. */
  readonly newest?: ReleaseAttempt | undefined;
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

/** How long an open pull request Gitea says does not merge is kept while nothing was pushed. */
export const UNMERGEABLE_MAX_AGE_MS = 5 * 60_000;

/**
 * What both group passes read through (`forge/forgeReads.ts`), one per Gitea: another Gitea
 * starts from nothing.
 */
export function useForgeReads(giteaOrigin: string | undefined): ForgeReads {
  const [held, setHeld] = useState(() => ({ giteaOrigin, reads: createForgeReads() }));
  if (held.giteaOrigin === giteaOrigin) return held.reads;
  const next = { giteaOrigin, reads: createForgeReads() };
  setHeld(next);
  return next.reads;
}

/**
 * Whether the broker has made each group's Gitea org, by slug, as the shared listing last answered
 * (`ForgeReads.organizations`): `false` while a group's `orgs/{slug}/repos` says 404, `true` once
 * it lists. Asked on the readers' own clock, on every screen.
 */
export function useForgeOrganizations(reads: ForgeReads): ReadonlyMap<string, boolean> {
  return useSyncExternalStore(reads.subscribe, reads.organizations);
}

/** What a pull request listing asks, as both passes key it: one ask, kept once for both. */
export const pullsKey = (options?: {
  readonly state?: string;
  readonly limit?: number | undefined;
}): string =>
  `pulls?state=${options?.state ?? "open"}${options?.limit === undefined ? "" : `&limit=${String(options.limit)}`}`;

const PULLS: ReadonlySet<ForgePart> = new Set(["pulls"]);
const RELEASED: ReadonlySet<ForgePart> = new Set(["code", "statuses"]);

export function useZeropsGroupForge(input: {
  readonly giteaOrigin: string | undefined;
  readonly groups: ReadonlyArray<{ readonly groupId: string; readonly slug: string }>;
  readonly enabled: boolean;
  /** A Gitea request can go out now (`GiteaSessionView.readable`); a read runs only then. */
  readonly readable: boolean;
  /** What both group passes read through, shared (`useForgeReads`). */
  readonly reads: ForgeReads;
}): ZeropsGroupForge {
  const [mergeability] = useState(createMergeabilityTracker);
  const { reads } = input;
  const { answers, failures, invalidate } = useGroupAnswers<
    { readonly groupId: string; readonly slug: string },
    ForgeScope,
    ZeropsGroupForgeState
  >({
    pass: "forge",
    giteaOrigin: input.giteaOrigin,
    enabled: input.enabled,
    readable: input.readable,
    groups: input.groups,
    refreshMs: GROUP_FORGE_REFRESH_MS,
    keyOf: (group) => group.slug,
    unauthorizedReads: reads.unauthorized,
    read: (client, group, scope) => readForge(client, group.slug, scope, mergeability, reads),
    // A release changes the group repo's tags and what their commits are told; a group read again
    // whole forgets all. A repository read again — a merge, or Gitea saying "checking" after a
    // push — is its pull requests again, and changes no commit's checks: their heads are new.
    forget: (group, scope) => {
      if (scope === "group") reads.forget(group.slug);
      else if (scope.kind === "tags") reads.forget(group.slug, GROUP_REPOSITORY, RELEASED);
      else reads.forget(group.slug, scope.repository, PULLS);
    },
  });
  const checking = checkingRepositories(answers).join("\n");
  // A pull request Gitea says "no" for is read again at the forge store's rungs: only a later
  // read tells a conflict from the moment after a push, and the next pass is a minute away (a
  // conflicting group #13 read "Checking whether it merges cleanly" for that minute, 2026-09-30).
  useEffect(() => {
    if (checking === "") return;
    const timers = checking.split("\n").flatMap((entry) => {
      const [groupId = "", repository = ""] = entry.split("\u0000");
      return MERGE_RECHECK_AFTER_MS.map((afterMs) =>
        setTimeout(() => invalidate(groupId, { kind: "repository", repository }), afterMs),
      );
    });
    return () => timers.forEach(clearTimeout);
  }, [checking, invalidate]);
  return { forges: answers, failures, invalidate };
}

/** Each group's repositories with an open pull request still checking, as `groupId\0repository`. */
export function checkingRepositories(forges: ZeropsGroupForges): ReadonlyArray<string> {
  return [...forges].flatMap(([groupId, forge]) =>
    [
      ...new Set(
        forge.pullRequests
          .filter((pull) => pull.mergeability === "checking")
          .map((pull) => pull.repository),
      ),
    ].map((repository) => `${groupId}\u0000${repository}`),
  );
}

/**
 * One group's answers, per group and kept across reads, for as long as the
 * tab holds a Gitea session with this origin — the React half of
 * `createGroupAnswers`, shared by the flow's two halves, with why each
 * failing group's reads fail. Losing the session stops the reads and keeps
 * what was read; another Gitea starts from nothing. No token to read with
 * (`readable` false) stops them too, and its return reads every group again.
 */
export function useGroupAnswers<Group extends { readonly groupId: string }, Scope, Answer>(input: {
  readonly pass: "forge" | "deploys";
  readonly giteaOrigin: string | undefined;
  readonly enabled: boolean;
  /** A Gitea request can go out now (`GiteaSessionView.readable`). */
  readonly readable: boolean;
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
  /** Drops what the reads keep about a group beside its answer: a verb, or its key, changed it. */
  readonly forget?: (group: Group, scope: Scope | "group") => void;
  /** How many shared reads met a 401 no token recovered (`ForgeReads.unauthorized`). */
  readonly unauthorizedReads: () => number;
}): {
  readonly answers: ReadonlyMap<string, Answer>;
  readonly failures: ReadonlyMap<string, string>;
  readonly invalidate: (groupId: string, scope: Scope | "group") => void;
} {
  const { enabled, giteaOrigin, groups, pass, readable, refreshMs } = input;
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
    if (!enabled || giteaOrigin === undefined || !readable) return;
    if (giteaClientFor(giteaOrigin) === null) return;
    const same = latest.current.held.origin === giteaOrigin;
    const kept = same ? latest.current.held.answers : undefined;
    // What the last driver said is failing is this one's to take back, or it would stand for good.
    const failing = same ? latest.current.held.failures : undefined;
    const answers = createGroupAnswers<Group, Scope, Answer>({
      pass,
      idOf: (group) => group.groupId,
      keyOf: (group) => latest.current.input.keyOf(group),
      read: async (group, scope, signal, previous) => {
        // A read that met a 401 no token recovered answered nothing for what
        // came after it: it is not an answer, even if the token is back by its
        // end, and the group keeps what it had without a cause of its own. A
        // read shared with the other pass met it too, though only the client
        // that sent it was told.
        let unauthorized = false;
        const client = giteaClientFor(giteaOrigin, () => {
          unauthorized = true;
        });
        if (client === null) return () => undefined;
        const { unauthorizedReads } = latest.current.input;
        const before = unauthorizedReads();
        const met = () => unauthorized || unauthorizedReads() !== before;
        try {
          const update = await latest.current.input.read(client, group, scope, signal, previous);
          return met() ? () => undefined : update;
        } catch (cause) {
          if (met() || giteaUnauthorized(cause)) return () => undefined;
          throw cause;
        }
      },
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
      ...(failing === undefined ? {} : { initialFailures: failing }),
    });
    driver.current = answers;
    answers.setGroups(latest.current.input.groups);
    const stopClock = startRefreshClock({ refresh: answers.refresh, everyMs: refreshMs });
    return () => {
      stopClock();
      answers.dispose();
      driver.current = null;
    };
  }, [enabled, giteaOrigin, pass, readable, refreshMs]);

  // A group whose key moved — a new deploy the platform pushed, a project joining — is read again
  // at once by the driver; what the reads keep beside the answer is dropped first, or that read
  // would be answered from it.
  const keys = useRef(new Map<string, string>());
  useEffect(() => {
    const { forget, keyOf } = latest.current.input;
    const next = new Map<string, string>();
    for (const group of groups) {
      const key = keyOf(group);
      const before = keys.current.get(group.groupId);
      if (forget !== undefined && before !== undefined && before !== key) forget(group, "group");
      next.set(group.groupId, key);
    }
    keys.current = next;
    driver.current?.setGroups(groups);
  }, [groups]);

  const invalidate = useCallback((groupId: string, scope: Scope | "group") => {
    const { forget, groups: current } = latest.current.input;
    const group = current.find((candidate) => candidate.groupId === groupId);
    if (forget !== undefined && group !== undefined) forget(group, scope);
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
    // A 401 no token recovered is no part's answer: the whole read answered nothing.
    if (giteaUnauthorized(cause)) throw cause;
    return { failure: zeropsErrorMessage(cause) };
  }
}

/** A group whose org the broker has not made yet: no repository, no pull request, no release. */
const NOTHING_YET: ZeropsGroupForgeState = {
  repositories: [],
  pullRequests: [],
  merged: [],
  released: { releases: [], tags: [] },
};

/**
 * Reads one scope of a group's forge. A whole read keeps, per repository and
 * for the releases, what is held where that part did not answer. A repository
 * that did not answer and was never read is left out; releases that did not
 * answer say why, beside the ones kept from an earlier read. `mergeability`
 * holds the reads of every pull request before this one.
 */
export async function readForge(
  client: GiteaClient,
  slug: string,
  scope: ForgeScope | "group",
  mergeability: MergeabilityTracker,
  reads: ForgeReads = createForgeReads(),
): Promise<GroupUpdate<ZeropsGroupForgeState>> {
  if (scope !== "group" && scope.kind === "repository") {
    const pulls = await readRepositoryPulls(client, slug, scope.repository, mergeability, reads);
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
    const released = await readReleases(client, slug, reads);
    return (held) => (held === undefined ? undefined : { ...held, released });
  }
  const listed = await reads
    .repositories(slug, () => client.listOrganizationRepositories(slug))
    .catch((cause: unknown) => {
      // The broker has not made its org yet (`ForgeReads.organizations`): there is nothing to
      // read, and nothing failed — its row says it is being set up.
      if (giteaNotFound(cause)) return null;
      throw cause;
    });
  if (listed === null) return () => NOTHING_YET;
  const repositories = listed.map((repository) => repository.name);
  const read = new Map<string, RepositoryPulls>();
  for (const repository of repositories) {
    const pulls = await answered(() =>
      readRepositoryPulls(client, slug, repository, mergeability, reads),
    );
    if ("value" in pulls) read.set(repository, pulls.value);
  }
  const releases = await answered(() => readReleases(client, slug, reads));
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
  mergeability: MergeabilityTracker,
  reads: ForgeReads,
): Promise<RepositoryPulls> {
  const row = (pull: GiteaPullRequest, atMs: number, checks: ReadonlyArray<GiteaCommitStatus>) =>
    flowPullRequest({
      repository,
      pull,
      checks,
      mergeability: mergeability.after(
        `${slug}/${repository}#${String(pull.number)}`,
        mergeReadOf(pull, atMs),
      ).kind,
    });
  const pulls = (state: "open" | "closed", maxAgeMs?: number) =>
    reads.read(
      { owner: slug, repo: repository, part: "pulls", key: pullsKey({ state }) },
      () => client.listPullRequests(slug, repository, { state }),
      { maxAgeMs },
    );
  const pullRequests: Array<FlowPullRequest> = [];
  // A kept answer is the read it was, at the time it was asked: replayed at a later time, Gitea's
  // "no" just after a push would read as a conflict.
  let open = await pulls("open");
  // A "no" may be a check that outlasted the rechecks, and its end moves nothing the org's listing
  // shows: one that does not merge is asked again now and then.
  if (open.value.some((pull) => pull.mergeable !== true)) {
    open = await pulls("open", UNMERGEABLE_MAX_AGE_MS);
  }
  for (const pull of open.value) {
    const head = pull.head?.sha;
    const checks =
      head === undefined
        ? []
        : await reads.statuses
            .read(
              { owner: slug, repo: repository, sha: head },
              () => client.listCommitStatuses(slug, repository, head),
              LIVE,
            )
            .catch(() => []);
    pullRequests.push(row(pull, open.atMs, checks));
  }
  // The landed ones, so a conversation can place its own work landing on its
  // timeline. No checks are read for them: a change that is over is not waiting
  // on CI. Capped, because a long-lived group's closed list is unbounded and
  // only the recent ones sit inside a conversation anybody still has open.
  const closed = await pulls("closed");
  const merged = closed.value
    .slice(0, MERGED_PER_REPOSITORY)
    .filter((pull) => pull.merged === true)
    .map((pull) => row(pull, closed.atMs, []));
  return { pullRequests, merged };
}

async function readReleases(
  client: GiteaClient,
  slug: string,
  reads: ForgeReads,
): Promise<ForgeReleases> {
  const code = <T>(key: string, load: () => Promise<T>, maxAgeMs?: number) =>
    reads.read({ owner: slug, repo: GROUP_REPOSITORY, part: "code", key }, load, { maxAgeMs });
  // A release made through the API moves nothing the org's listing shows, so the tags are read
  // again on their own clock; new ones may point at a commit already told about an older one.
  const listed = await code("tags", () => client.listTags(slug, GROUP_REPOSITORY), TAGS_MAX_AGE_MS);
  if (listed.changed) reads.statuses.forget(slug, GROUP_REPOSITORY);
  const tags = listed.value;
  // Filtered into a fresh array, so the sort touches nothing else.
  const releaseTags = tags.filter((tag) => isReleaseTag(tag.name)).sort(byVersionDescending);
  const releases: Array<FlowRelease> = [];
  let newest: ReleaseAttempt | undefined;
  for (const tag of releaseTags) {
    const entries = readReleaseMessage(tag.message ?? "");
    const sha = tag.commit?.sha;
    // Only the newest can be in flight; when it was made bounds how long it holds Release, and
    // tells its own deploy's failure from an earlier release's. A lightweight tag has no tagger
    // to read, and lists nothing a release deploys. A date that does not answer holds nothing:
    // Release stays offered.
    const tagId = tag.id;
    const taggedAt =
      newest !== undefined || tagId === undefined || entries.length === 0
        ? undefined
        : await code(`tags/${tagId}/date`, () => client.tagDate(slug, GROUP_REPOSITORY, tagId))
            .then((read) => read.value)
            .catch(() => undefined);
    // The newest waits for its own verdict, which may land on a commit an older tag's already
    // settled, and still takes production's after it; an older one is over. A verdict that never
    // comes — no broker, a tag pushed by hand — is waited for on a lengthening back-off, and not
    // past the time a release holds Release at all.
    const asked =
      newest === undefined
        ? { settled: judged(tag.name, taggedAt), waiting: VERDICT_RECHECK_LADDER_MS, live: true }
        : undefined;
    const statuses =
      sha === undefined
        ? []
        : await reads.statuses
            .read(
              { owner: slug, repo: GROUP_REPOSITORY, sha },
              () => client.listCommitStatuses(slug, GROUP_REPOSITORY, sha),
              asked,
            )
            .catch(() => []);
    const { verdict, detail } = releaseVerdict(tag.name, statuses);
    releases.push({
      tag: tag.name,
      verdict,
      detail: verdict === "refused" ? detail : undefined,
      line: entries.map((entry) => `${entry.service} ${shortCommit(entry.commit)}`).join(" · "),
      entries,
      taggedAt,
    });
    if (newest === undefined) newest = { tag: tag.name, verdict, entries, taggedAt };
  }
  return { releases, tags: releaseTags.map((tag) => tag.name), newest };
}

/** A pull request's head still takes checks after its first ones pass: a second workflow, a rerun. */
const LIVE: StatusReadOptions = { live: true };

/**
 * Statuses that carry the broker's final word on `tag` — or a tag made so long ago that it holds
 * nothing back whatever they say, and is waited on no longer.
 */
const judged =
  (tag: string, taggedAt: string | undefined) =>
  (statuses: ReadonlyArray<GiteaCommitStatus>): boolean => {
    const { verdict } = releaseVerdict(tag, statuses);
    if (verdict === "approved" || verdict === "refused") return true;
    const at = taggedAt === undefined ? Number.NaN : Date.parse(taggedAt);
    return Date.now() - at >= RELEASE_IN_FLIGHT_MS;
  };

/** Newest release first, by version rather than by name. */
function byVersionDescending(left: { readonly name: string }, right: { readonly name: string }) {
  const a = readSemver(left.name);
  const b = readSemver(right.name);
  if (a === undefined || b === undefined) return 0;
  return b.major - a.major || b.minor - a.minor || b.patch - a.patch;
}
