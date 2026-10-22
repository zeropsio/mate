// @effect-diagnostics nodeBuiltinImport:off -- real temporary bare repositories and Postgres.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { rolloutsLayer } from "./rollouts.ts";
import { Remotes, RemoteRefused, type RemoteRecord } from "./repoRemotes.ts";
import { Roles, type OrgView } from "./roles.ts";
import { acceptAdoption, previewAdoption } from "./gitAdoption.ts";

const author = { name: "HQ", email: "hq@hq.invalid" };
const bare = (dir: string, args: string[], input = "") =>
  NodeChildProcess.execFileSync("git", ["-C", dir, ...args], {
    input,
    encoding: "utf8",
    env: {
      PATH: "/usr/bin:/bin",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_AUTHOR_NAME: author.name,
      GIT_AUTHOR_EMAIL: author.email,
      GIT_COMMITTER_NAME: author.name,
      GIT_COMMITTER_EMAIL: author.email,
    },
  }).trim();
const fixture = (seed = false) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-adoption-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const context = yield* Layer.build(
      gitHostLayer({ rootDir: NodePath.join(root, "hq") }).pipe(
        Layer.provideMerge(rolloutsLayer),
        Layer.provideMerge(activeCoreLayer(url)),
      ),
    );
    yield* untilActive.pipe(Effect.provide(context));
    const sql = Context.get(context, SqlClient.SqlClient);
    const host = Context.get(context, GitHost);
    const git = yield* host.opened(Duration.seconds(10));
    const [app] = yield* sql<{
      readonly id: string;
    }>`INSERT INTO hq_app(name,created_by) VALUES ('Shop','developer') RETURNING id::text AS id`;
    const repo = { appId: app!.id, id: "web" };
    yield* sql`INSERT INTO hq_repo(app_id,name,created_by) VALUES (${repo.appId}::uuid,'web','developer')`;
    yield* sql`INSERT INTO hq_app_project(project_id,app_id,kind,created_by) VALUES ('mate-project',${repo.appId}::uuid,'mate','developer')`;
    yield* git.create(repo);
    const recorded = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const before = Option.getOrElse(yield* Stream.runHead(host.recorded), () => 0);
        const result = yield* effect;
        yield* Stream.runHead(Stream.filter(host.recorded, (tick) => tick > before)).pipe(
          Effect.timeout(Duration.seconds(10)),
        );
        return result;
      });
    const initial = yield* recorded(
      git.commitFiles(repo, "refs/heads/main", {
        files: seed ? {} : { hq: "hq", same: "same" },
        message: "Initial",
        expectedHead: null,
        author,
      }),
    );
    if (!("sha" in initial)) throw new Error("initial commit refused");
    const main = initial.sha;
    const dir = NodePath.join(root, "hq", repo.appId, "web.git");
    const remoteDir = NodePath.join(root, "remote.git");
    bare(root, ["init", "--bare", remoteDir]);
    const blob = bare(remoteDir, ["hash-object", "-w", "--stdin"], "remote");
    const same = bare(remoteDir, ["hash-object", "-w", "--stdin"], "same");
    const tree = bare(
      remoteDir,
      ["mktree"],
      `100644 blob ${blob}\tremote\n100644 blob ${same}\tsame\n`,
    );
    const tip = bare(remoteDir, ["commit-tree", tree, "-m", "Remote"]);
    bare(remoteDir, ["update-ref", "refs/heads/main", tip]);
    const state = {
      role: "BASIC_USER",
      calls: 0,
      refused: false,
      remote: {
        appId: repo.appId,
        repo: repo.id,
        url: remoteDir,
        urlKey: remoteDir,
        host: "fixture",
        hostRepoId: null,
        keptBy: "developer",
        keptAt: "2026-10-13 12:00:00+00",
        invalidSince: null,
        expiresAt: null,
        expiryLabel: "Expiry not reported",
        credentialState: "kept",
      } satisfies RemoteRecord,
    };
    const view = Effect.sync(
      () =>
        ({
          orgId: "org",
          freshness: "fresh",
          members: [
            {
              userId: "developer",
              clientUserId: "developer",
              name: "Developer",
              kind: "person",
              roleCode: state.role,
              status: "ACTIVE",
              canCreateProjects: false,
            },
          ],
          projects: [
            {
              id: "mate-project",
              orgId: "org",
              name: "Mate",
              status: "ACTIVE",
              tags: [],
              publicZone: "fixture.invalid",
              userRoles: [],
            },
          ],
        }) satisfies OrgView<"fresh">,
    );
    const roles = Roles.of({
      forWrite: view,
      view: Effect.map(view, (v) => ({ ...v, freshness: "cached" as const })),
      recent: Effect.map(view, (v) => ({ ...v, freshness: "cached" as const })),
      readSince: () => Effect.die("HQ's door is outside this fixture"),
      exists: () => Effect.succeed(true),
      answeredAt: Effect.succeed(0),
      views: Stream.empty,
    });
    const remotes = Remotes.of({
      changes: Stream.empty,
      listRepos: () => Effect.die("Repository reads are outside this fixture"),
      mateRepos: () => Effect.die("Repository reads are outside this fixture"),
      follow: () => Effect.die("Followed repositories are outside this fixture"),
      mateCredential: () => Effect.die("Repository reads are outside this fixture"),
      write: () => Effect.die("Remote writes are outside this fixture"),
      tokenOf: () => Effect.die("Remote tokens are outside this fixture"),
      connectViaApp: () => Effect.die("Remotes through the GitHub app are outside this fixture"),
      receipt: () => Effect.succeed(null),
      get: () => Effect.succeed(state.remote),
      connect: () => Effect.succeed(state.remote),
      updateAddress: () => Effect.succeed(state.remote),
      disconnect: () => Effect.void,
      invalidate: () => Effect.void,
      ciAccess: () => Effect.succeed({}),
      forUse: () =>
        Effect.suspend(() => {
          state.calls++;
          return state.refused
            ? Effect.fail(new RemoteRefused({ reason: "credential_invalid" }))
            : Effect.succeed({ remote: state.remote, token: Redacted.make("fixture-secret") });
        }),
    });
    const provided = Context.add(Context.add(context, Roles, roles), Remotes, remotes);
    return { repo, git, sql, dir, remoteDir, main, tip, tree, state, recorded, provided };
  });

describe("first-attachment adoption", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "Adding a git environment says how many files its first push changes on the remote before HQ's main moves.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* fixture();
            const preview = yield* previewAdoption("developer", f.repo, "main").pipe(
              Effect.provide(f.provided),
            );
            // Independent input trees: one removal and one addition, with the shared file unchanged.
            assert.strictEqual(bare(f.dir, ["ls-tree", "-r", "--name-only", f.main]), "hq\nsame");
            assert.strictEqual(
              bare(f.remoteDir, ["ls-tree", "-r", "--name-only", f.tip]),
              "remote\nsame",
            );
            assert.strictEqual(preview.changedFiles, 2);
            assert.strictEqual(preview.seed, false);
            assert.strictEqual(bare(f.dir, ["rev-parse", "main"]), f.main);
            const accepted = yield* f.recorded(
              acceptAdoption("developer", preview).pipe(Effect.provide(f.provided)),
            );
            assert.strictEqual(accepted.kind, "adopted");
            assert.strictEqual(
              bare(f.dir, ["show", "-s", "--format=%P", "main"]),
              `${f.main} ${f.tip}`,
            );
            assert.strictEqual(bare(f.dir, ["ls-tree", "-r", "--name-only", "main"]), "hq\nsame");
            const current = bare(f.dir, ["rev-parse", "main"]);
            const events = yield* f.sql<{
              readonly count: number;
            }>`SELECT count(*)::int AS count FROM hq_git_event WHERE kind='main_moved' AND data->>'new'=${current}`;
            const rollouts = yield* f.sql<{
              readonly count: number;
            }>`SELECT count(*)::int AS count FROM hq_rollout WHERE cause='merge' AND sha=${current}`;
            assert.strictEqual(events[0]!.count, 1);
            assert.strictEqual(rollouts[0]!.count, 1);
            const attached =
              yield* f.sql`SELECT 1 FROM hq_environment WHERE app_id::text=${f.repo.appId} AND target='git'`;
            assert.strictEqual(attached.length, 0);
          }),
        ),
    );
    it.effect("Adopting a remote keeps every Mate branch related to main.", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture(true);
          const branches = ["alice", "bob"];
          for (const mate of branches)
            bare(f.dir, ["update-ref", `refs/heads/mate/${mate}/1`, f.main]);
          const preview = yield* previewAdoption("developer", f.repo, "main").pipe(
            Effect.provide(f.provided),
          );
          assert.strictEqual(preview.changedFiles, 0);
          assert.strictEqual(preview.seed, true);
          yield* f.recorded(acceptAdoption("developer", preview).pipe(Effect.provide(f.provided)));
          assert.strictEqual(bare(f.dir, ["rev-parse", "main^{tree}"]), f.tree);
          for (const mate of branches)
            assert.strictEqual(bare(f.dir, ["merge-base", `mate/${mate}/1`, "main"]), f.main);
        }),
      ),
    );
    it.effect.each(["remote", "main", "credential"] as const)(
      "Decision L3a: acceptance rereads %s and refuses stale review without an automatic adoption.",
      (moved) =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* fixture();
            const preview = yield* previewAdoption("developer", f.repo, "main").pipe(
              Effect.provide(f.provided),
            );
            if (moved === "remote")
              bare(f.remoteDir, [
                "update-ref",
                "refs/heads/main",
                bare(f.remoteDir, ["commit-tree", f.tree, "-p", f.tip, "-m", "Moved"]),
              ]);
            if (moved === "main")
              yield* f.recorded(
                f.git.commitFiles(f.repo, "refs/heads/main", {
                  files: { next: "next" },
                  message: "Moved",
                  expectedHead: f.main,
                  author,
                }),
              );
            if (moved === "credential")
              f.state.remote = { ...f.state.remote, keptAt: "2026-10-13 12:01:00+00" };
            const expected = bare(f.dir, ["rev-parse", "main"]);
            const before = yield* f.sql`SELECT 1 FROM hq_rollout`;
            assert.deepStrictEqual(
              yield* acceptAdoption("developer", preview).pipe(Effect.provide(f.provided)),
              { kind: "stale" },
            );
            assert.strictEqual(bare(f.dir, ["rev-parse", "main"]), expected);
            assert.strictEqual((yield* f.sql`SELECT 1 FROM hq_rollout`).length, before.length);
          }),
        ),
    );
    it.effect(
      "Decision: adoption is only before attachment and never a recovery for a diverged environment.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* fixture();
            const preview = yield* previewAdoption("developer", f.repo, "main").pipe(
              Effect.provide(f.provided),
            );
            yield* f.sql`INSERT INTO hq_environment(id,app_id,tier,name,target,sources,branch,delivery,created_by) VALUES ('git',${f.repo.appId}::uuid,'stage','git','git',ARRAY['main'],'main','direct','developer')`;
            for (const operation of [
              previewAdoption("developer", f.repo, "main").pipe(Effect.asVoid),
              acceptAdoption("developer", preview).pipe(Effect.asVoid),
            ]) {
              const failure = yield* operation.pipe(Effect.provide(f.provided), Effect.flip);
              assert.strictEqual(failure._tag, "AdoptionRefused");
              if (failure._tag === "AdoptionRefused")
                assert.strictEqual(failure.reason, "already_attached");
            }
            assert.strictEqual(bare(f.dir, ["rev-parse", "main"]), f.main);
            assert.strictEqual(f.state.calls, 1);
          }),
        ),
    );
    it.effect("A refused remote token stops adoption without moving main.", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* fixture();
          const preview = yield* previewAdoption("developer", f.repo, "main").pipe(
            Effect.provide(f.provided),
          );
          f.state.refused = true;
          const error = yield* acceptAdoption("developer", preview).pipe(
            Effect.provide(f.provided),
            Effect.flip,
          );
          assert.strictEqual(error._tag, "RemoteRefused");
          if (error._tag === "RemoteRefused")
            assert.strictEqual(error.reason, "credential_invalid");
          assert.strictEqual(bare(f.dir, ["rev-parse", "main"]), f.main);
        }),
      ),
    );
    it.effect(
      "Decision: application write authority gates adoption, including acceptance after authority changes.",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* fixture();
            const preview = yield* previewAdoption("developer", f.repo, "main").pipe(
              Effect.provide(f.provided),
            );
            f.state.role = "READ_ONLY";
            for (const operation of [
              previewAdoption("developer", f.repo, "main").pipe(Effect.asVoid),
              acceptAdoption("developer", preview).pipe(Effect.asVoid),
            ]) {
              const failure = yield* operation.pipe(Effect.provide(f.provided), Effect.flip);
              assert.strictEqual(failure._tag, "AdoptionRefused");
              if (failure._tag === "AdoptionRefused")
                assert.strictEqual(failure.reason, "not_app_developer");
            }
            assert.strictEqual(bare(f.dir, ["rev-parse", "main"]), f.main);
            assert.strictEqual(f.state.calls, 1);
          }),
        ),
    );
  });
});
