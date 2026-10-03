/**
 * What the group readers ask Gitea, read again only when the org's own listing says it moved —
 * for the readers that ask on a clock of their own rather than through the forge store
 * (`useZeropsGroupForge`, `useZeropsGroupDeploys`).
 *
 * Gitea has no event stream, so a clock is the only freshness there is; but a listing of
 * repositories (`GET /repos/search`, `GET /orgs/{o}/repos` — the same fields) carries, per
 * repository, what moves with nearly everything the group readers draw (measured on Gitea 1.27.2,
 * 2026-10-02):
 *
 * - `updated_at` moves with every push to any branch — a commit through the contents API, a
 *   merge, a git push of a branch or a tag;
 * - `open_pr_counter` moves when a pull request opens, closes or merges;
 * - neither moves for a pull request's new title, a commit status, a branch made without a
 *   commit, or a tag made through the API (`POST /repos/{o}/{r}/tags`, what Release does).
 *
 * So each refresh lists the person's whole account once (`GiteaClient.listAccountRepositories`, a
 * page per 50 repositories, by id) and cuts each org's part from it; what an org's part moved is
 * dropped: a pushed repository's pull requests, code and commit statuses ({@link planGateReads}),
 * only the pull requests where only the counter moved. Everything else is answered from what was
 * kept. A repository the listing does not name, or names without those fields, is never kept.
 * Tags, which the listing cannot see, are read again at most every {@link TAGS_MAX_AGE_MS}. Commit
 * statuses are the status memo's: pending ones on its back-off, settled ones until forgotten — or,
 * on a commit that still takes contexts, on a slower back-off of their own (`forge/statusMemo.ts`).
 *
 * A refresh is a burst: the readers' clocks tick together ({@link ForgeReads.tick}), and every org
 * read until the next tick shares the account listing made after it, while it is
 * {@link GATE_FRESH_MS} old; an org read after that and before the next tick — a group created a
 * moment ago, a deploy key that changed — lists itself, never the whole account again. An org's
 * listing is never older than its own tick, whoever listed the account or the org before it:
 * neither another org's read between two ticks nor the pull watch's look answers the next tick. The pull watch, which looks at one org every few seconds, lists that
 * org on its own (`forge/pullWatch.ts`).
 *
 * The account listing names every repository of an org the person is on a team of (gitea-mate's
 * teams include all of the org's repositories), and only those the person can see. An org it names
 * nothing of — one the broker has not made yet, one with no repository yet, one the person is on no
 * team of — is listed on its own as before; so is every org on a refresh whose account listing
 * failed (other than with the session's 401) or does not add up ({@link splitAccountListing}), and
 * for {@link ACCOUNT_SKIP_MS} after one that stopped at the client's page limit or named none of
 * the orgs asked of it that are there (an org whose own listing answers `404` is no miss). That own
 * listing is also the one answer to whether the broker has made a group's org yet: a `404` is "not
 * made yet" ({@link ForgeReads.organizations}), kept like a listing — never past the next tick —
 * and the next refresh's `200`, or the account listing naming it, is "made". A group created a moment ago is a real state its row says out loud while
 * the broker builds it (30–80 s), and the reader's own clock takes the line away on any screen, in
 * any tab — no page asks `GET /orgs/{o}` of its own.
 *
 * Every open tab re-read every group whole every minute — the org's repositories, each one's open
 * and closed pull requests, the group repo's tags, files and branches — about 160 requests a
 * minute per tab (pass 31, 2026-10-02: 317 in the first 140 s after a load). Then an idle tab
 * listed each org once a minute — 13.4 a minute of a window's 22 with 14 orgs (run 6,
 * 2026-10-03). Now it lists the account once a minute, a request per 50 repositories, and asks
 * who the person is once.
 *
 * @module forge/forgeReads
 */
import {
  GiteaApiError,
  GITEA_LIST_LIMIT,
  type GiteaAccountListing,
  type GiteaClient,
  type GiteaRepository,
} from "../giteaClient.ts";
import { createCommitStatusMemo, type CommitStatusMemo } from "./statusMemo.ts";

/** How long one listing of an org answers for every reader that asks: under the readers' clock. */
export const GATE_FRESH_MS = 30_000;

/**
 * How close one reader's tick must follow another's to be the same refresh: the forge and the
 * deploys readers' clocks start together.
 */
export const ACCOUNT_BURST_MS = 5_000;

/**
 * How long each org is listed on its own after an account listing that stopped at the client's
 * page limit, named none of the orgs asked of it, or twice in a row did not add up: listing the
 * account then only costs a request more.
 */
export const ACCOUNT_SKIP_MS = 10 * 60_000;

/**
 * How old a push must be before what was read after it is trusted: Gitea's `updated_at` is to the
 * second, so a push in the same second as one already seen moves nothing; a repository pushed
 * this recently is read once more on the next listing.
 */
export const GATE_SETTLE_MS = 2 * 60_000;

/** How long a group repo's tags are kept: a release made through the API moves no listing. */
export const TAGS_MAX_AGE_MS = 5 * 60_000;

/** What a repository's reads are kept as, dropped together when the listing says they moved. */
export type ForgePart = "pulls" | "code" | "statuses";

/** The fields of one listed repository that say whether anything read from it moved. */
export interface RepositoryGate {
  readonly updatedAt: string | undefined;
  readonly openPulls: number | undefined;
  readonly defaultBranch: string | undefined;
  /** Its push is old enough that nothing in the same second can still come after a read. */
  readonly settled: boolean;
}

/** An org's listing as the gate keeps it, by repository name. */
export type OrgGate = ReadonlyMap<string, RepositoryGate>;

export interface GatePlan {
  readonly gate: OrgGate;
  /** What of each repository is read again; a repository not named keeps everything. */
  readonly reread: ReadonlyMap<string, ReadonlySet<ForgePart>>;
}

const EVERYTHING: ReadonlySet<ForgePart> = new Set(["pulls", "code", "statuses"]);
const PULLS: ReadonlySet<ForgePart> = new Set(["pulls"]);
const PULLS_AND_CODE: ReadonlySet<ForgePart> = new Set(["pulls", "code"]);

/** Whether the listing says enough of a repository for what was read of it to be kept. */
export const gateKnown = (gate: RepositoryGate | undefined): boolean =>
  gate !== undefined && gate.updatedAt !== undefined && gate.openPulls !== undefined;

/**
 * What a new listing of an org makes read again, against the one before (`undefined` for the
 * first): everything of a repository that is new, gone, pushed, or listed without the fields; its
 * pull requests where only the open counter moved; its pull requests and code once more where
 * its push was too recent to trust; nothing where nothing moved.
 */
export function planGateReads(
  previous: OrgGate | undefined,
  listed: ReadonlyArray<GiteaRepository>,
  nowMs: number,
): GatePlan {
  const gate = new Map<string, RepositoryGate>();
  const reread = new Map<string, ReadonlySet<ForgePart>>();
  for (const repository of listed) {
    const before = previous?.get(repository.name);
    const updatedAt = repository.updated_at;
    const pushedAtMs = updatedAt === undefined ? Number.NaN : Date.parse(updatedAt);
    const next: RepositoryGate = {
      updatedAt,
      openPulls: repository.open_pr_counter,
      defaultBranch: repository.default_branch,
      settled: pushedAtMs <= nowMs - GATE_SETTLE_MS,
    };
    if (!gateKnown(next) || !gateKnown(before) || before === undefined) {
      gate.set(repository.name, next);
      reread.set(repository.name, EVERYTHING);
      continue;
    }
    if (before.updatedAt !== next.updatedAt || before.defaultBranch !== next.defaultBranch) {
      gate.set(repository.name, next);
      reread.set(repository.name, EVERYTHING);
      continue;
    }
    // Read once more after a push too recent to trust, then trusted whatever the clock says.
    gate.set(repository.name, { ...next, settled: true });
    if (!before.settled) reread.set(repository.name, PULLS_AND_CODE);
    else if (before.openPulls !== next.openPulls) reread.set(repository.name, PULLS);
  }
  for (const name of previous?.keys() ?? []) {
    if (!gate.has(name)) reread.set(name, EVERYTHING);
  }
  return { gate, reread };
}

/**
 * What an org's repositories are read from: the org's own listing, and — where the reader offers
 * it — the person's whole account.
 */
export type RepositoryLists = Pick<GiteaClient, "listOrganizationRepositories"> &
  Partial<Pick<GiteaClient, "currentUser" | "listAccountRepositories">>;

/** One account listing, split by owner (lower case, as Gitea compares logins). */
interface AccountListing {
  /** `undefined` when this refresh's orgs are each listed on their own. */
  readonly byOwner: ReadonlyMap<string, ReadonlyArray<GiteaRepository>> | undefined;
  readonly atMs: number;
  /** Whether it did not add up ({@link splitAccountListing}). */
  readonly unsure: boolean;
  /** Orgs that took their part of it, and orgs it named nothing of. */
  served: number;
  missed: number;
}

/** What one account listing says of each org. */
export type AccountSplit =
  | {
      readonly kind: "split";
      readonly byOwner: ReadonlyMap<string, ReadonlyArray<GiteaRepository>>;
    }
  /** It stopped at the client's page limit, which may have cut any org's repositories short. */
  | { readonly kind: "capped" }
  /** A row came twice, or the rows and Gitea's count disagree: one may be missing. */
  | { readonly kind: "unsure" };

const ownerKey = (owner: string) => owner.toLowerCase();

/** The owner a listed repository belongs to: its owner's login, else its full name's first part. */
const ownerOf = (repository: GiteaRepository): string | undefined => {
  const login = repository.owner?.login ?? repository.full_name.split("/")[0];
  return login === undefined || login === "" ? undefined : ownerKey(login);
};

/**
 * The account listing split by owner, when it adds up: no repository twice, and as many as every
 * page said the whole holds. A repository made or deleted between two pages shifts the next page
 * by one, and the listing then says nothing for this refresh.
 */
export function splitAccountListing(listing: GiteaAccountListing): AccountSplit {
  const listed = listing.repositories;
  if (listed.length >= GITEA_LIST_LIMIT) return { kind: "capped" };
  const ids = new Set(listed.map((repository) => repository.id));
  if (ids.size !== listed.length) return { kind: "unsure" };
  if (listing.counts.some((count) => count !== undefined && count !== ids.size)) {
    return { kind: "unsure" };
  }
  const byOwner = new Map<string, Array<GiteaRepository>>();
  for (const repository of listed) {
    const owner = ownerOf(repository);
    if (owner === undefined) continue;
    const held = byOwner.get(owner);
    if (held === undefined) byOwner.set(owner, [repository]);
    else held.push(repository);
  }
  return { kind: "split", byOwner };
}

/** One read the gate keeps: which repository's which part, and what was asked of it. */
export interface ForgeReadRef {
  readonly owner: string;
  readonly repo: string;
  readonly part: Exclude<ForgePart, "statuses">;
  /** What was asked — the path and query — so two different asks are kept apart. */
  readonly key: string;
}

/** A kept answer, and when the read that answered it was asked. */
export interface ForgeRead<T> {
  readonly value: T;
  readonly atMs: number;
  /** This read asked Gitea and its answer is not the one kept before (or nothing was). */
  readonly changed: boolean;
}

export interface ForgeReads {
  /**
   * A reader's clock ticked: a refresh begins, and the orgs read until the next one share an
   * account listing made after it. A tick within {@link ACCOUNT_BURST_MS} of the one that began
   * the refresh is the same refresh.
   */
  readonly tick: () => void;
  /**
   * The org's repositories — one listing shared by every reader of the org while it is
   * {@link GATE_FRESH_MS} old, or `maxAgeMs` for a reader that looks more often, and made since
   * the refresh's tick — cut from this refresh's listing of the account where `lists` offers it
   * and it names the org, else the org's own listing; a listing that moved drops what it moved
   * before it answers.
   */
  readonly repositories: (
    owner: string,
    lists: RepositoryLists,
    options?: {
      readonly maxAgeMs?: number | undefined;
      /**
       * Told what a listing this call asked for dropped, against the one before it — never for an
       * org's first listing, which drops nothing that was read, nor for one answered from another.
       */
      readonly moved?: ((reread: ReadonlyMap<string, ReadonlySet<ForgePart>>) => void) | undefined;
    },
  ) => Promise<ReadonlyArray<GiteaRepository>>;
  /**
   * What is kept for `ref` while the listing says it has not moved — and while it is no older
   * than `maxAgeMs` — otherwise one `load`, shared with whoever asks the same while it runs. A
   * repository the latest listing does not vouch for is read every time and kept for nobody. A
   * load that fails keeps nothing and rejects.
   */
  readonly read: <T>(
    ref: ForgeReadRef,
    load: () => Promise<T>,
    options?: { readonly maxAgeMs?: number | undefined },
  ) => Promise<ForgeRead<T>>;
  /** The commits' statuses, kept and forgotten with the rest. */
  readonly statuses: CommitStatusMemo;
  /**
   * How many reads so far met a Gitea 401 no token recovered. A read is shared by every reader
   * that asks while it runs, but only the one whose client sent it is told of the 401; a reader
   * that sees this move while it read has met it too, and answered nothing.
   */
  readonly unauthorized: () => number;
  /**
   * Whether each org a listing answered for is made, by owner: `true` for a listing, `false` for a
   * `404` on one never listed — the broker has not made it yet. One listed once stays made: its
   * `404` is a failure, and its readers keep what they held. An org never answered for, or
   * answered only with another failure, is absent: nothing is proved. The same map until an
   * answer changes it.
   */
  readonly organizations: () => ReadonlyMap<string, boolean>;
  /** Told when {@link organizations} changes; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
  /**
   * Drops what is kept for an owner — or one repository, or some of its parts — and every read
   * running for it: a verb changed it, and the next read asks Gitea.
   */
  readonly forget: (owner: string, repo?: string, parts?: ReadonlySet<ForgePart>) => void;
}

interface KeptRead {
  readonly owner: string;
  readonly repo: string;
  readonly part: ForgeReadRef["part"];
  readonly value: unknown;
  readonly signature: string;
  readonly atMs: number;
}

interface Listing {
  readonly gate: OrgGate;
  readonly repositories: ReadonlyArray<GiteaRepository>;
  readonly atMs: number;
  /** The account listing it was cut from; `undefined` for the org's own listing. */
  readonly from: AccountListing | undefined;
}

const signatureOf = (value: unknown): string => JSON.stringify(value) ?? "";

/** A Gitea 404, as the client throws it: here, an org the broker has not made yet. */
export const giteaNotFound = (cause: unknown): boolean =>
  cause instanceof GiteaApiError && cause.status === 404;

/** A Gitea 401 no token recovered, as the client throws it. */
export const giteaUnauthorized = (cause: unknown): boolean =>
  cause instanceof GiteaApiError && cause.status === 401;

export function createForgeReads(options: { readonly now?: () => number } = {}): ForgeReads {
  const now = options.now ?? Date.now;
  const memo = createCommitStatusMemo({ now });
  let unauthorized = 0;
  /** `load`, counting a 401 it meets. */
  const counted =
    <T>(load: () => Promise<T>) =>
    (): Promise<T> =>
      load().catch((cause: unknown) => {
        if (giteaUnauthorized(cause)) unauthorized += 1;
        throw cause;
      });
  const statuses: CommitStatusMemo = {
    read: (commit, load, readOptions) => memo.read(commit, counted(load), readOptions),
    forget: memo.forget,
  };
  const listings = new Map<string, Listing>();
  const listing = new Map<string, Promise<ReadonlyArray<GiteaRepository>>>();
  /** This refresh's first tick: a tick within {@link ACCOUNT_BURST_MS} after it joins it. */
  let burstMs = Number.NEGATIVE_INFINITY;
  /** The last account listing, and the one running: shared by every org of their refresh. */
  let account: AccountListing | undefined;
  let accountRead: { readonly read: Promise<AccountListing>; readonly atMs: number } | undefined;
  /** Until when each org is listed on its own, the account left alone. */
  let skipUntilMs = Number.NEGATIVE_INFINITY;
  /** Who the person is, asked once — again after a 401, whose next token may be someone else's. */
  let person: { readonly id: Promise<number>; readonly unauthorized: number } | undefined;
  /** Each owner's last `404`, shared like a listing while it is fresh. */
  const notFound = new Map<string, { readonly cause: unknown; readonly atMs: number }>();
  let organizations: ReadonlyMap<string, boolean> = new Map();
  /** Owners whose listing answered once: made, so a `404` after is a failure, never "not yet". */
  const listedOnce = new Set<string>();
  const listeners = new Set<() => void>();
  const made = (owner: string, exists: boolean) => {
    if (organizations.get(owner) === exists) return;
    organizations = new Map(organizations).set(owner, exists);
    for (const listener of listeners) listener();
  };
  const kept = new Map<string, KeptRead>();
  const inFlight = new Map<
    string,
    { readonly owner: string; readonly repo: string; readonly part: string; read: Promise<unknown> }
  >();
  /** Bumped by every drop, per repository part: a read that started under an older one keeps nothing. */
  const generations = new Map<string, number>();
  const partKey = (owner: string, repo: string, part: string) => `${owner}/${repo}\u0000${part}`;
  const keyOf = (ref: ForgeReadRef) => `${partKey(ref.owner, ref.repo, ref.part)}\u0000${ref.key}`;

  const forget = (owner: string, repo?: string, parts: ReadonlySet<ForgePart> = EVERYTHING) => {
    const covers = (entry: { owner: string; repo: string; part: string }) =>
      entry.owner === owner &&
      (repo === undefined || entry.repo === repo) &&
      parts.has(entry.part as ForgePart);
    const dropped = new Set<string>();
    for (const [key, entry] of kept) {
      if (!covers(entry)) continue;
      kept.delete(key);
      dropped.add(partKey(entry.owner, entry.repo, entry.part));
    }
    for (const [key, entry] of inFlight) {
      if (!covers(entry)) continue;
      inFlight.delete(key);
      dropped.add(partKey(entry.owner, entry.repo, entry.part));
    }
    for (const scope of dropped) generations.set(scope, (generations.get(scope) ?? 0) + 1);
    if (parts.has("statuses")) statuses.forget(owner, repo);
  };

  const personId = (currentUser: () => Promise<{ readonly id: number }>): Promise<number> => {
    if (person !== undefined && person.unauthorized === unauthorized) return person.id;
    const asked = { id: counted(currentUser)().then((user) => user.id), unauthorized };
    person = asked;
    asked.id.catch(() => {
      if (person === asked) person = undefined;
    });
    return asked.id;
  };

  /**
   * This refresh's listing of the person's whole account, shared by every org that asks while it
   * is `freshMs` old — or `undefined`: each org is listed on its own.
   */
  const accountListing = (
    lists: RepositoryLists,
    at: number,
    freshMs: number,
  ): Promise<AccountListing | undefined> => {
    const { currentUser, listAccountRepositories } = lists;
    if (currentUser === undefined || listAccountRepositories === undefined || at < skipUntilMs) {
      return Promise.resolve(undefined);
    }
    // This refresh's listing while it is fresh; after that, an org read before the next tick — a
    // group created a moment ago, a deploy key that changed — lists itself, never the account.
    if (accountRead !== undefined && accountRead.atMs >= burstMs) {
      return at - accountRead.atMs < freshMs ? accountRead.read : Promise.resolve(undefined);
    }
    if (account !== undefined && account.atMs >= burstMs) {
      return Promise.resolve(at - account.atMs < freshMs ? account : undefined);
    }
    // The last one named none of the orgs asked of it: the person is on no group's team.
    if (account?.byOwner !== undefined && account.served === 0 && account.missed > 0) {
      skipUntilMs = account.atMs + ACCOUNT_SKIP_MS;
      account = undefined;
      if (at < skipUntilMs) return Promise.resolve(undefined);
    }
    const before = account;
    const read = personId(currentUser)
      .then((id) => counted(() => listAccountRepositories(id))())
      .then(
        (listing): AccountListing => {
          const split = splitAccountListing(listing);
          const unsure = split.kind === "unsure";
          if (split.kind === "capped" || (unsure && before?.unsure === true)) {
            skipUntilMs = at + ACCOUNT_SKIP_MS;
          }
          const byOwner = split.kind === "split" ? split.byOwner : undefined;
          return { byOwner, atMs: at, unsure, served: 0, missed: 0 };
        },
        (cause: unknown): AccountListing => {
          // The session's: every reader is told. Anything else — a page that timed out — and each
          // org of this refresh is listed on its own, as before.
          if (giteaUnauthorized(cause)) throw cause;
          return { byOwner: undefined, atMs: at, unsure: false, served: 0, missed: 0 };
        },
      )
      .then((whole) => {
        account = whole;
        return whole;
      })
      .finally(() => {
        if (accountRead?.read === read) accountRead = undefined;
      });
    accountRead = { read, atMs: at };
    return read;
  };

  return {
    tick: () => {
      const at = now();
      if (at - burstMs >= ACCOUNT_BURST_MS) burstMs = at;
    },
    statuses,
    forget,
    unauthorized: () => unauthorized,
    organizations: () => organizations,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    repositories: (owner, lists, listOptions) => {
      const held = listings.get(owner);
      const at = now();
      const freshMs = listOptions?.maxAgeMs ?? GATE_FRESH_MS;
      const missing = notFound.get(owner);
      // A 404 answers its own refresh, never the next tick's: the broker may have made it since.
      if (missing !== undefined && missing.atMs >= burstMs && at - missing.atMs < freshMs) {
        return Promise.reject(missing.cause);
      }
      // Never a listing made before this refresh's tick: the watch's of a moment ago is not it.
      if (
        missing === undefined &&
        held !== undefined &&
        held.atMs >= burstMs &&
        at - held.atMs < freshMs
      ) {
        return Promise.resolve(held.repositories);
      }
      const running = listing.get(owner);
      if (running !== undefined) return running;
      /** What a listing answered for `owner`, as its gate keeps it and the readers see it. */
      const listed = (
        repositories: ReadonlyArray<GiteaRepository>,
        atMs: number,
        from: AccountListing | undefined,
      ) => {
        const previous = listings.get(owner)?.gate;
        const plan = planGateReads(previous, repositories, atMs);
        for (const [repo, parts] of plan.reread) forget(owner, repo, parts);
        if (previous !== undefined) listOptions?.moved?.(plan.reread);
        listings.set(owner, { gate: plan.gate, repositories, atMs, from });
        notFound.delete(owner);
        listedOnce.add(owner);
        made(owner, true);
        return repositories;
      };
      /** The org's own listing: for an org the account listing does not name, or could not. */
      const ownListing = () =>
        counted(() => lists.listOrganizationRepositories(owner))().then(
          (repositories) => listed(repositories, at, undefined),
          (cause: unknown) => {
            if (giteaNotFound(cause)) {
              notFound.set(owner, { cause, atMs: at });
              if (!listedOnce.has(owner)) made(owner, false);
            }
            throw cause;
          },
        );
      const read = accountListing(lists, at, freshMs)
        .then((whole) => {
          if (whole?.byOwner === undefined) return ownListing();
          const named = whole.byOwner.get(ownerKey(owner));
          if (named === undefined) {
            // A miss only when the org is there: a 404 is one the broker has not made yet.
            return ownListing().then((repositories) => {
              whole.missed += 1;
              return repositories;
            });
          }
          whole.served += 1;
          const current = listings.get(owner);
          // Another reader of this org already took its part of this listing.
          if (current?.from === whole) return current.repositories;
          return listed(named, whole.atMs, whole);
        })
        .finally(() => {
          listing.delete(owner);
        });
      listing.set(owner, read);
      return read;
    },

    read: <T>(
      ref: ForgeReadRef,
      load: () => Promise<T>,
      readOptions?: { readonly maxAgeMs?: number | undefined },
    ): Promise<ForgeRead<T>> => {
      const vouched = gateKnown(listings.get(ref.owner)?.gate.get(ref.repo));
      const at = now();
      if (!vouched) {
        return counted(load)().then((value) => ({ value, atMs: at, changed: true }));
      }
      const key = keyOf(ref);
      const held = kept.get(key);
      const maxAgeMs = readOptions?.maxAgeMs ?? Number.POSITIVE_INFINITY;
      if (held !== undefined && at - held.atMs < maxAgeMs) {
        return Promise.resolve({ value: held.value as T, atMs: held.atMs, changed: false });
      }
      const running = inFlight.get(key);
      if (running !== undefined) return running.read as Promise<ForgeRead<T>>;
      const scope = partKey(ref.owner, ref.repo, ref.part);
      const generation = generations.get(scope) ?? 0;
      const current = () => (generations.get(scope) ?? 0) === generation;
      const read = counted(load)().then(
        (value): ForgeRead<T> => {
          const signature = signatureOf(value);
          const changed = held === undefined || held.signature !== signature;
          if (current()) {
            inFlight.delete(key);
            kept.set(key, { ...ref, value, signature, atMs: at });
          }
          return { value, atMs: at, changed };
        },
        (cause: unknown) => {
          if (current()) inFlight.delete(key);
          throw cause;
        },
      );
      inFlight.set(key, { owner: ref.owner, repo: ref.repo, part: ref.part, read });
      return read;
    },
  };
}
