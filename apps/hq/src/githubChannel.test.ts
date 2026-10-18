import { assert, describe, it } from "@effect/vitest";

import { statusWords } from "./githubChannel.ts";

/** What a person reads: the words with GitHub's mention breakers taken out. */
const read = (words: string) => words.replaceAll("⁠", "");

describe("a task's status line on its issue", () => {
  it.each([
    ["waiting", { kind: "waiting", mate: "Nova", question: "@org/team please see #12 and GH-3" }],
    ["failed", { kind: "failed", mate: "Nova", why: "acme/tea-shop#1 broke; ask @nova" }],
    ["stopped", { kind: "stopped", mate: null, why: "see #12" }],
  ] as const)(
    "a %s line pings nobody and links no other issue, reading the same",
    (_kind, status) => {
      const words = statusWords(status);
      assert.notMatch(words, /@[\w-]|#\d|GH-\d/u);
      if (status.kind === "waiting") assert.include(read(words), status.question);
      else assert.include(read(words), status.why);
    },
  );

  it("a change merged in Mate says so with its change, and a pull request merged names it", () => {
    // A repository mirrored through no app has no pull request: the change itself was merged.
    assert.strictEqual(
      statusWords({ kind: "merged", mate: "Nova", change: "https://mate.zerops.io/c/3" }),
      "Merged into main: https://mate.zerops.io/c/3",
    );
    assert.strictEqual(
      statusWords({
        kind: "merged",
        mate: "Nova",
        pullRequest: { number: 2, url: "https://github.com/acme/tea-shop/pull/2" },
      }),
      "Merged in #2.",
    );
  });
});
