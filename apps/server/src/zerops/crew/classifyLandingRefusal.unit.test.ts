import { expect, it } from "vite-plus/test";

import { classifyLandingRefusal } from "./classifyLandingRefusal.ts";

/**
 * Stderr of `git merge --ff-only <S>` into the integration tree, captured from
 * git 2.50 under `LC_ALL=C` (the locale every crew git line runs in). Only
 * the repository path was replaced with the service's. The full-disk row is
 * the one not captured: git appends `strerror(ENOSPC)` to its write error.
 */
// witness: apps/server/src/zerops/crew/classifyLandingRefusal.ts | if (!line.startsWith("\t")) break; → if (line.length === 0) break;
it("CM32: A landing Git refused for the person's uncommitted or untracked files waits on the person and names exactly the paths Git listed", () => {
  expect(
    classifyLandingRefusal(
      [
        "error: Your local changes to the following files would be overwritten by merge:",
        "\tsrc/ui/hud.ts",
        "\tsrc/ui/menu.ts",
        "Please commit your changes or stash them before you merge.",
        "Aborting",
        "Updating c24c61b..4615357",
      ].join("\n"),
    ),
  ).toEqual({ kind: "dirty", action: "wait", paths: ["src/ui/hud.ts", "src/ui/menu.ts"] });
  expect(
    classifyLandingRefusal(
      [
        "error: The following untracked working tree files would be overwritten by merge:",
        "\tb.txt",
        "Please move or remove them before you merge.",
        "Aborting",
        "Updating c24c61b..4615357",
      ].join("\n"),
    ),
  ).toEqual({ kind: "untracked", action: "wait", paths: ["b.txt"] });
});

// witness: apps/server/src/zerops/crew/classifyLandingRefusal.ts | return { kind: "no-space", action: "park" }; → return { kind: "missing-object", action: "retry" };
it("CM33: A landing Git refused as not a fast-forward is merged again, one stopped by index.lock backs off, a missing object is retried, a full disk parks, and any other refusal parks with Git's first error line", () => {
  expect(
    classifyLandingRefusal(
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
    ),
  ).toEqual({ kind: "not-fast-forward", action: "redo" });
  expect(
    classifyLandingRefusal(
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
    ),
  ).toEqual({ kind: "index-lock", action: "backoff" });
  expect(
    classifyLandingRefusal(
      "merge: 1111111111111111111111111111111111111111 - not something we can merge",
    ),
  ).toEqual({ kind: "missing-object", action: "retry" });
  expect(
    classifyLandingRefusal(
      [
        "error: unable to read sha1 file of src/app.ts (b66ba06d315d46280bb09d54614cc52d1677809f)",
        "Updating 4615357..be6b443",
      ].join("\n"),
    ),
  ).toEqual({ kind: "missing-object", action: "retry" });
  expect(
    classifyLandingRefusal("error: unable to write file src/app.ts: No space left on device"),
  ).toEqual({ kind: "no-space", action: "park" });
  expect(classifyLandingRefusal("fatal: something nobody has seen yet")).toEqual({
    kind: "unknown",
    action: "park",
    detail: "fatal: something nobody has seen yet",
  });
});
