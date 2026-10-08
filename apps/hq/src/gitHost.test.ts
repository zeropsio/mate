// @effect-diagnostics nodeBuiltinImport:off -- the test writes a Mate's branch with the host's git.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { JUDGED_PER_MAIN_MOVE } from "@t3tools/shared/hqChanges";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { rolloutsLayer } from "./rollouts.ts";

const AUTHOR = { name: "HQ", email: "hq@hq.invalid" };

/** `git <args>` on a bare repository, as a Mate's push would leave it; its output. */
const bare = (dir: string, args: ReadonlyArray<string>, input = "") =>
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

/**
 * A leading git host over a fresh database and git root, with the application `Shop`, its
 * repository `appdev` whose main holds `a.txt`, and open changes for `mates` (numbers from 1), each
 * Mate's branch on main writing one file. Each write of HQ's git is waited on until the host has
 * recorded it — its events come in turn, each ending in a tick of `recorded` — never on a clock.
 */
const hostWithChanges = (
  mates: ReadonlyArray<{ readonly file: string; readonly content: string }>,
) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-git-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const context = yield* Layer.build(
      gitHostLayer({ rootDir: root }).pipe(
        Layer.provideMerge(rolloutsLayer),
        Layer.provideMerge(activeCoreLayer(url)),
      ),
    );
    const sql = Context.get(context, SqlClient.SqlClient);
    yield* untilActive.pipe(Effect.provide(context));
    const host = Context.get(context, GitHost);
    const git = yield* host.git.pipe(
      Effect.retry(Schedule.spaced(Duration.millis(50))),
      Effect.timeout(Duration.seconds(10)),
    );
    /** `write`, once the host has recorded it: main's move judged its open changes again. */
    const recorded = <A, E>(write: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const before = Option.getOrElse(yield* Stream.runHead(host.recorded), () => 0);
        const written = yield* write;
        yield* Stream.runHead(Stream.filter(host.recorded, (tick) => tick > before));
        return written;
      });
    const [app] = yield* sql<{ readonly id: string }>`
      INSERT INTO hq_app (name, created_by) VALUES ('Shop', 'owner') RETURNING id::text AS id`;
    const repo = { appId: app!.id, id: "appdev" };
    yield* sql`
      INSERT INTO hq_repo (app_id, name, created_by) VALUES (${repo.appId}::uuid, 'appdev', 'M1')`;
    yield* git.create(repo);
    const base = yield* recorded(
      git.commitFiles(repo, "refs/heads/main", {
        files: { "a.txt": "1\n" },
        expectedHead: null,
        message: "Initial commit",
        author: AUTHOR,
      }),
    );
    const main = "sha" in base ? base.sha : "";
    const dir = NodePath.join(root, repo.appId, "appdev.git");
    for (const [i, { file, content }] of mates.entries()) {
      const number = i + 1;
      const mate = `M${String(number)}`;
      yield* sql`
        INSERT INTO hq_change (app_id, repo, number, mate_project_id, title)
        VALUES (${repo.appId}::uuid, 'appdev', ${number}, ${mate}, 'Mate: appdev')`;
      const blob = bare(dir, ["hash-object", "-w", "--stdin"], content);
      const kept = bare(dir, ["ls-tree", main])
        .split("\n")
        .filter((line) => !line.endsWith(`\t${file}`));
      const tree = bare(dir, ["mktree"], [...kept, `100644 blob ${blob}\t${file}`, ""].join("\n"));
      const commit = bare(dir, ["commit-tree", tree, "-p", main, "-m", `${mate} works`]);
      bare(dir, ["update-ref", `refs/heads/mate/${mate}/${String(number)}`, commit]);
    }
    /** main moves: `a.txt` changes. */
    const moveMain = recorded(
      git.commitFiles(repo, "refs/heads/main", {
        files: { "a.txt": "3\n" },
        expectedHead: main,
        message: "Move main",
        author: AUTHOR,
      }),
    );
    /** The changes as their records keep them. */
    const judged = sql<{
      readonly number: number;
      readonly mergeability: string;
      readonly behind: boolean;
    }>`SELECT number, mergeability, behind FROM hq_change ORDER BY number`;
    /** When HQ recorded `appdev`'s main last moving. */
    const updatedAt = Effect.map(
      sql<{ readonly at: string }>`
        SELECT to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at
        FROM hq_repo WHERE name = 'appdev'`,
      (rows) => rows[0]!.at,
    );
    return { moveMain, judged, updatedAt };
  });

describe("gitHost", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("opens git again with backoff while it leads, once opening can succeed", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const dir = yield* Effect.acquireRelease(
          Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-git-"))),
          (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
        );
        // The volume is a file, not a directory: no repository root can be made under it.
        const volume = NodePath.join(dir, "vol");
        NodeFS.writeFileSync(volume, "");
        const context = yield* Layer.build(
          gitHostLayer({
            rootDir: NodePath.join(volume, "git"),
            openBackoff: Duration.millis(20),
          }).pipe(Layer.provideMerge(rolloutsLayer), Layer.provideMerge(activeCoreLayer(url))),
        );
        yield* untilActive.pipe(Effect.provide(context));
        const host = Context.get(context, GitHost);
        yield* Effect.sleep(Duration.millis(300));
        assert.isTrue(Exit.isFailure(yield* Effect.exit(host.git)), "git opened on a file");
        NodeFS.rmSync(volume);
        yield* host.git.pipe(
          Effect.retry(Schedule.spaced(Duration.millis(50))),
          Effect.timeout(Duration.seconds(10)),
        );
      }),
    );

    // H2: the takeover is the barrier before git serves. One that fails opens nothing, and is tried
    // again while this Core leads.
    it.effect("opens no git while its takeover fails, and opens once it succeeds", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const root = yield* Effect.acquireRelease(
          Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-git-"))),
          (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
        );
        const lead = Effect.gen(function* () {
          const context = yield* Layer.build(
            gitHostLayer({ rootDir: root, openBackoff: Duration.millis(20) }).pipe(
              Layer.provideMerge(rolloutsLayer),
              Layer.provideMerge(activeCoreLayer(url)),
            ),
          );
          yield* untilActive.pipe(Effect.provide(context));
          return {
            host: Context.get(context, GitHost),
            sql: Context.get(context, SqlClient.SqlClient),
          };
        });
        // The schema, from a first lead; then the takeover's records cannot be read.
        yield* Effect.scoped(
          Effect.flatMap(lead, ({ sql }) => sql`ALTER TABLE hq_release RENAME TO hq_release_aside`),
        );
        const next = yield* lead;
        yield* Effect.sleep(Duration.millis(300));
        assert.isTrue(
          Exit.isFailure(yield* Effect.exit(next.host.git)),
          "git opened past a failed takeover",
        );
        assert.strictEqual((yield* next.host.status).git, "opening");
        yield* next.sql`ALTER TABLE hq_release_aside RENAME TO hq_release`;
        yield* next.host.git.pipe(
          Effect.retry(Schedule.spaced(Duration.millis(50))),
          Effect.timeout(Duration.seconds(10)),
        );
        assert.strictEqual((yield* next.host.status).git, "open");
      }),
    );

    // H2: one repository that does not converge is quarantined — refused, reads and writes, why
    // named — while the others serve; it is tried again, and served once it converges.
    it.effect("quarantines a repository that does not converge, and serves it once it does", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        const root = yield* Effect.acquireRelease(
          Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-git-"))),
          (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
        );
        const lead = Effect.gen(function* () {
          const context = yield* Layer.build(
            gitHostLayer({ rootDir: root, quarantineRetry: Duration.millis(50) }).pipe(
              Layer.provideMerge(rolloutsLayer),
              Layer.provideMerge(activeCoreLayer(url)),
            ),
          );
          yield* untilActive.pipe(Effect.provide(context));
          const host = Context.get(context, GitHost);
          const git = yield* host.git.pipe(
            Effect.retry(Schedule.spaced(Duration.millis(50))),
            Effect.timeout(Duration.seconds(10)),
          );
          return { host, git, sql: Context.get(context, SqlClient.SqlClient) };
        });
        const appId = yield* Effect.scoped(
          Effect.gen(function* () {
            const { host, git, sql } = yield* lead;
            const [app] = yield* sql<{ readonly id: string }>`
              INSERT INTO hq_app (name, created_by) VALUES ('Shop', 'owner') RETURNING id::text AS id`;
            for (const name of ["appdev", "web"]) {
              const repo = { appId: app!.id, id: name };
              yield* sql`
                INSERT INTO hq_repo (app_id, name, created_by)
                VALUES (${repo.appId}::uuid, ${name}, 'M1')`;
              yield* git.create(repo);
              const before = Option.getOrElse(yield* Stream.runHead(host.recorded), () => 0);
              yield* git.commitFiles(repo, "refs/heads/main", {
                files: { "a.txt": "1\n" },
                expectedHead: null,
                message: "Initial commit",
                author: AUTHOR,
              });
              yield* Stream.runHead(Stream.filter(host.recorded, (tick) => tick > before));
            }
            return app!.id;
          }),
        );
        // web's config is no file git can read: it cannot converge.
        const config = NodePath.join(root, appId, "web.git", "config");
        const good = NodeFS.readFileSync(config);
        NodeFS.rmSync(config);
        NodeFS.mkdirSync(config);
        const { host, git } = yield* lead;
        const web = { appId, id: "web" };
        const status = yield* host.status;
        assert.strictEqual(status.git, "open");
        assert.deepStrictEqual(
          status.quarantined.map((entry) => entry.repo),
          [`${appId}/web`],
        );
        assert.match(status.quarantined[0]!.reason, /^converge_/u);
        yield* git.branches({ appId, id: "appdev" });
        const refused = yield* Effect.flip(git.branches(web));
        assert.deepStrictEqual(
          [refused.reason, refused.message],
          ["unavailable", status.quarantined[0]!.reason],
        );
        NodeFS.rmdirSync(config);
        NodeFS.writeFileSync(config, good);
        // Git opens again around it: each try asks for the layer anew, as every caller does.
        yield* Effect.flatMap(host.git, (layer) => layer.branches(web)).pipe(
          Effect.retry(Schedule.spaced(Duration.millis(50))),
          Effect.timeout(Duration.seconds(10)),
        );
        assert.deepStrictEqual((yield* host.status).quarantined, []);
      }),
    );

    it.effect("records when a repository's main last moved", () =>
      Effect.gen(function* () {
        const { moveMain, updatedAt } = yield* hostWithChanges([]);
        const before = yield* updatedAt;
        yield* moveMain;
        assert.isAbove(Date.parse(yield* updatedAt), Date.parse(before));
      }),
    );

    it.effect("judges a repository's open changes again when its main moves", () =>
      Effect.gen(function* () {
        // M1 changes a.txt, as main is about to; M2 adds b.txt.
        const { moveMain, judged } = yield* hostWithChanges([
          { file: "a.txt", content: "2\n" },
          { file: "b.txt", content: "b\n" },
        ]);
        yield* moveMain;
        assert.deepStrictEqual(
          (yield* judged).map((row) => [row.number, row.mergeability, row.behind]),
          [
            [1, "conflict", true],
            [2, "clean", true],
          ],
        );
      }),
    );

    it.effect(
      `judges only the newest ${String(JUDGED_PER_MAIN_MOVE)} open changes; the rest wait as unknown`,
      () =>
        Effect.gen(function* () {
          const count = JUDGED_PER_MAIN_MOVE + 1;
          const { moveMain, judged } = yield* hostWithChanges(
            Array.from({ length: count }, (_, i) => ({
              file: `f${String(i)}.txt`,
              content: "x\n",
            })),
          );
          yield* moveMain;
          const rows = yield* judged;
          assert.deepStrictEqual(rows[0], { number: 1, mergeability: "unknown", behind: false });
          assert.isTrue(rows.slice(1).every((row) => row.mergeability === "clean" && row.behind));
        }),
    );
  });
});
