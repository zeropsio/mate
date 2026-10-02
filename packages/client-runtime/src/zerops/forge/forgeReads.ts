/**
 * What the group readers ask Gitea, read again only when the org's own listing says it moved —
 * for the readers that ask on a clock of their own rather than through the forge store
 * (`useZeropsGroupForge`, `useZeropsGroupDeploys`).
 *
 * Gitea has no event stream, so a clock is the only freshness there is; but one listing of an
 * org's repositories (`GET /orgs/{o}/repos`) carries, per repository, what moves with nearly
 * everything the group readers draw (measured on Gitea 1.27.2, 2026-10-02):
 *
 * - `updated_at` moves with every push to any branch — a commit through the contents API, a
 *   merge, a git push of a branch or a tag;
 * - `open_pr_counter` moves when a pull request opens, closes or merges;
 * - neither moves for a pull request's new title, a commit status, a branch made without a
 *   commit, or a tag made through the API (`POST /repos/{o}/{r}/tags`, what Release does).
 *
 * So each refresh lists each org once — shared by both readers while it is
 * {@link GATE_FRESH_MS} old — and what the listing moved is dropped: a pushed repository's pull
 * requests, code and commit statuses ({@link planGateReads}), only the pull requests where only
 * the counter moved. Everything else is answered from what was kept. A repository the listing
 * does not name, or names without those fields, is never kept. Tags, which the listing cannot
 * see, are read again at most every {@link TAGS_MAX_AGE_MS}. Commit statuses are the status
 * memo's: pending ones on its back-off, settled ones until forgotten — or, on a commit that still
 * takes contexts, on a slower back-off of their own (`forge/statusMemo.ts`).
 *
 * Every open tab re-read every group whole every minute — the org's repositories, each one's open
 * and closed pull requests, the group repo's tags, files and branches — about 160 requests a
 * minute per tab (pass 31, 2026-10-02: 317 in the first 140 s after a load). Now an idle tab
 * lists each org once a minute.
 *
 * @module forge/forgeReads
 */
import { GiteaApiError, type GiteaRepository } from "../giteaClient.ts";
import { createCommitStatusMemo, type CommitStatusMemo } from "./statusMemo.ts";

/** How long one listing of an org answers for every reader that asks: under the readers' clock. */
export const GATE_FRESH_MS = 30_000;

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
   * The org's repositories: one listing shared by every reader while it is {@link GATE_FRESH_MS}
   * old, and a listing that moved drops what it moved before it answers.
   */
  readonly repositories: (
    owner: string,
    load: () => Promise<ReadonlyArray<GiteaRepository>>,
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
}

const signatureOf = (value: unknown): string => JSON.stringify(value) ?? "";

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

  return {
    statuses,
    forget,
    unauthorized: () => unauthorized,

    repositories: (owner, load) => {
      const held = listings.get(owner);
      const at = now();
      if (held !== undefined && at - held.atMs < GATE_FRESH_MS) {
        return Promise.resolve(held.repositories);
      }
      const running = listing.get(owner);
      if (running !== undefined) return running;
      const read = counted(load)()
        .then((repositories) => {
          const plan = planGateReads(listings.get(owner)?.gate, repositories, at);
          for (const [repo, parts] of plan.reread) forget(owner, repo, parts);
          listings.set(owner, { gate: plan.gate, repositories, atMs: at });
          return repositories;
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
