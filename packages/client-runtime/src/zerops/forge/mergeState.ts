/**
 * Whether a pull request merges, as one projection for every surface that asks (DESIGN §4.7
 * "MergeState", A7, A11).
 *
 * Gitea recomputes `mergeable` after every push to either side of a pull request, and answers
 * `false` for about two seconds while it does (A11, measured 2026-09-23) — so a `false` that soon
 * after a push is not a verdict. `true` is mergeable at once. `false`, `null` or no answer is
 * `checking`; a `false` is `conflicting` only once {@link MERGE_CHECKING_WINDOW_MS} have passed
 * since these head and base shas were first read, and a read that knows neither sha can never be
 * one. The forge store reads a pull request that is checking again at
 * {@link MERGE_RECHECK_AFTER_MS} while it is demanded.
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module forge/mergeState
 */
import type { GiteaPullRequest } from "../giteaClient.ts";
import type { GitCheckTone } from "../gitTab.ts";
import type { Shown } from "../knowledge/known.ts";

/** A `false` this soon after the head or base sha changed is Gitea still checking. */
export const MERGE_CHECKING_WINDOW_MS = 5_000;

/** A pull request that is checking is read again this long after it started checking. */
export const MERGE_RECHECK_AFTER_MS: ReadonlyArray<number> = [2_000, 5_000, 10_000];

export type Mergeability =
  | { readonly kind: "checking"; readonly sinceMs: number; readonly falseReads: number }
  | { readonly kind: "mergeable" }
  | { readonly kind: "conflicting" };

/** How an open pull request merges, as far as a surface that draws it needs to know. */
export type MergeabilityKind = Mergeability["kind"];

export type MergeState =
  | {
      readonly kind: "merged";
      /** When it landed; `null` where Gitea sent no time. */
      readonly atMs: number | null;
      /** The commit it landed as; `null` where Gitea sent none. */
      readonly sha: string | null;
    }
  | { readonly kind: "closed" }
  | {
      readonly kind: "open";
      readonly mergeability: Mergeability;
      readonly checks: Shown<GitCheckTone>;
    };

/** One read of a pull request, as far as whether it merges goes. */
export interface MergeRead {
  readonly mergeable: boolean | null | undefined;
  readonly headSha: string | undefined;
  readonly baseSha: string | undefined;
  /** When the read started. */
  readonly atMs: number;
}

/** What one pull request's reads have shown so far. */
export interface MergeabilityTrack {
  readonly mergeability: Mergeability;
  /** When a read first saw these head and base shas. */
  readonly seenAtMs: number;
  /** The shas the last read was about: a read about others starts over. */
  readonly headSha: string | undefined;
  readonly baseSha: string | undefined;
}

/** One read of `pull`, started at `atMs`. */
export function mergeReadOf(pull: GiteaPullRequest, atMs: number): MergeRead {
  return { mergeable: pull.mergeable, headSha: pull.head?.sha, baseSha: pull.base?.sha, atMs };
}

/**
 * The mergeability after one more read. `track` is `null` for a pull request not read before, or
 * one whose earlier reads no longer count — its base moved, say. A read about another head or
 * base than the last one is a new question, so the earlier reads do not count for it either: its
 * window, and its checking with the rechecks keyed on when that began, start at that read.
 */
export function mergeabilityAfter(
  track: MergeabilityTrack | null,
  read: MergeRead,
): MergeabilityTrack {
  const prior =
    track !== null && track.headSha === read.headSha && track.baseSha === read.baseSha
      ? track
      : null;
  const next = {
    seenAtMs: prior?.seenAtMs ?? read.atMs,
    headSha: read.headSha,
    baseSha: read.baseSha,
  };
  if (read.mergeable === true) return { mergeability: { kind: "mergeable" }, ...next };
  const known = read.headSha !== undefined && read.baseSha !== undefined;
  if (read.mergeable === false && known && read.atMs - next.seenAtMs >= MERGE_CHECKING_WINDOW_MS) {
    return { mergeability: { kind: "conflicting" }, ...next };
  }
  const checking =
    prior?.mergeability.kind === "checking"
      ? prior.mergeability
      : { kind: "checking" as const, sinceMs: read.atMs, falseReads: 0 };
  const falseReads = checking.falseReads + (read.mergeable === false ? 1 : 0);
  return { mergeability: { ...checking, falseReads }, ...next };
}

/**
 * The mergeability of every pull request one surface reads, over the reads it has made — for a
 * surface that reads Gitea itself rather than through the forge store. Keys are the surface's
 * own, one per pull request.
 */
export interface MergeabilityTracker {
  readonly after: (key: string, read: MergeRead) => Mergeability;
}

export function createMergeabilityTracker(): MergeabilityTracker {
  const tracks = new Map<string, MergeabilityTrack>();
  return {
    after: (key, read) => {
      const track = mergeabilityAfter(tracks.get(key) ?? null, read);
      tracks.set(key, track);
      return track.mergeability;
    },
  };
}

/** The pull request as every surface sees it: landed, closed, or open and how it merges. */
export function mergeStateOf(
  pull: GiteaPullRequest,
  mergeability: Mergeability,
  checks: Shown<GitCheckTone>,
): MergeState {
  if (pull.merged === true) {
    const atMs = pull.merged_at === undefined ? Number.NaN : Date.parse(pull.merged_at);
    return {
      kind: "merged",
      atMs: Number.isNaN(atMs) ? null : atMs,
      sha: pull.merge_commit_sha ?? null,
    };
  }
  if (pull.state !== "open") return { kind: "closed" };
  return { kind: "open", mergeability, checks };
}
