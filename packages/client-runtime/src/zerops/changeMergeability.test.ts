import { describe, expect, it } from "vite-plus/test";

import { mergeabilityKindOf } from "./changeMergeability.ts";

describe("mergeabilityKindOf: HQ's word on whether a change merges, as every surface keys on it", () => {
  it.each([
    ["clean", "mergeable"],
    ["conflict", "conflicting"],
    // A branch that shares no history with main reads as a conflict that names no file.
    ["unrelated", "conflicting"],
    ["empty", "empty"],
    ["already_merged", "empty"],
    // The detail's word for a change nothing was pushed to.
    ["no_change", "empty"],
    // The record's, before HQ has judged it — nothing pushed, or past what a move of main judges.
    ["unknown", "checking"],
  ] as const)("%s reads %s", (kind, word) => {
    expect(mergeabilityKindOf(kind)).toBe(word);
  });
});
