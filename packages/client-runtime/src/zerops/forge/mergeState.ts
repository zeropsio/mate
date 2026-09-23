/**
 * Whether a pull request merges, as one projection for every surface that asks (DESIGN §4.7
 * "MergeState", A7).
 *
 * Gitea recomputes `mergeable` after every push to either side of a pull request, and while it
 * does it answers `false` or `null` — so one `false` is not a verdict. `true` is mergeable at
 * once. `false`, `null` or no answer is `checking`; a pull request is `conflicting` only after a
 * second `false` at least {@link MERGE_CONFLICT_CONFIRM_MS} after the first, over the same head
 * and base shas. A read that knows neither sha can never confirm a conflict, and a `null` starts
 * the count again. The forge store reads a pull request that is checking again at
 * {@link MERGE_RECHECK_AFTER_MS} while it is demanded.
 *
 * The parameters are provisional until the OQ-4 measurement of Gitea's `mergeable` sequence
 * (D8).
 *
 * Pure: no network, no clock, no platform globals (rule R1).
 *
 * @module forge/mergeState
 */
import type { GiteaPullRequest } from "../giteaClient.ts";
import type { GitCheckTone } from "../gitTab.ts";
import type { Shown } from "../knowledge/known.ts";

/** A second `false` this long after the first, over the same shas, is a conflict. */
export const MERGE_CONFLICT_CONFIRM_MS = 5_000;

/** A pull request that is checking is read again this long after it started checking. */
export const MERGE_RECHECK_AFTER_MS: ReadonlyArray<number> = [2_000, 5_000, 10_000];

export type Mergeability =
  | { readonly kind: "checking"; readonly sinceMs: number; readonly falseReads: number }
  | { readonly kind: "mergeable" }
  | { readonly kind: "conflicting" };

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
  /** When the current run of `false` reads began; `null` outside one. */
  readonly firstFalseAtMs: number | null;
  /** The shas the last read was about: a read about others starts over. */
  readonly headSha: string | undefined;
  readonly baseSha: string | undefined;
}

/** Checking, from when the prior track started checking or else from `atMs`. */
const checkingFrom = (
  prior: MergeabilityTrack | null,
  atMs: number,
): Extract<Mergeability, { kind: "checking" }> =>
  prior?.mergeability.kind === "checking"
    ? { ...prior.mergeability, falseReads: 0 }
    : { kind: "checking", sinceMs: atMs, falseReads: 0 };

/**
 * The mergeability after one more read. `track` is `null` for a pull request not read before, or
 * one whose earlier reads no longer count — its base moved, say. A read about another head or
 * base than the last one is a new question, so the earlier reads do not count for it either, and
 * its checking — with the rechecks keyed on when that began — starts at that read.
 */
export function mergeabilityAfter(
  track: MergeabilityTrack | null,
  read: MergeRead,
): MergeabilityTrack {
  const shas = { headSha: read.headSha, baseSha: read.baseSha };
  const prior =
    track !== null && track.headSha === read.headSha && track.baseSha === read.baseSha
      ? track
      : null;
  if (read.mergeable === true) {
    return { mergeability: { kind: "mergeable" }, firstFalseAtMs: null, ...shas };
  }
  if (read.mergeable !== false || read.headSha === undefined || read.baseSha === undefined) {
    return { mergeability: checkingFrom(prior, read.atMs), firstFalseAtMs: null, ...shas };
  }
  const firstFalseAtMs = prior?.firstFalseAtMs ?? null;
  if (firstFalseAtMs === null) {
    const checking = checkingFrom(prior, read.atMs);
    return { mergeability: { ...checking, falseReads: 1 }, firstFalseAtMs: read.atMs, ...shas };
  }
  if (read.atMs - firstFalseAtMs >= MERGE_CONFLICT_CONFIRM_MS) {
    return { mergeability: { kind: "conflicting" }, firstFalseAtMs, ...shas };
  }
  const checking = checkingFrom(prior, firstFalseAtMs);
  const falseReads = prior?.mergeability.kind === "checking" ? prior.mergeability.falseReads : 0;
  return { mergeability: { ...checking, falseReads: falseReads + 1 }, firstFalseAtMs, ...shas };
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
