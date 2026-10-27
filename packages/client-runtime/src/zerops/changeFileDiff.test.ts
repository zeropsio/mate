import { describe, expect, it } from "vite-plus/test";

import { changeFileDiffState } from "./changeFileDiff.ts";

const PATCH = [
  "diff --git a/a.ts b/a.ts",
  "index 1111111..2222222 100644",
  "--- a/a.ts",
  "+++ b/a.ts",
  "@@ -1 +1,2 @@",
  " line",
  "+added",
  "",
].join("\n");

describe("changeFileDiffState: a file's diff, read when the person unfolds it", () => {
  it.each([
    { name: "not asked for yet", view: undefined, kind: "reading" },
    { name: "being read", view: { state: "unread" }, kind: "reading" },
    { name: "held back until access is verified", view: { state: "withheld" }, kind: "reading" },
    { name: "refused", view: { state: "refused", words: "No." }, kind: "failed" },
    { name: "unreachable", view: { state: "failed", words: "Offline." }, kind: "failed" },
  ] as const)("is $kind while $name", ({ view, kind }) => {
    expect(changeFileDiffState(view, "a.ts").kind).toBe(kind);
  });

  it("is the file's lines once its box answered", () => {
    const state = changeFileDiffState({ state: "known", answer: { hunks: PATCH } }, "a.ts");
    expect(state).toMatchObject({ kind: "read", cut: false });
    expect(state.kind === "read" ? state.file?.hunks.length : 0).toBe(1);
  });

  it("says a diff too long to read here is cut", () => {
    expect(changeFileDiffState({ state: "known", answer: { hunks: null } }, "a.ts")).toEqual({
      kind: "read",
      file: undefined,
      cut: true,
    });
  });
});
