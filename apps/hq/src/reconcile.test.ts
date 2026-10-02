// @effect-diagnostics nodeBuiltinImport:off -- the tests write a repository behind Core's back with the host's git.
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { mateInApp } from "../test/harness/mates.ts";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";

/** `git <args>` on the bare repository `dir`, as Ada; its output. */
const bareAt =
  (dir: string) =>
  (args: ReadonlyArray<string>, input = "") =>
    NodeChildProcess.execFileSync("git", ["--git-dir", dir, ...args], {
      input,
      encoding: "utf8",
      env: {
        PATH: process.env["PATH"] ?? "/usr/bin:/bin",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_AUTHOR_NAME: "Ada",
        GIT_AUTHOR_EMAIL: "ada@mate.test",
        GIT_COMMITTER_NAME: "Ada",
        GIT_COMMITTER_EMAIL: "ada@mate.test",
      },
    }).trim();

/** A commit on `parent` adding `file`; its sha. */
const commitOn = (
  bare: ReturnType<typeof bareAt>,
  parent: string,
  file: string,
  message: string,
) => {
  const base = bare(["ls-tree", parent]).split("\n").filter(Boolean);
  const blob = bare(["hash-object", "-w", "--stdin"], `${file}\n`);
  const tree = bare(["mktree"], [...base, `100644 blob ${blob}\t${file}`, ""].join("\n"));
  return bare(["commit-tree", tree, "-p", parent, "-m", message]);
};

describe("HQ's records and git that moved past them", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("numbers a new change past every change branch, recorded or not", () =>
      Effect.gen(function* () {
        const { call, fake, gitRoot } = yield* startCore(true);
        yield* untilHealth(call, "active");
        const owner = yield* sessionFor(call, "door-owner");
        const ada = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
        yield* call("POST", "/api/mate/repos", { headers: ada.auth, body: { name: "appdev" } });
        // A branch no record names: a change opened after the records a restore brought back.
        const appdev = bareAt(NodePath.join(gitRoot, ada.appId, "appdev.git"));
        const main = appdev(["rev-parse", "refs/heads/main"]);
        appdev([
          "update-ref",
          "refs/heads/mate/P_GHOST/7",
          commitOn(appdev, main, "ghost.txt", "Ghost"),
        ]);
        const opened = yield* call("POST", "/api/mate/changes", {
          headers: ada.auth,
          body: { repo: "appdev", title: "Ada's" },
        });
        assert.strictEqual(
          (opened.body as { readonly change: { readonly number: number } }).change.number,
          8,
        );
      }),
    );
  });
});
