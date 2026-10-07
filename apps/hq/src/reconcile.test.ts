// @effect-diagnostics nodeBuiltinImport:off -- the tests write a repository behind Core's back with the host's git.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";

import { addProject, mateInApp, rowsWhere } from "../test/harness/mates.ts";
import {
  type Call,
  enrollMate,
  sessionFor,
  startCore,
  untilHealth,
} from "../test/harness/runningCore.ts";
import { tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import type { FakeWorld } from "../test/harness/zeropsFake.ts";

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

/** A Mate of the application, set up and enrolled; its credential's header. */
const anotherMate = (
  call: Call,
  fake: FakeWorld,
  owner: string,
  appId: string,
  projectId: string,
) =>
  Effect.gen(function* () {
    addProject(fake, projectId);
    yield* call("POST", `/api/apps/${appId}/projects`, {
      session: owner,
      body: { projectId, kind: "mate", mate: { face: "face-2" } },
    });
    return { authorization: `Mate ${yield* enrollMate(call, fake, projectId)}` };
  });

describe("a takeover after git moved past HQ's records", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "records what git holds that the records lack, before Core leads, and refuses what git lacks",
      () =>
        Effect.gen(function* () {
          const first = yield* startCore(true);
          yield* untilHealth(first.call, "active");
          const owner = yield* sessionFor(first.call, "door-owner");
          const ada = yield* mateInApp(first.call, first.fake, owner, "P_MATE", "Shop");
          const { appId } = ada;
          yield* first.call("POST", "/api/mate/repos", {
            headers: ada.auth,
            body: { name: "appdev" },
          });
          // In the records: Ada's change 1 closed, her change 2 open; Bo's change 3 open.
          const open = (auth: Record<string, string>, title: string) =>
            first.call("POST", "/api/mate/changes", {
              headers: auth,
              body: { repo: "appdev", title },
            });
          yield* open(ada.auth, "Ada's first");
          yield* first.call("POST", `/api/apps/${appId}/changes/appdev/1/close`, {
            session: owner,
            body: { expectedHead: null },
          });
          yield* open(ada.auth, "Ada's second");
          const bo = yield* anotherMate(first.call, first.fake, owner, appId, "P_MATE2");
          yield* open(bo, "Bo's first");
          yield* first.stop;

          // What git came to hold after the records were taken (a set's git, newer than its dump).
          const appdev = bareAt(NodePath.join(first.gitRoot, appId, "appdev.git"));
          const main = appdev(["rev-parse", "refs/heads/main"]);
          const squashed = commitOn(
            appdev,
            main,
            "second.txt",
            "Ada's second (#2)\n\nMate-Change: P_MATE/2",
          );
          appdev(["update-ref", "refs/heads/main", squashed, main]);
          appdev([
            "update-ref",
            "refs/heads/mate/P_MATE/2",
            commitOn(appdev, main, "second.txt", "Second"),
          ]);
          const third = commitOn(appdev, squashed, "third.txt", "Third");
          appdev(["update-ref", "refs/heads/mate/P_MATE/4", third]);
          const bos = commitOn(appdev, squashed, "bo.txt", "Bo's");
          appdev(["update-ref", "refs/heads/mate/P_MATE2/5", bos]);
          const group = bareAt(NodePath.join(first.gitRoot, appId, `${RECIPE_REPO}.git`));
          const groupMain = group(["rev-parse", "refs/heads/main"]);
          group(["tag", "-a", "v0.1.0", "-m", `app ${squashed}`, groupMain]);
          bareAt(NodePath.join(first.gitRoot, appId, "extra.git"))(["init", "--bare", "-q"]);

          const next = yield* startCore(true, { url: first.url, gitRoot: first.gitRoot });
          addProject(next.fake, "P_MATE2");
          yield* Stream.runHead(Stream.filter(next.gitHost.recorded, (tick) => tick > 0));
          const now = (query: string) => rowsWhere(next.url, query, () => true);
          assert.deepStrictEqual(
            yield* now(
              `SELECT number, mate_project_id AS mate, state, head, merged_sha AS merged,
                      first_code_merge AS first
               FROM hq_change WHERE repo = 'appdev' ORDER BY number`,
            ),
            [
              // Closed before the records were taken; stays so.
              { number: 1, mate: "P_MATE", state: "closed", head: null, merged: null, first: null },
              // Open in the records, its squash on main: merged, recovered.
              {
                number: 2,
                mate: "P_MATE",
                state: "merged",
                head: appdev(["rev-parse", "refs/heads/mate/P_MATE/2"]),
                merged: squashed,
                // The recovered squash is the application's first code merge.
                first: true,
              },
              // Open in the records, but Bo opened a newer one since: closed, superseded.
              {
                number: 3,
                mate: "P_MATE2",
                state: "closed",
                head: null,
                merged: null,
                first: null,
              },
              // No record: Ada's newest, open.
              { number: 4, mate: "P_MATE", state: "open", head: third, merged: null, first: null },
              // No record: Bo's newest, open.
              { number: 5, mate: "P_MATE2", state: "open", head: bos, merged: null, first: null },
            ],
          );
          assert.deepStrictEqual(yield* now(`SELECT title FROM hq_change WHERE number = 4`), [
            { title: "Change 4 (restored)" },
          ]);
          assert.deepStrictEqual(
            yield* now(
              `SELECT tag, sha, entries, released_by AS by, state FROM hq_release ORDER BY tag`,
            ),
            [
              {
                tag: "v0.1.0",
                sha: groupMain,
                entries: [{ service: "app", sha: squashed }],
                by: "restore",
                state: "approved",
              },
            ],
          );
          assert.deepStrictEqual(
            yield* now(`SELECT created_by FROM hq_repo WHERE name = 'extra'`),
            [{ created_by: "restore" }],
          );
          assert.isAbove(
            (yield* now(`SELECT 1 FROM hq_git_event WHERE (data->>'reconciled')::boolean`)).length,
            0,
          );
          const nextOwner = yield* sessionFor(next.call, "door-owner-2");
          assert.strictEqual(
            (yield* next.call("GET", `/api/apps/${appId}/changes`, { session: nextOwner })).status,
            200,
          );

          // The records name a commit git lacks: the next Core takes the lock and serves nothing.
          yield* next.stop;
          yield* rowsWhere(
            first.url,
            `UPDATE hq_change SET merged_sha = '${"e".repeat(40)}' WHERE number = 2 RETURNING 1`,
            () => true,
          );
          const refused = yield* startCore(true, { url: first.url, gitRoot: first.gitRoot });
          const health = yield* untilHealth(refused.call, "failed");
          assert.strictEqual(
            (health.body as { readonly reason?: string }).reason,
            "restore_mismatch",
          );
          assert.strictEqual(
            (yield* refused.call("GET", `/api/apps/${appId}/changes`, { session: nextOwner }))
              .status,
            503,
          );
        }),
    );

    // Main's order decides which merge was the application's first, whether the record of a squash
    // is open and lagging or missing altogether.
    it.effect("recovers unrecorded squashes in the order main merged them", () =>
      Effect.gen(function* () {
        const first = yield* startCore(true);
        yield* untilHealth(first.call, "active");
        const owner = yield* sessionFor(first.call, "door-owner");
        const ada = yield* mateInApp(first.call, first.fake, owner, "P_MATE", "Shop");
        const { appId } = ada;
        yield* first.call("POST", "/api/mate/repos", {
          headers: ada.auth,
          body: { name: "appdev" },
        });
        // In the records: Ada's change 1, open. Bo's change 2 is in git only.
        yield* first.call("POST", "/api/mate/changes", {
          headers: ada.auth,
          body: { repo: "appdev", title: "Ada's first" },
        });
        yield* anotherMate(first.call, first.fake, owner, appId, "P_MATE2");
        yield* first.stop;

        const appdev = bareAt(NodePath.join(first.gitRoot, appId, "appdev.git"));
        const main = appdev(["rev-parse", "refs/heads/main"]);
        // Bo's squash is older on main than Ada's.
        const boSquash = commitOn(appdev, main, "bo.txt", "Bo's (#2)\n\nMate-Change: P_MATE2/2");
        const adaSquash = commitOn(
          appdev,
          boSquash,
          "ada.txt",
          "Ada's (#1)\n\nMate-Change: P_MATE/1",
        );
        appdev(["update-ref", "refs/heads/main", adaSquash, main]);
        appdev(["update-ref", "refs/heads/mate/P_MATE2/2", commitOn(appdev, main, "bo.txt", "Bo")]);
        appdev([
          "update-ref",
          "refs/heads/mate/P_MATE/1",
          commitOn(appdev, main, "ada.txt", "Ada"),
        ]);

        const next = yield* startCore(true, { url: first.url, gitRoot: first.gitRoot });
        yield* Stream.runHead(Stream.filter(next.gitHost.recorded, (tick) => tick > 0));
        assert.deepStrictEqual(
          yield* rowsWhere(
            next.url,
            `SELECT number, state, first_code_merge AS first FROM hq_change
             WHERE repo = 'appdev' ORDER BY number`,
            () => true,
          ),
          [
            { number: 1, state: "merged", first: false },
            { number: 2, state: "merged", first: true },
          ],
        );
      }),
    );

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

// H1: a repository is made in git before it is recorded, so a creation cut short leaves git ahead
// of the records — which a takeover records — never records naming what git lacks, which would hold
// all of HQ. A record such an older build left, naming nothing in its repository, is finished.
describe("an interrupted repository creation", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("records no repository git could not make, and the next takeover leads", () =>
      Effect.gen(function* () {
        const first = yield* startCore(true);
        yield* untilHealth(first.call, "active");
        const owner = yield* sessionFor(first.call, "door-owner");
        const ada = yield* mateInApp(first.call, first.fake, owner, "P_MATE", "Shop");
        // A file holds web's place in git: no repository can be made there.
        const place = NodePath.join(first.gitRoot, ada.appId, "web.git");
        NodeFS.mkdirSync(NodePath.dirname(place), { recursive: true });
        NodeFS.writeFileSync(place, "");
        const made = yield* first.call("POST", "/api/mate/repos", {
          headers: ada.auth,
          body: { name: "web" },
        });
        assert.strictEqual(made.status, 503);
        assert.deepStrictEqual(
          yield* rowsWhere(first.url, "SELECT name FROM hq_repo WHERE name = 'web'", () => true),
          [],
        );
        yield* first.stop;
        NodeFS.rmSync(place);
        const next = yield* startCore(true, { url: first.url, gitRoot: first.gitRoot });
        yield* untilHealth(next.call, "active");
      }),
    );

    it.effect("makes a recorded repository git lacks, naming nothing in it, rather than hold", () =>
      Effect.gen(function* () {
        const first = yield* startCore(true);
        yield* untilHealth(first.call, "active");
        const owner = yield* sessionFor(first.call, "door-owner");
        const ada = yield* mateInApp(first.call, first.fake, owner, "P_MATE", "Shop");
        yield* first.stop;
        // What an older build left of a creation cut short: the record, and no repository.
        yield* rowsWhere(
          first.url,
          `INSERT INTO hq_repo (app_id, name, created_by)
           VALUES ('${ada.appId}'::uuid, 'web', 'P_MATE') RETURNING name`,
          () => true,
        );
        const next = yield* startCore(true, { url: first.url, gitRoot: first.gitRoot });
        yield* untilHealth(next.call, "active");
        const [row] = yield* rowsWhere(
          next.url,
          "SELECT main_head FROM hq_repo WHERE name = 'web'",
          (rows) => rows[0]?.["main_head"] !== null,
        );
        assert.strictEqual(
          bareAt(NodePath.join(first.gitRoot, ada.appId, "web.git"))([
            "rev-parse",
            "refs/heads/main",
          ]),
          row?.["main_head"],
        );
      }),
    );
  });
});
