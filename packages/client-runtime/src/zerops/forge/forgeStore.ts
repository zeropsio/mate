/**
 * The forge store (DESIGN §2.D D3–D5, §4.7): what Gitea says, as the person, one fact per key —
 * an org's repositories, whether the broker has made a group's org yet, a repository with the
 * person's permissions in it, its open and recently merged pull requests and those of a head
 * branch, one pull request, a repository's tags, recent commits, a branch's head, a file on
 * `main`, the group repo's declarations (`environments.yaml`), a commit's statuses and detail, what
 * one commit has over another, and across the whole Gitea the person's repositories and the open
 * pull requests they can see.
 *
 * ## Facts
 *
 * Each key is one `Known` cell, read on demand and published on its own (M4, M8): one key
 * resolving never republishes or resets another, so an org switch, a group re-keying its
 * repositories or a view unmounting blanks nothing (M9). A list is `complete` only when the read
 * covered all of it. A pull request read in a list is admitted into its own cell by that read,
 * and a demanded list demands the pull requests it lists. Every read of a pull request moves its
 * `MergeState` on (`mergeState.ts`); one that is checking is read again at
 * {@link MERGE_RECHECK_AFTER_MS} while it is demanded, and a pull request landing puts every other
 * open one of its repository back to checking.
 *
 * ## Scheduling
 *
 * - One read per key at a time, and at most {@link FORGE_HOST_CONCURRENCY} per Gitea origin. Slots
 *   go by the demand's priority, then in the order keys became due.
 * - Nothing aborts a read in flight except the store's end or the key's eviction: a backstop that
 *   comes due, an invalidation or a wake during a read is one more read after it (M3).
 * - Backstops, because Gitea pushes nothing to a browser (§6.3): lists, repositories, tags,
 *   commits, files and branch heads every {@link FORGE_LIST_BACKSTOP_MS}, declarations every
 *   {@link FORGE_DECLARATIONS_BACKSTOP_MS}, a commit's statuses every
 *   {@link FORGE_PENDING_STATUS_MS} while one is pending, for at most
 *   {@link FORGE_PENDING_STATUS_LIMIT_MS}, and at the list backstop while CI has posted none; an
 *   org the broker has not made yet on the backoff ladder until it is. They run only while the key
 *   is demanded and the tab is visible. What commits named by their shas hold never changes, and
 *   no invalidation touches it.
 * - A failed read retries on the backoff ladder (`retryPolicy.ts`), keeping the value it had. A
 *   read whose Gitea 401 no token recovered is no answer: the key waits for the session to be
 *   readable again and reads then.
 * - While the tab is hidden nothing starts. A visible wake resets the backoff and reads again
 *   every demanded key read more than {@link FORGE_WAKE_REVALIDATE_MS} ago, except what no read
 *   changes: a key proved absent, a pull request that landed, statuses that are all done, an org
 *   that is made, a comparison or a commit read.
 *
 * ## Retention
 *
 * A key nobody demands keeps what it knows, the least recently released first out once more than
 * {@link FORGE_RETAINED_UNLEASED} are kept. The store lives for one account epoch.
 *
 * @module forge/forgeStore
 */
import type { Instant } from "../data/access/grant.ts";
import {
  GiteaApiError,
  GITEA_REQUEST_DEADLINE_MS,
  type GiteaClient,
  type GiteaCommit,
  type GiteaCommitDetail,
  type GiteaCommitStatus,
  type GiteaIssueSearchHit,
  type GiteaOrganization,
  type GiteaPullRequest,
  type GiteaRepository,
  type GiteaTag,
} from "../giteaClient.ts";
import { checkTone, type GitCheckTone } from "../gitTab.ts";
import { readGroupEnvironments, type GroupEnvironment } from "../groupEnvironments.ts";
import type { Invalidation } from "../knowledge/invalidation.ts";
import {
  advance,
  newCell,
  read,
  type Cell,
  type Coverage,
  type FailureReason,
  type KnownEvent,
  type Shown,
} from "../knowledge/known.ts";
import { INITIAL_BACKOFF, scheduleRetry, type Backoff } from "../knowledge/retryPolicy.ts";
import { ENVIRONMENTS_DOCUMENT_PATH } from "../recipeTier.ts";
import type { GiteaSessions } from "./giteaSession.ts";
import {
  MERGE_RECHECK_AFTER_MS,
  mergeabilityAfter,
  mergeReadOf,
  mergeStateOf,
  type MergeabilityTrack,
  type MergeState,
} from "./mergeState.ts";

export const FORGE_HOST_CONCURRENCY = 4;
export const FORGE_LIST_BACKSTOP_MS = 60_000;
export const FORGE_DECLARATIONS_BACKSTOP_MS = 5 * 60_000;
export const FORGE_PENDING_STATUS_MS = 15_000;
export const FORGE_PENDING_STATUS_LIMIT_MS = 20 * 60_000;
export const FORGE_WAKE_REVALIDATE_MS = 30_000;
export const FORGE_RETAINED_UNLEASED = 256;
/** One page of open pull requests; a page this long may not be all of them. */
export const FORGE_OPEN_PULLS_PAGE = 50;
/** How many of a repository's closed pull requests are read for its recent landings. */
export const FORGE_MERGED_PULLS_READ = 20;
/** One page of a repository's pull requests of every state, matched to a head branch. */
export const FORGE_BRANCH_PULLS_PAGE = 50;
/** How far back a repository's history goes before it stops being one. */
export const FORGE_COMMITS_READ = 30;

interface Repository {
  readonly origin: string;
  readonly owner: string;
  readonly repo: string;
}

/** A pull request's natural key: origin, owner, repository and number. */
export interface PullKey extends Repository {
  readonly number: number;
}

/** One fact the forge holds, by its natural key. */
export type ForgeFact =
  | { readonly kind: "repos"; readonly origin: string; readonly org: string }
  /** Every repository the person can reach on the Gitea. */
  | { readonly kind: "user-repos"; readonly origin: string }
  /** The open pull requests across every repository the person can see. */
  | { readonly kind: "pull-search"; readonly origin: string }
  /** A group's org, which the broker makes after the group is registered. */
  | { readonly kind: "organization"; readonly origin: string; readonly org: string }
  | ({ readonly kind: "open-pulls" } & Repository)
  | ({ readonly kind: "merged-pulls" } & Repository)
  | ({ readonly kind: "pull" } & PullKey)
  | ({ readonly kind: "tags" } & Repository)
  | ({ readonly kind: "branch"; readonly branch: string } & Repository)
  | ({ readonly kind: "branch-pulls"; readonly branch: string } & Repository)
  | ({ readonly kind: "declarations" } & Repository)
  /** A file on the repository's `main`, by its path. */
  | ({ readonly kind: "file"; readonly path: string } & Repository)
  | ({ readonly kind: "statuses"; readonly sha: string } & Repository)
  | ({ readonly kind: "commits" } & Repository)
  /** What `head` has that `base` does not: what a release would carry. */
  | ({ readonly kind: "compare"; readonly base: string; readonly head: string } & Repository)
  /** What one commit changed. */
  | ({ readonly kind: "commit"; readonly sha: string } & Repository)
  | ({ readonly kind: "repository" } & Repository);

/**
 * A group's org as Gitea answers for it: made, or not made yet — the broker builds it in about
 * eighty seconds, a real and temporary state, never "missing" (guide 4.5).
 */
export type ForgeOrganization =
  | { readonly kind: "made"; readonly organization: GiteaOrganization }
  | { readonly kind: "pending" };

/** A pull request as last read, and what its reads have shown about whether it merges. */
export interface PullRequestFact {
  readonly pull: GiteaPullRequest;
  readonly merge: MergeabilityTrack;
}

interface ForgeValues {
  readonly repos: ReadonlyArray<GiteaRepository>;
  readonly "user-repos": ReadonlyArray<GiteaRepository>;
  readonly "pull-search": ReadonlyArray<GiteaIssueSearchHit>;
  readonly organization: ForgeOrganization;
  /** The open pull requests' numbers; each one's own fact is its `pull` key. */
  readonly "open-pulls": ReadonlyArray<number>;
  /** The recent landings, newest first as Gitea lists them. */
  readonly "merged-pulls": ReadonlyArray<GiteaPullRequest>;
  readonly pull: PullRequestFact;
  readonly tags: ReadonlyArray<GiteaTag>;
  /** The commit the branch's head is. */
  readonly branch: string;
  /** The numbers of the pull requests of any state whose head is the branch, newest first. */
  readonly "branch-pulls": ReadonlyArray<number>;
  readonly declarations: ReadonlyArray<GroupEnvironment>;
  /** The file's text; `null` while `main` holds no such file. */
  readonly file: string | null;
  readonly statuses: ReadonlyArray<GiteaCommitStatus>;
  /** The newest {@link FORGE_COMMITS_READ} commits of the default branch, newest first. */
  readonly commits: ReadonlyArray<GiteaCommit>;
  readonly compare: ReadonlyArray<GiteaCommit>;
  readonly commit: GiteaCommitDetail;
  /** The repository with what this person may do in it — never the mirrored role (guide 4.5). */
  readonly repository: GiteaRepository;
}

export type ForgeValue<F extends ForgeFact> = ForgeValues[F["kind"]];

/** What a demand shows: the route's group first, then what is on screen, then the rest (§4.7). */
export type ForgePriority = "route" | "shown" | "background";

const PRIORITY_RANK: Readonly<Record<ForgePriority, number>> = {
  route: 0,
  shown: 1,
  background: 2,
};

/** The invalidations the forge store answers (§6.2). */
export type ForgeInvalidation = Extract<
  Invalidation,
  { readonly topic: "forge-org" | "forge-repo" | "forge-pr" }
>;

export interface ForgeStorePorts {
  readonly now: () => Instant;
  /** The backoff's jitter. */
  readonly random: () => number;
  /** Arms a timer; the returned function disarms it. */
  readonly setTimer: (delayMs: number, fire: () => void) => () => void;
  /** The person's Gitea sessions; a read goes out only while its origin's is readable. */
  readonly sessions: Pick<GiteaSessions, "view" | "subscribe" | "clientFor">;
}

export interface ForgeStore {
  /** Shows the fact until the returned release; the most urgent of its demands orders its reads. */
  readonly demand: (fact: ForgeFact, priority?: ForgePriority) => () => void;
  readonly read: <F extends ForgeFact>(fact: F) => Shown<ForgeValue<F>>;
  /** The pull request's MergeState, with the checks on its head as they are held. */
  readonly mergeState: (pull: PullKey) => Shown<MergeState>;
  /** Told the key of every fact whose shown state changed. */
  readonly subscribe: (listener: (fact: ForgeFact) => void) => () => void;
  readonly invalidate: (invalidation: ForgeInvalidation) => void;
  /** Whether a view demands a fact under the invalidation's key. */
  readonly shows: (invalidation: ForgeInvalidation) => boolean;
  readonly setVisible: (visible: boolean) => void;
  /** §6.4's visible wake. */
  readonly wake: () => void;
  /** The account closed: every read in flight is aborted and nothing runs again. */
  readonly dispose: () => void;
}

type Outcome =
  | { readonly kind: "value"; readonly value: unknown; readonly coverage: Coverage }
  | { readonly kind: "absent" }
  | { readonly kind: "failed"; readonly failure: FailureReason };

interface Entry {
  readonly fact: ForgeFact;
  readonly id: string;
  cell: Cell<unknown>;
  shown: Shown<unknown>;
  /** Each demand's priority, by its lease. */
  readonly leases: Map<number, ForgePriority>;
  /** The read in flight: its read-start ordinal and what ends it. */
  inFlight: { readonly ordinal: number; readonly controller: AbortController } | null;
  /** A read is owed as soon as a slot is free: demanded unread, invalidated, or asked for by a wake. */
  owed: boolean;
  /** Monotonic time a backstop or a recheck reads it next; null while none does. */
  pollAt: number | null;
  /** Monotonic time a failed read is tried again; null while none is due. */
  retryAt: number | null;
  backoff: Backoff;
  /** Waits for the Gitea session to be readable again after a 401 no token recovered. */
  awaitingSession: boolean;
  /** Monotonic time the last read started; null before the first. */
  readAt: number | null;
  /** Wall time of the newest invalidation. */
  invalidatedAtMs: number;
  /** A checking pull request: when it started checking and the next recheck rung. */
  recheck: { readonly sinceMs: number; rung: number } | null;
  /** Monotonic time the statuses were first read pending, in the current pending run. */
  pendingSince: number | null;
  /** When the key last became due, for the order within one priority. */
  dueSince: number;
}

const normalize = (origin: string): string => origin.trim().replace(/\/+$/u, "");

function normalized(fact: ForgeFact): ForgeFact {
  return { ...fact, origin: normalize(fact.origin) };
}

function keyOf(fact: ForgeFact): string {
  switch (fact.kind) {
    case "repos":
    case "organization":
      return JSON.stringify([fact.kind, fact.origin, fact.org]);
    case "user-repos":
    case "pull-search":
      return JSON.stringify([fact.kind, fact.origin]);
    case "pull":
      return JSON.stringify([fact.kind, fact.origin, fact.owner, fact.repo, fact.number]);
    case "statuses":
    case "commit":
      return JSON.stringify([fact.kind, fact.origin, fact.owner, fact.repo, fact.sha]);
    case "compare":
      return JSON.stringify([fact.kind, fact.origin, fact.owner, fact.repo, fact.base, fact.head]);
    case "branch":
    case "branch-pulls":
      return JSON.stringify([fact.kind, fact.origin, fact.owner, fact.repo, fact.branch]);
    case "file":
      return JSON.stringify([fact.kind, fact.origin, fact.owner, fact.repo, fact.path]);
    case "open-pulls":
    case "merged-pulls":
    case "tags":
    case "declarations":
    case "commits":
    case "repository":
      return JSON.stringify([fact.kind, fact.origin, fact.owner, fact.repo]);
  }
}

/**
 * Statuses no read changes: at least one, none pending. A commit read before CI posted anything
 * has none yet, and its first pending status is still to come.
 */
const statusesDone = (statuses: ReadonlyArray<GiteaCommitStatus>): boolean =>
  statuses.length > 0 && !statuses.some((status) => status.state === "pending");

const sameRepository = (fact: ForgeFact, repository: Repository): boolean =>
  "repo" in fact &&
  fact.origin === repository.origin &&
  fact.owner === repository.owner &&
  fact.repo === repository.repo;

/**
 * Whether the invalidation names facts under the fact's key. The facts across the whole Gitea
 * follow what changed under them: the person's repositories an org, the search a repository.
 */
function invalidates(invalidation: ForgeInvalidation, fact: ForgeFact): boolean {
  const origin = normalize(invalidation.origin);
  if (invalidation.topic === "forge-org") {
    return (
      fact.origin === origin &&
      (((fact.kind === "repos" || fact.kind === "organization") && fact.org === invalidation.org) ||
        fact.kind === "user-repos")
    );
  }
  if (fact.kind === "pull-search") return fact.origin === origin;
  // Commits named by their shas never change.
  if (fact.kind === "compare" || fact.kind === "commit") return false;
  return (
    sameRepository(fact, { origin, owner: invalidation.owner, repo: invalidation.repo }) &&
    (invalidation.topic === "forge-repo" ||
      (fact.kind === "pull" && fact.number === invalidation.number))
  );
}

/** What a failed read means for the fact. */
export function forgeFailure(cause: unknown): FailureReason {
  if (cause instanceof GiteaApiError) {
    if (cause.status === 401) return { kind: "unauthorized" };
    if (cause.status === 429) return { kind: "throttled", retryAfterMs: null };
    if (cause.status >= 500) return { kind: "server", status: cause.status };
    return { kind: "refused", code: String(cause.status), words: cause.detail ?? cause.message };
  }
  if (cause instanceof DOMException && cause.name === "TimeoutError") {
    return { kind: "timeout", afterMs: GITEA_REQUEST_DEADLINE_MS };
  }
  return { kind: "transport", detail: cause instanceof Error ? cause.message : String(cause) };
}

async function readFact(client: GiteaClient, fact: ForgeFact): Promise<Outcome> {
  switch (fact.kind) {
    case "repos":
      return {
        kind: "value",
        value: await client.listOrganizationRepositories(fact.org),
        coverage: "complete",
      };
    case "user-repos":
      return { kind: "value", value: await client.listUserRepositories(), coverage: "complete" };
    case "pull-search":
      return { kind: "value", value: await client.searchPullRequests(), coverage: "complete" };
    case "organization": {
      // Only a 404 means "not made yet"; the client turns that, and nothing else, into undefined.
      const organization = await client.getOrganization(fact.org);
      const value: ForgeOrganization =
        organization === undefined ? { kind: "pending" } : { kind: "made", organization };
      return { kind: "value", value, coverage: "complete" };
    }
    case "open-pulls": {
      const pulls = await client.listPullRequests(fact.owner, fact.repo, {
        state: "open",
        limit: FORGE_OPEN_PULLS_PAGE,
      });
      return {
        kind: "value",
        value: pulls,
        coverage: pulls.length < FORGE_OPEN_PULLS_PAGE ? "complete" : "partial",
      };
    }
    case "branch-pulls": {
      // Gitea has no "pull requests by head branch" filter worth trusting across versions.
      const pulls = await client.listPullRequests(fact.owner, fact.repo, {
        state: "all",
        limit: FORGE_BRANCH_PULLS_PAGE,
      });
      return {
        kind: "value",
        value: pulls.filter((pull) => pull.head?.ref === fact.branch),
        coverage: pulls.length < FORGE_BRANCH_PULLS_PAGE ? "complete" : "partial",
      };
    }
    case "merged-pulls": {
      const closed = await client.listPullRequests(fact.owner, fact.repo, {
        state: "closed",
        limit: FORGE_MERGED_PULLS_READ,
      });
      return {
        kind: "value",
        value: closed.filter((pull) => pull.merged === true),
        coverage: "complete",
      };
    }
    case "pull": {
      const pull = await client.getPullRequest(fact.owner, fact.repo, fact.number);
      return pull === undefined
        ? { kind: "absent" }
        : { kind: "value", value: pull, coverage: "complete" };
    }
    case "tags":
      return {
        kind: "value",
        value: await client.listAllTags(fact.owner, fact.repo),
        coverage: "complete",
      };
    case "branch": {
      const head = (await client.getBranch(fact.owner, fact.repo, fact.branch))?.commit?.id;
      return head === undefined
        ? { kind: "absent" }
        : { kind: "value", value: head, coverage: "complete" };
    }
    case "declarations": {
      const file = await client.readFile(fact.owner, fact.repo, ENVIRONMENTS_DOCUMENT_PATH);
      return {
        kind: "value",
        value: file === undefined ? [] : readGroupEnvironments(file.content),
        coverage: "complete",
      };
    }
    case "file": {
      const file = await client.readFile(fact.owner, fact.repo, fact.path, "main");
      return { kind: "value", value: file?.content ?? null, coverage: "complete" };
    }
    case "statuses":
      return {
        kind: "value",
        value: await client.listCommitStatuses(fact.owner, fact.repo, fact.sha),
        coverage: "complete",
      };
    case "commits":
      return {
        kind: "value",
        value: await client.listCommits(fact.owner, fact.repo, { limit: FORGE_COMMITS_READ }),
        coverage: "complete",
      };
    case "compare":
      return {
        kind: "value",
        value: await client.compareCommits(fact.owner, fact.repo, fact.base, fact.head),
        coverage: "complete",
      };
    case "commit": {
      const detail = await client.commitDetail(fact.owner, fact.repo, fact.sha);
      return detail === undefined
        ? { kind: "absent" }
        : { kind: "value", value: detail, coverage: "complete" };
    }
    case "repository": {
      const repository = await client.getRepository(fact.owner, fact.repo);
      return repository === undefined
        ? { kind: "absent" }
        : { kind: "value", value: repository, coverage: "complete" };
    }
  }
}

function mapShown<A, B>(shown: Shown<A>, map: (value: A) => B): Shown<B> {
  return shown.state === "known" ? { ...shown, value: map(shown.value) } : shown;
}

export function makeForgeStore(ports: ForgeStorePorts): ForgeStore {
  const entries = new Map<string, Entry>();
  /** Keys nobody demands, least recently released first. */
  const released = new Set<string>();
  const listeners = new Set<(fact: ForgeFact) => void>();
  let ordinal = 0;
  let leaseIds = 0;
  let visible = true;
  let disposed = false;
  let disarm: (() => void) | null = null;

  const publish = (entry: Entry, cell: Cell<unknown>): void => {
    const previous = entry.cell;
    entry.cell = cell;
    if (cell.held === previous.held && cell.withheld === previous.withheld) return;
    entry.shown = read(cell);
    for (const listener of listeners) listener(entry.fact);
  };

  const apply = (entry: Entry, event: KnownEvent<unknown>): void =>
    publish(entry, advance(entry.cell, event, ports.now().wall));

  const entryFor = (fact: ForgeFact): Entry => {
    const id = keyOf(fact);
    const existing = entries.get(id);
    if (existing !== undefined) return existing;
    const cell = newCell<unknown>(null);
    const created: Entry = {
      fact,
      id,
      cell,
      shown: read(cell),
      leases: new Map(),
      inFlight: null,
      owed: false,
      pollAt: null,
      retryAt: null,
      backoff: INITIAL_BACKOFF,
      awaitingSession: false,
      readAt: null,
      invalidatedAtMs: 0,
      recheck: null,
      pendingSince: null,
      dueSince: ports.now().mono,
    };
    entries.set(id, created);
    released.add(id);
    return created;
  };

  /** Whether a known value of the entry satisfies `test`. */
  const holds = <K extends keyof ForgeValues>(
    entry: Entry,
    test: (value: ForgeValues[K]) => boolean,
  ): boolean => entry.cell.held.state === "known" && test(entry.cell.held.value as ForgeValues[K]);

  /**
   * The lists held that name this pull request: its repository's open list, and the list of its
   * head branch.
   */
  const listsOf = (entry: Entry): ReadonlyArray<Entry> => {
    if (entry.fact.kind !== "pull") return [];
    const { origin, owner, repo, number } = entry.fact;
    const keys = [keyOf({ kind: "open-pulls", origin, owner, repo })];
    const held = entry.cell.held;
    if (held.state === "known") {
      const head = (held.value as PullRequestFact).pull.head?.ref;
      if (head !== undefined) {
        keys.push(keyOf({ kind: "branch-pulls", origin, owner, repo, branch: head }));
      }
    }
    return keys.flatMap((key) => {
      const list = entries.get(key);
      return list !== undefined && holds<"open-pulls">(list, (numbers) => numbers.includes(number))
        ? [list]
        : [];
    });
  };

  /** The most urgent demand on it, directly or through a list that names it. */
  const rankOf = (entry: Entry): number | null => {
    let rank: number | null = null;
    for (const priority of entry.leases.values()) {
      rank = Math.min(rank ?? Number.POSITIVE_INFINITY, PRIORITY_RANK[priority]);
    }
    if (rank !== null) return rank;
    for (const list of listsOf(entry)) {
      if (list.leases.size === 0) continue;
      const listed = rankOf(list);
      if (listed !== null) rank = Math.min(rank ?? Number.POSITIVE_INFINITY, listed);
    }
    return rank;
  };

  const reached = (at: number | null, mono: number): boolean => at !== null && mono >= at;

  /**
   * What no read changes: a key proved absent (M6), a pull request that landed, statuses that are
   * all done (D5), an org that is made, a comparison or a commit read. Only an invalidation reads
   * it again.
   */
  const final = (entry: Entry): boolean => {
    if (entry.cell.held.state === "gone") return true;
    switch (entry.fact.kind) {
      case "pull":
        return holds<"pull">(entry, (fact) => fact.pull.merged === true);
      case "statuses":
        return holds<"statuses">(entry, statusesDone);
      case "organization":
        return holds<"organization">(entry, (organization) => organization.kind === "made");
      case "compare":
      case "commit":
        return entry.cell.held.state === "known";
      default:
        return false;
    }
  };

  /** A key never read waits for the Gitea session, which is not a failure. */
  const waitForSession = (entry: Entry): void => {
    const held = entry.cell.held;
    if (held.state === "unread" && held.waitingFor === "gitea-session") return;
    apply(entry, { kind: "waiting", on: "gitea-session" });
  };

  /** A read is owed as soon as a slot is free. */
  const owe = (entry: Entry): void => {
    if (entry.owed) return;
    entry.owed = true;
    entry.dueSince = ports.now().mono;
  };

  const due = (entry: Entry, mono: number): boolean =>
    entry.inFlight === null &&
    !entry.awaitingSession &&
    (entry.owed || reached(entry.pollAt, mono) || reached(entry.retryAt, mono));

  /** Drops the least recently released keys beyond what is retained. */
  const evict = (): void => {
    for (const id of released) {
      if (released.size <= FORGE_RETAINED_UNLEASED) return;
      const entry = entries.get(id);
      // A pull request its demanded list names is shown, whoever holds no lease on it.
      if (entry !== undefined && rankOf(entry) !== null) continue;
      released.delete(id);
      if (entry === undefined) continue;
      entries.delete(id);
      entry.inFlight?.controller.abort();
    }
  };

  const backstopAfter = (
    entry: Entry,
    value: unknown,
    mono: number,
    wall: number,
  ): number | null => {
    switch (entry.fact.kind) {
      case "repos":
      case "user-repos":
      case "pull-search":
      case "open-pulls":
      case "merged-pulls":
      case "tags":
      case "branch":
      case "branch-pulls":
      case "commits":
      case "repository":
      case "file":
        return mono + FORGE_LIST_BACKSTOP_MS;
      case "declarations":
        return mono + FORGE_DECLARATIONS_BACKSTOP_MS;
      case "compare":
      case "commit":
        return null;
      case "organization": {
        // Made is final. Not made yet is asked about again on the ladder until it is.
        if ((value as ForgeOrganization).kind === "made") return null;
        const retry = scheduleRetry(entry.backoff, wall, ports.random);
        entry.backoff = retry.backoff;
        return mono + (retry.retryAtMs - wall);
      }
      case "statuses": {
        const statuses = value as ReadonlyArray<GiteaCommitStatus>;
        if (statuses.length === 0) return mono + FORGE_LIST_BACKSTOP_MS;
        if (statusesDone(statuses)) {
          entry.pendingSince = null;
          return null;
        }
        entry.pendingSince ??= mono;
        return mono - entry.pendingSince < FORGE_PENDING_STATUS_LIMIT_MS
          ? mono + FORGE_PENDING_STATUS_MS
          : null;
      }
      case "pull": {
        const mergeability = (value as PullRequestFact).merge.mergeability;
        if (mergeability.kind !== "checking") {
          entry.recheck = null;
          return null;
        }
        if (entry.recheck?.sinceMs !== mergeability.sinceMs) {
          entry.recheck = { sinceMs: mergeability.sinceMs, rung: 0 };
        }
        const recheck = entry.recheck;
        for (; recheck.rung < MERGE_RECHECK_AFTER_MS.length; recheck.rung += 1) {
          const at = recheck.sinceMs + (MERGE_RECHECK_AFTER_MS[recheck.rung] ?? 0);
          if (at > wall) {
            recheck.rung += 1;
            return mono + (at - wall);
          }
        }
        return null;
      }
    }
  };

  const invalidateEntry = (entry: Entry): void => {
    ordinal += 1;
    entry.invalidatedAtMs = ports.now().wall;
    apply(entry, { kind: "invalidated", ordinal });
    if (entry.inFlight === null) owe(entry);
  };

  /**
   * A pull request read, whether on its own or in its repository's list. Its mergeability moves on
   * from what the reads before it showed, unless an invalidation since then means they no longer
   * count.
   */
  const admitPull = (entry: Entry, readOrdinal: number, at: Instant, pull: GiteaPullRequest) => {
    const held = entry.cell.held;
    let prior: MergeabilityTrack | null = null;
    let landed = false;
    if (held.state === "known") {
      const before = held.value as PullRequestFact;
      landed = before.pull.merged === true;
      if (entry.cell.lastInvalidation <= held.asOf.ordinal) prior = before.merge;
    }
    const merge = mergeabilityAfter(prior, mergeReadOf(pull, at.wall));
    const value: PullRequestFact = { pull, merge };
    const applied = entry.cell;
    apply(entry, {
      kind: "read-succeeded",
      ordinal: readOrdinal,
      value,
      coverage: "complete",
      atMs: at.wall,
    });
    if (entry.cell.held === applied.held) return;
    const now = ports.now();
    entry.pollAt = backstopAfter(entry, value, now.mono, now.wall);
    if (!landed && pull.merged === true && entry.fact.kind === "pull") {
      // Its base moved: every other open pull request there is checking again (§4.7).
      const { number } = entry.fact;
      for (const sibling of entries.values()) {
        if (
          sibling.fact.kind === "pull" &&
          sibling.fact.number !== number &&
          sameRepository(sibling.fact, entry.fact) &&
          holds<"pull">(sibling, (fact) => fact.pull.state === "open")
        ) {
          invalidateEntry(sibling);
        }
      }
    }
  };

  const admit = (entry: Entry, readOrdinal: number, at: Instant, outcome: Outcome): void => {
    const fact = entry.fact;
    switch (outcome.kind) {
      case "absent":
        apply(entry, {
          kind: "proven-absent",
          evidence: "direct-not-found",
          ordinal: readOrdinal,
          atMs: at.wall,
        });
        return;
      case "failed": {
        const now = ports.now();
        if (outcome.failure.kind === "unauthorized") {
          // A token that came back during the read is read with at once; otherwise the session
          // tells the store when one does.
          if (ports.sessions.view(fact.origin).readable) owe(entry);
          else entry.awaitingSession = true;
          apply(entry, {
            kind: "read-failed",
            ordinal: readOrdinal,
            failure: outcome.failure,
            retryAtMs: null,
          });
          return;
        }
        const retry = scheduleRetry(entry.backoff, now.wall, ports.random);
        entry.backoff = retry.backoff;
        entry.retryAt = now.mono + (retry.retryAtMs - now.wall);
        apply(entry, {
          kind: "read-failed",
          ordinal: readOrdinal,
          failure: outcome.failure,
          retryAtMs: retry.retryAtMs,
        });
        return;
      }
      case "value":
        break;
    }
    // An org not made yet climbs the ladder across its reads (`backstopAfter`).
    if (fact.kind !== "organization" || (outcome.value as ForgeOrganization).kind === "made") {
      entry.backoff = INITIAL_BACKOFF;
    }
    if (fact.kind === "pull") {
      admitPull(entry, readOrdinal, at, outcome.value as GiteaPullRequest);
    } else {
      const pulls =
        fact.kind === "open-pulls" || fact.kind === "branch-pulls"
          ? (outcome.value as ReadonlyArray<GiteaPullRequest>)
          : null;
      const value = pulls === null ? outcome.value : pulls.map((pull) => pull.number);
      apply(entry, {
        kind: "read-succeeded",
        ordinal: readOrdinal,
        value,
        coverage: outcome.coverage,
        atMs: at.wall,
      });
      const now = ports.now();
      entry.pollAt = backstopAfter(entry, value, now.mono, now.wall);
      if (pulls !== null && (fact.kind === "open-pulls" || fact.kind === "branch-pulls")) {
        for (const pull of pulls) {
          admitPull(
            entryFor({
              kind: "pull",
              origin: fact.origin,
              owner: fact.owner,
              repo: fact.repo,
              number: pull.number,
            }),
            readOrdinal,
            at,
            pull,
          );
        }
      }
    }
    // An invalidation during the read leaves one read owed after it (M3).
    if (entry.cell.dirty) owe(entry);
  };

  const settle = (entry: Entry, readOrdinal: number, at: Instant, outcome: Outcome): void => {
    if (disposed || entries.get(entry.id) !== entry || entry.inFlight?.ordinal !== readOrdinal) {
      return;
    }
    entry.inFlight = null;
    admit(entry, readOrdinal, at, outcome);
    dispatch();
  };

  const start = (entry: Entry): boolean => {
    const controller = new AbortController();
    let unauthorized = false;
    const client = ports.sessions.clientFor(
      entry.fact.origin,
      () => {
        unauthorized = true;
      },
      controller.signal,
    );
    if (client === null) {
      waitForSession(entry);
      return false;
    }
    ordinal += 1;
    const readOrdinal = ordinal;
    const at = ports.now();
    entry.inFlight = { ordinal: readOrdinal, controller };
    entry.owed = false;
    entry.pollAt = null;
    entry.retryAt = null;
    entry.readAt = at.mono;
    apply(entry, { kind: "read-started", ordinal: readOrdinal, atMs: at.wall });
    // A 401 no token recovered makes whatever the read concluded no answer.
    const unanswered: Outcome = { kind: "failed", failure: { kind: "unauthorized" } };
    readFact(client, entry.fact).then(
      (outcome) => settle(entry, readOrdinal, at, unauthorized ? unanswered : outcome),
      (cause: unknown) =>
        settle(
          entry,
          readOrdinal,
          at,
          unauthorized ? unanswered : { kind: "failed", failure: forgeFailure(cause) },
        ),
    );
    return true;
  };

  /** Fills the free slots of every origin, then arms the one timer for what comes due next. */
  function dispatch(): void {
    if (disposed) return;
    disarm?.();
    disarm = null;
    if (!visible) return;
    markDue();
    const now = ports.now();
    const running = new Map<string, number>();
    const ready: Array<{ readonly entry: Entry; readonly rank: number }> = [];
    for (const entry of entries.values()) {
      if (entry.inFlight !== null) {
        running.set(entry.fact.origin, (running.get(entry.fact.origin) ?? 0) + 1);
        continue;
      }
      const rank = rankOf(entry);
      if (rank === null || !due(entry, now.mono)) continue;
      if (!ports.sessions.view(entry.fact.origin).readable) {
        waitForSession(entry);
        continue;
      }
      ready.push({ entry, rank });
    }
    ready.sort(
      (left, right) => left.rank - right.rank || left.entry.dueSince - right.entry.dueSince,
    );
    for (const { entry } of ready) {
      const origin = entry.fact.origin;
      const busy = running.get(origin) ?? 0;
      if (busy >= FORGE_HOST_CONCURRENCY) continue;
      if (start(entry)) running.set(origin, busy + 1);
    }
    let earliest: number | null = null;
    for (const entry of entries.values()) {
      if (entry.inFlight !== null || entry.awaitingSession || rankOf(entry) === null) continue;
      for (const at of [entry.pollAt, entry.retryAt]) {
        if (at === null || at <= now.mono) continue;
        earliest = earliest === null ? at : Math.min(earliest, at);
      }
    }
    if (earliest !== null) {
      disarm = ports.setTimer(earliest - now.mono, () => {
        disarm = null;
        dispatch();
      });
    }
  }

  /**
   * Dispatches once what the caller is doing now has been done: the demands one view makes
   * together are then ordered by their priority rather than by which came first.
   */
  let kicked: (() => void) | null = null;
  const kick = (): void => {
    if (disposed || kicked !== null) return;
    kicked = ports.setTimer(0, () => {
      kicked = null;
      dispatch();
    });
  };

  /** Keys whose backstop or retry came due join the queue in the order they came due. */
  function markDue(): void {
    const mono = ports.now().mono;
    for (const entry of entries.values()) {
      if (entry.owed) continue;
      if (reached(entry.pollAt, mono) || reached(entry.retryAt, mono)) {
        entry.dueSince = Math.min(entry.pollAt ?? mono, entry.retryAt ?? mono);
      }
    }
  }

  const unsubscribeSessions = ports.sessions.subscribe(() => {
    for (const entry of entries.values()) {
      if (entry.awaitingSession && ports.sessions.view(entry.fact.origin).readable) {
        entry.awaitingSession = false;
        owe(entry);
      }
    }
    kick();
  });

  return {
    demand: (input, priority = "shown") => {
      if (disposed) return () => undefined;
      const entry = entryFor(normalized(input));
      leaseIds += 1;
      const lease = leaseIds;
      entry.leases.set(lease, priority);
      released.delete(entry.id);
      if (entry.cell.held.state === "unread") owe(entry);
      kick();
      let done = false;
      return () => {
        if (done || disposed) return;
        done = true;
        entry.leases.delete(lease);
        if (entry.leases.size > 0 || entries.get(entry.id) !== entry) return;
        released.add(entry.id);
        evict();
        kick();
      };
    },
    read: <F extends ForgeFact>(fact: F) =>
      (entries.get(keyOf(normalized(fact)))?.shown ?? {
        state: "unread",
        waitingFor: null,
      }) as Shown<ForgeValue<F>>,
    mergeState: (key) => {
      const fact: ForgeFact = { kind: "pull", ...key, origin: normalize(key.origin) };
      const entry = entries.get(keyOf(fact));
      if (entry === undefined) return { state: "unread", waitingFor: null };
      const shown = entry.shown as Shown<PullRequestFact>;
      const held = entry.cell.held;
      // Invalidated since it was read — its base moved, or it was pushed to: Gitea is working
      // out again whether it merges.
      const recomputing = held.state === "known" && entry.cell.lastInvalidation > held.asOf.ordinal;
      return mapShown(shown, ({ pull, merge }) => {
        const head = pull.head?.sha;
        const statuses: Shown<ReadonlyArray<GiteaCommitStatus>> =
          head === undefined
            ? { state: "unread", waitingFor: null }
            : ((entries.get(
                keyOf({
                  kind: "statuses",
                  origin: fact.origin,
                  owner: key.owner,
                  repo: key.repo,
                  sha: head,
                }),
              )?.shown ?? { state: "unread", waitingFor: null }) as Shown<
                ReadonlyArray<GiteaCommitStatus>
              >);
        const checks: Shown<GitCheckTone> = mapShown(statuses, checkTone);
        return mergeStateOf(
          pull,
          recomputing
            ? { kind: "checking", sinceMs: entry.invalidatedAtMs, falseReads: 0 }
            : merge.mergeability,
          checks,
        );
      });
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    invalidate: (invalidation) => {
      if (disposed) return;
      for (const entry of entries.values()) {
        if (invalidates(invalidation, entry.fact)) invalidateEntry(entry);
      }
      kick();
    },
    shows: (invalidation) =>
      [...entries.values()].some(
        (entry) => rankOf(entry) !== null && invalidates(invalidation, entry.fact),
      ),
    setVisible: (next) => {
      if (disposed) return;
      visible = next;
      kick();
    },
    wake: () => {
      if (disposed) return;
      visible = true;
      const now = ports.now();
      for (const entry of entries.values()) {
        entry.backoff = INITIAL_BACKOFF;
        if (entry.inFlight !== null || rankOf(entry) === null) continue;
        if (entry.retryAt !== null) entry.retryAt = now.mono;
        if (final(entry)) continue;
        if (entry.readAt === null || now.mono - entry.readAt >= FORGE_WAKE_REVALIDATE_MS) {
          owe(entry);
        }
      }
      kick();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      disarm?.();
      disarm = null;
      kicked?.();
      kicked = null;
      unsubscribeSessions();
      for (const entry of entries.values()) entry.inFlight?.controller.abort();
      entries.clear();
      released.clear();
      listeners.clear();
    },
  };
}
