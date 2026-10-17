import { describe, expect, it } from "vite-plus/test";
import * as Schema from "effect/Schema";

import { ReviewDiffFileContentsInput, ReviewDiffPreviewInput } from "./review.ts";

const decodePreviewInput = Schema.decodeUnknownSync(ReviewDiffPreviewInput);
const decodeFileContentsInput = Schema.decodeUnknownSync(ReviewDiffFileContentsInput);

const fileContents = (refs: { baseRef: string; headRef: string }) =>
  decodeFileContentsInput({
    cwd: "/repo",
    sourceKind: "branch-range",
    changeType: "change",
    oldPath: "README.md",
    newPath: "README.md",
    ...refs,
  });

describe("review refs that git would read as an option", () => {
  const inputs = [
    {
      name: "ReviewDiffPreviewInput.baseRef",
      decode: (ref: string) => decodePreviewInput({ cwd: "/repo", baseRef: ref }),
    },
    {
      name: "ReviewDiffFileContentsInput.baseRef",
      decode: (ref: string) => fileContents({ baseRef: ref, headRef: "HEAD" }),
    },
    {
      name: "ReviewDiffFileContentsInput.headRef",
      decode: (ref: string) => fileContents({ baseRef: "main", headRef: ref }),
    },
  ];

  describe.each(inputs)("$name", ({ decode }) => {
    it.each(["--output=/tmp/x", "-p", "-"])("refuses %s", (ref) => {
      expect(() => decode(ref)).toThrow();
    });

    it.each(["main", "origin/main", "HEAD", "0123456789abcdef"])("accepts %s", (ref) => {
      expect(() => decode(ref)).not.toThrow();
    });
  });
});

describe("a commit's changes are asked for by the commit's own name", () => {
  it.each(["0123456", "0123456789abcdef0123456789abcdef01234567"])("accepts %s", (commit) => {
    expect(decodePreviewInput({ cwd: "/repo", commit })).toMatchObject({ commit });
  });

  it.each(["main", "HEAD~1", "--output=/tmp/x", "abc", "0123456 && rm"])(
    "refuses %s, which names no single commit",
    (commit) => {
      expect(() => decodePreviewInput({ cwd: "/repo", commit })).toThrow();
    },
  );
});
