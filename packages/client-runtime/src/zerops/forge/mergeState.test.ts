import { describe, expect, it } from "vite-plus/test";

import type { GiteaPullRequest } from "../giteaClient.ts";
import {
  MERGE_CONFLICT_CONFIRM_MS,
  mergeabilityAfter,
  mergeStateOf,
  type MergeabilityTrack,
  type MergeRead,
} from "./mergeState.ts";

const read = (
  mergeable: boolean | null | undefined,
  atMs: number,
  shas: { readonly head?: string; readonly base?: string } = { head: "h1", base: "b1" },
): MergeRead => ({ mergeable, atMs, headSha: shas.head, baseSha: shas.base });

/** The mergeability each read leaves, in order. */
function kinds(reads: ReadonlyArray<MergeRead>): ReadonlyArray<string> {
  let track: MergeabilityTrack | null = null;
  const seen: Array<string> = [];
  for (const next of reads) {
    track = mergeabilityAfter(track, next);
    seen.push(track.mergeability.kind);
  }
  return seen;
}

describe("MergeState over Gitea's mergeable reads (DESIGN §4.7, A7)", () => {
  it("false then true within 5 s reads Checking, never Needs a rebase", () => {
    expect(kinds([read(false, 0), read(false, 2_000), read(true, 4_000)])).toEqual([
      "checking",
      "checking",
      "mergeable",
    ]);
    expect(MERGE_CONFLICT_CONFIRM_MS).toBe(5_000);
  });

  it.each([
    {
      name: "a second false 5 s later over the same shas is a conflict",
      reads: [read(false, 0), read(false, 5_000)],
      seen: ["checking", "conflicting"],
    },
    {
      name: "a second false sooner is still checking",
      reads: [read(false, 0), read(false, 4_999)],
      seen: ["checking", "checking"],
    },
    {
      name: "a new head starts the count again",
      reads: [read(false, 0), read(false, 5_000, { head: "h2", base: "b1" })],
      seen: ["checking", "checking"],
    },
    {
      name: "a new base starts the count again",
      reads: [read(false, 0), read(false, 5_000, { head: "h1", base: "b2" })],
      seen: ["checking", "checking"],
    },
    {
      name: "reads that know no shas never prove a conflict",
      reads: [read(false, 0, {}), read(false, 60_000, {})],
      seen: ["checking", "checking"],
    },
    {
      name: "null is not a verdict and starts the count again",
      reads: [read(false, 0), read(null, 2_000), read(false, 5_000), read(false, 10_000)],
      seen: ["checking", "checking", "checking", "conflicting"],
    },
    {
      name: "no answer at all is checking, never a negative",
      reads: [read(undefined, 0), read(undefined, 30_000)],
      seen: ["checking", "checking"],
    },
    {
      name: "true is mergeable at once, and a false after it is checking again",
      reads: [read(true, 0), read(false, 1_000)],
      seen: ["mergeable", "checking"],
    },
    {
      name: "a conflict that is resolved merges",
      reads: [read(false, 0), read(false, 5_000), read(true, 6_000)],
      seen: ["checking", "conflicting", "mergeable"],
    },
  ])("$name", ({ reads, seen }) => {
    expect(kinds(reads)).toEqual(seen);
  });

  it("checking keeps the time it started and counts its false reads", () => {
    let track = mergeabilityAfter(null, read(false, 1_000));
    track = mergeabilityAfter(track, read(false, 3_000));
    expect(track.mergeability).toEqual({ kind: "checking", sinceMs: 1_000, falseReads: 2 });
    track = mergeabilityAfter(track, read(null, 4_000));
    expect(track.mergeability).toEqual({ kind: "checking", sinceMs: 1_000, falseReads: 0 });
  });

  it("a new head or base starts checking over from the read that saw it", () => {
    let track = mergeabilityAfter(null, read(null, 0));
    track = mergeabilityAfter(track, read(null, 10_000));
    expect(track.mergeability).toEqual({ kind: "checking", sinceMs: 0, falseReads: 0 });
    track = mergeabilityAfter(track, read(false, 10_500, { head: "h2", base: "b1" }));
    expect(track.mergeability).toEqual({ kind: "checking", sinceMs: 10_500, falseReads: 1 });
    track = mergeabilityAfter(track, read(null, 11_000, { head: "h2", base: "b2" }));
    expect(track.mergeability).toEqual({ kind: "checking", sinceMs: 11_000, falseReads: 0 });
  });

  it("a landed pull request says when and as what, a closed one only that it closed", () => {
    const pull = (over: Partial<GiteaPullRequest>): GiteaPullRequest => ({
      number: 4,
      title: "Add a due date",
      state: "open",
      ...over,
    });
    const { mergeability } = mergeabilityAfter(null, read(true, 0));
    const checks = { state: "unread", waitingFor: null } as const;
    expect(
      mergeStateOf(
        pull({
          state: "closed",
          merged: true,
          merged_at: "2026-09-20T10:00:00Z",
          merge_commit_sha: "m1",
        }),
        mergeability,
        checks,
      ),
    ).toEqual({ kind: "merged", atMs: Date.parse("2026-09-20T10:00:00Z"), sha: "m1" });
    expect(mergeStateOf(pull({ state: "closed", merged: true }), mergeability, checks)).toEqual({
      kind: "merged",
      atMs: null,
      sha: null,
    });
    expect(mergeStateOf(pull({ state: "closed" }), mergeability, checks)).toEqual({
      kind: "closed",
    });
    expect(mergeStateOf(pull({}), mergeability, checks)).toEqual({
      kind: "open",
      mergeability: { kind: "mergeable" },
      checks,
    });
  });
});
