import { assert, describe, it } from "@effect/vitest";

import { classifyLandingRefusal, type LandingRefusal } from "./classifyLandingRefusal.ts";

/**
 * Stderr of `git merge --ff-only <S>` into the integration tree, captured from
 * git 2.50 under `LC_ALL=C` (the locale every crew git line runs in). Only
 * the repository path was replaced with the service's. The full-disk row is
 * the one not captured: git appends `strerror(ENOSPC)` to its write error.
 */
const CAPTURED: ReadonlyArray<readonly [string, string, LandingRefusal]> = [
  [
    "a tracked path edited in the person's tree",
    [
      "error: Your local changes to the following files would be overwritten by merge:",
      "\tsrc/ui/hud.ts",
      "\tsrc/ui/menu.ts",
      "Please commit your changes or stash them before you merge.",
      "Aborting",
      "Updating c24c61b..4615357",
    ].join("\n"),
    { kind: "dirty", action: "wait", paths: ["src/ui/hud.ts", "src/ui/menu.ts"] },
  ],
  [
    "an untracked file in the way",
    [
      "error: The following untracked working tree files would be overwritten by merge:",
      "\tb.txt",
      "Please move or remove them before you merge.",
      "Aborting",
      "Updating c24c61b..4615357",
    ].join("\n"),
    { kind: "untracked", action: "wait", paths: ["b.txt"] },
  ],
  [
    "the head moved under the landing",
    [
      "hint: Diverging branches can't be fast-forwarded, you need to either:",
      "hint:",
      "hint: \tgit merge --no-ff",
      "hint:",
      "hint: or:",
      "hint:",
      "hint: \tgit rebase",
      "hint:",
      'hint: Disable this message with "git config set advice.diverging false"',
      "fatal: Not possible to fast-forward, aborting.",
    ].join("\n"),
    { kind: "not-fast-forward", action: "redo" },
  ],
  [
    "another git process holds the index",
    [
      "error: Unable to create '/var/www/.git/index.lock': File exists.",
      "",
      "Another git process seems to be running in this repository, e.g.",
      "an editor opened by 'git commit'. Please make sure all processes",
      "are terminated then try again. If it still fails, a git process",
      "may have crashed in this repository earlier:",
      "remove the file manually to continue.",
      "Updating c24c61b..4615357",
    ].join("\n"),
    { kind: "index-lock", action: "backoff" },
  ],
  [
    "the squash commit is not there",
    "merge: 1111111111111111111111111111111111111111 - not something we can merge",
    { kind: "missing-object", action: "retry" },
  ],
  [
    "an object that cannot be read",
    [
      "error: unable to read sha1 file of src/app.ts (b66ba06d315d46280bb09d54614cc52d1677809f)",
      "Updating 4615357..be6b443",
    ].join("\n"),
    { kind: "missing-object", action: "retry" },
  ],
  [
    "the disk is full",
    "error: unable to write file src/app.ts: No space left on device",
    { kind: "no-space", action: "park" },
  ],
  [
    "anything else",
    "fatal: something nobody has seen yet",
    { kind: "unknown", action: "park", detail: "fatal: something nobody has seen yet" },
  ],
];

describe("classifyLandingRefusal", () => {
  it.each(Array.from(CAPTURED, ([name, stderr, expected]) => ({ title: name, stderr, expected })))(
    "$title",
    ({ stderr, expected }) => {
      assert.deepStrictEqual(classifyLandingRefusal(stderr), expected);
    },
  );
});
