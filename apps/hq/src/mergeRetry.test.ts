// @effect-diagnostics nodeBuiltinImport:off -- the test writes a Mate's branch with the host's git.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { Changes, changesLayer } from "./changes.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { Roles } from "./roles.ts";
import { rolloutsLayer } from "./rollouts.ts";
import type { ZeropsMember, ZeropsProject } from "./zerops/api.ts";

const owner: ZeropsMember = {
  name: "owner",
  kind: "person",
  roleCode: "OWNER",
  status: "ACTIVE",
  userId: "owner",
  clientUserId: "C-owner",
  canCreateProjects: true,
};
const mate: ZeropsProject = {
  id: "P",
  orgId: "ORG",
  name: "P",
  status: "ACTIVE",
  tags: [],
  userRoles: [],
  publicZone: "P.prg1-zerops.zone",
};
const org = { orgId: "ORG", members: [owner], projects: [mate] };

/**
 * Changes over a leading Core's database and git, its git layer seamed: before each squash,
 * `main` is moved `moves` times by another write of Core's own, between HQ's read of it and the
 * squash that names it.
 */
const withMovingMain = (moves: number) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-git-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const roles = Layer.succeed(Roles, {
      view: Effect.succeed({ ...org, freshness: "cached" as const }),
      forWrite: Effect.succeed({ ...org, freshness: "recent" as const }),
      recent: Effect.succeed({ ...org, freshness: "cached" as const }),
      exists: () => Effect.succeed(true),
      answeredAt: Effect.succeed(undefined),
      views: Stream.never,
    });
    const left = { moves };
    const squashes = { count: 0 };
    const seamed = Layer.effect(
      GitHost,
      Effect.map(GitHost, (host) =>
        GitHost.of({
          ...host,
          git: Effect.map(host.git, (git) => ({
            ...git,
            squashMerge: (repo, options) =>
              Effect.gen(function* () {
                squashes.count += 1;
                if (left.moves > 0) {
                  left.moves -= 1;
                  const main = (yield* git.branches(repo)).items.find(
                    (branch) => branch.ref === "refs/heads/main",
                  )!.sha;
                  yield* git.commitFiles(repo, "refs/heads/main", {
                    files: { [`moved-${String(left.moves)}.txt`]: "moved\n" },
                    expectedHead: main,
                    message: "Main moves",
                    author: { name: "HQ", email: "hq@hq.invalid" },
                  });
                }
                return yield* git.squashMerge(repo, options);
              }),
          })),
        }),
      ),
    ).pipe(Layer.provideMerge(gitHostLayer({ rootDir: root })));
    const context = yield* Layer.build(
      changesLayer.pipe(
        Layer.provideMerge(seamed),
        Layer.provideMerge(roles),
        Layer.provideMerge(rolloutsLayer),
        Layer.provideMerge(activeCoreLayer(url)),
      ),
    );
    yield* untilActive.pipe(Effect.provide(context));
    const sql = Context.get(context, SqlClient.SqlClient);
    const changes = Context.get(context, Changes);

    // Mate P in the application Shop, its repository and its change 1, one commit on main.
    const [app] = yield* sql<{ readonly id: string }>`
      INSERT INTO hq_app (name, created_by) VALUES ('Shop', 'owner') RETURNING id::text AS id`;
    const appId = app!.id;
    yield* sql`
      INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
      VALUES ('P', ${appId}::uuid, 'mate', 'owner')`;
    yield* sql`INSERT INTO hq_mate (project_id, face) VALUES ('P', 'face-1')`;
    yield* Effect.retry(changes.ensureRepo("P", "appdev"), { times: 50 });
    yield* changes.openChange("P", "appdev", "Add a page");
    const dir = NodePath.join(root, appId, "appdev.git");
    const bare = (args: ReadonlyArray<string>, input = "") =>
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
    const base = bare(["rev-parse", "refs/heads/main"]);
    // The change adds page.txt to main's empty tree.
    const blob = bare(["hash-object", "-w", "--stdin"], "page\n");
    const tree = bare(["mktree"], `100644 blob ${blob}\tpage.txt\n`);
    const head = bare(["commit-tree", tree, "-p", base, "-m", "Ada's page"]);
    bare(["update-ref", "refs/heads/mate/P/1", head]);
    return {
      merge: Effect.flip(changes.mergeChange("owner", appId, "appdev", 1, head)).pipe(
        Effect.map((refused) => ("reason" in refused ? String(refused.reason) : refused._tag)),
        Effect.orElseSucceed(() => "ok"),
      ),
      squashes,
      main: () => bare(["rev-parse", "refs/heads/main"]),
      log: (rev: string) => bare(["log", "--format=%s", rev]),
    };
  });

describe("a merge while main moves", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("squashes again onto the main that moved, and lands", () =>
      Effect.gen(function* () {
        const core = yield* withMovingMain(2);
        assert.strictEqual(yield* core.merge, "ok");
        assert.strictEqual(core.squashes.count, 3);
        assert.deepStrictEqual(core.log(core.main()).split("\n"), [
          "Add a page (#1)",
          "Main moves",
          "Main moves",
          "Initial commit",
        ]);
      }),
    );

    it.effect("gives up after three squashes, each beaten by main, and merges nothing", () =>
      Effect.gen(function* () {
        const core = yield* withMovingMain(3);
        assert.strictEqual(yield* core.merge, "main_moved");
        assert.strictEqual(core.squashes.count, 3);
        assert.deepStrictEqual(core.log(core.main()).split("\n"), [
          "Main moves",
          "Main moves",
          "Main moves",
          "Initial commit",
        ]);
      }),
    );
  });
});
