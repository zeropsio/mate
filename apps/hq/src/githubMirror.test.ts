// @effect-diagnostics nodeBuiltinImport:off -- real bare repositories stand in for GitHub; a Mate pushes over smart HTTP.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeHttp from "node:http";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import * as NodeHttpServer from "@effect/platform-node/NodeHttpServer";
import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as HttpServerRequest from "effect/http/HttpServerRequest";
import * as HttpServerResponse from "effect/http/HttpServerResponse";
import * as SqlClient from "effect/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { Changes, changesLayer } from "./changes.ts";
import { GithubAuth, GithubAuthUnavailable } from "./githubAuth.ts";
import { GithubEvents, githubEventsLayer } from "./githubEvents.ts";
import { GithubMirror, changeBranch, changesToPush, githubMirrorLayer } from "./githubMirror.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { MateTasks } from "./mateTasks.ts";
import { Roles, type OrgView } from "./roles.ts";
import { rolloutsLayer } from "./rollouts.ts";

const AUTHOR = { name: "HQ", email: "hq@hq.invalid" };
const REPOSITORY = "acme/tea-shop";
const TOKEN = ["app", "installation", "fixture"].join("-");

/** `git <args>` in `dir` with no ambient configuration; its output. */
const native = (dir: string, args: ReadonlyArray<string>, input = "") =>
  NodeChildProcess.execFileSync("git", ["-C", dir, ...args], {
    input,
    encoding: "utf8",
    env: {
      PATH: process.env["PATH"] ?? "/usr/bin:/bin",
      HOME: dir,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
      GIT_AUTHOR_NAME: "Nova",
      GIT_AUTHOR_EMAIL: "nova@mate.test",
      GIT_COMMITTER_NAME: "Nova",
      GIT_COMMITTER_EMAIL: "nova@mate.test",
    },
  }).trim();

/**
 * `native` without blocking: what talks to HQ's own smart HTTP in this process must leave its event
 * loop free to answer.
 */
const over = (dir: string, args: ReadonlyArray<string>) =>
  Effect.callback<string>((resume) => {
    NodeChildProcess.execFile(
      "git",
      ["-C", dir, ...args],
      {
        env: {
          PATH: process.env["PATH"] ?? "/usr/bin:/bin",
          HOME: dir,
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_TERMINAL_PROMPT: "0",
        },
      },
      (error, stdout, stderr) =>
        resume(
          error === null
            ? Effect.succeed(stdout.trim())
            : Effect.die(new Error(`git ${args.join(" ")}: ${stderr}`)),
        ),
    );
  });

/** A commit on `dir` writing `file`, after `parents`: a merge or a push made on GitHub. */
const commitIn = (dir: string, parents: ReadonlyArray<string>, file: string) => {
  const blob = native(dir, ["hash-object", "-w", "--stdin"], file);
  const tree = native(dir, ["mktree"], `100644 blob ${blob}\t${file}\n`);
  return native(dir, ["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", file]);
};

/** `commitIn` as someone on GitHub writes it: a person's name and GitHub's noreply address. */
const commitAs = (
  dir: string,
  parents: ReadonlyArray<string>,
  file: string,
  author: { readonly name: string; readonly email: string },
) => {
  const env = {
    PATH: process.env["PATH"] ?? "/usr/bin:/bin",
    HOME: dir,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: "GitHub",
    GIT_COMMITTER_EMAIL: "noreply@github.com",
  };
  const run = (args: ReadonlyArray<string>, input = "") =>
    NodeChildProcess.execFileSync("git", ["-C", dir, ...args], {
      input,
      encoding: "utf8",
      env,
    }).trim();
  const blob = run(["hash-object", "-w", "--stdin"], file);
  const tree = run(["mktree"], `100644 blob ${blob}\t${file}\n`);
  return run(["commit-tree", tree, ...parents.flatMap((p) => ["-p", p]), "-m", file]);
};

const refIn = (dir: string, ref: string) =>
  native(dir, ["for-each-ref", "--format=%(objectname)", ref]) || null;

/** Waits, boundedly, until `read` answers `wanted`: a follow HQ does in the background. */
const until = <A>(read: () => A, wanted: A) =>
  Effect.sync(read).pipe(
    Effect.filterOrFail((value) => value === wanted),
    Effect.retry(Schedule.spaced(Duration.millis(50))),
    Effect.timeout(Duration.seconds(10)),
  );

const view = Effect.sync(
  () =>
    ({
      orgId: "org",
      freshness: "fresh",
      members: [
        {
          userId: "owner",
          clientUserId: "C-owner",
          name: "owner",
          kind: "person",
          status: "ACTIVE",
          roleCode: "OWNER",
          canCreateProjects: true,
        },
      ],
      projects: [
        {
          id: "nova",
          orgId: "org",
          name: "Nova",
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

/**
 * A leading HQ whose repository `appdev` mirrors to `acme/tea-shop` through the app — an empty bare
 * repository standing in for GitHub — with a Mate, `nova`, pushing its change 1 over smart HTTP.
 * The app gives its token while `auth.installed`.
 */
const mirrored = (sweepEvery = Duration.hours(1)) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-mirror-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const github = NodePath.join(root, "github.git");
    native(root, ["init", "--bare", "-b", "main", github]);
    // GitHub's repository of that name, by its id: the one connected until it is deleted and made
    // again under the same name.
    const auth = { installed: true, asked: [] as Array<string>, id: "501" };
    const told: Array<{ readonly taskId: string; readonly message: unknown }> = [];
    const context = yield* Layer.build(
      githubMirrorLayer({ gitUrl: () => github, sweepEvery }).pipe(
        Layer.provideMerge(changesLayer),
        Layer.provideMerge(githubEventsLayer),
        Layer.provide(
          Layer.succeed(
            GithubAuth,
            GithubAuth.of({
              tokenFor: (repository, _use, id) =>
                Effect.suspend(() => {
                  auth.asked.push(repository);
                  if (id !== undefined && id !== auth.id)
                    return Effect.fail(new GithubAuthUnavailable({ reason: "replaced" }));
                  return Effect.succeed(
                    auth.installed && repository === REPOSITORY ? Redacted.make(TOKEN) : undefined,
                  );
                }),
              bot: Effect.succeed({ login: "acme-mate[bot]", userId: 1 }),
            }),
          ),
        ),
        Layer.provide(
          Layer.succeed(MateTasks, {
            message: (taskId: string, message: unknown) =>
              Effect.sync(() => {
                told.push({ taskId, message });
              }),
          } as unknown as MateTasks["Service"]),
        ),
        Layer.provideMerge(Layer.succeed(Roles, roles)),
        Layer.provideMerge(gitHostLayer({ rootDir: NodePath.join(root, "hq") })),
        Layer.provideMerge(rolloutsLayer),
        Layer.provideMerge(activeCoreLayer(url)),
      ),
    );
    yield* untilActive.pipe(Effect.provide(context));
    const sql = Context.get(context, SqlClient.SqlClient);
    const host = Context.get(context, GitHost);
    const mirror = Context.get(context, GithubMirror);
    const changes = Context.get(context, Changes);
    const events = Context.get(context, GithubEvents);
    const git = yield* host.opened(Duration.seconds(10));
    const recorded = <A, E>(write: Effect.Effect<A, E>) =>
      Effect.gen(function* () {
        const before = Option.getOrElse(yield* Stream.runHead(host.recorded), () => 0);
        const written = yield* write;
        yield* Stream.runHead(Stream.filter(host.recorded, (tick) => tick > before)).pipe(
          Effect.timeout(Duration.seconds(10)),
        );
        return written;
      });
    const [app] = yield* sql<{ readonly id: string }>`
      INSERT INTO hq_app (name, created_by) VALUES ('Tea Shop', 'owner') RETURNING id::text AS id`;
    const appId = app!.id;
    const repo = { appId, id: "appdev" };
    yield* sql`
      INSERT INTO hq_repo (app_id, name, created_by) VALUES (${appId}::uuid, 'appdev', 'owner')`;
    yield* git.create(repo);
    const hqDir = NodePath.join(root, "hq", appId, "appdev.git");
    // Main as the app finds it, written behind HQ's back so no follow of it races the test's own.
    const main = commitIn(hqDir, [], "index.html");
    native(hqDir, ["update-ref", "refs/heads/main", main]);
    // Connected only now: what came before is the repository as the app found it.
    yield* sql`
      INSERT INTO hq_repo_remote (app_id, repo, url, url_key, host, host_repo_id, via)
      VALUES (${appId}::uuid, 'appdev', ${`https://github.com/${REPOSITORY}.git`},
        ${`github.com/${REPOSITORY}`}, 'github.com', '501', 'app')`;

    // The Mate's side: git's smart HTTP as HQ serves it, to the Mate `nova` of this application.
    const scope = yield* Effect.scope;
    const handler = yield* NodeHttpServer.makeHandler(
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        yield* host.serve(
          request,
          () => Effect.succeed({ kind: "mate", mateId: "nova", appId } as const),
          () => Effect.succeed(true),
        );
        return HttpServerResponse.empty();
      }).pipe(Effect.orDie),
      { scope },
    );
    const server = NodeHttp.createServer(handler);
    yield* Effect.acquireRelease(
      Effect.callback<void>((resume) => {
        server.listen(0, "127.0.0.1", () => resume(Effect.void));
      }),
      () =>
        Effect.callback<void>((resume) => {
          server.close(() => resume(Effect.void));
        }),
    );
    const address = server.address();
    const port = typeof address === "object" && address !== null ? address.port : 0;
    const work = NodePath.join(root, "work");
    yield* over(root, ["clone", `http://127.0.0.1:${String(port)}/git/${appId}/appdev.git`, work]);
    /** Change `number` of the Mate `mate`, open, titled `title`. */
    const openChange = (title: string, number = 1, mate = "nova") =>
      sql`
        INSERT INTO hq_change (app_id, repo, number, mate_project_id, title)
        VALUES (${appId}::uuid, 'appdev', ${number}, ${mate}, ${title})`;
    /** The Mate commits `file` and pushes it to its change 1; the head, once HQ recorded it. */
    const push = (file: string) =>
      recorded(
        Effect.gen(function* () {
          NodeFS.writeFileSync(NodePath.join(work, file), `${file}\n`);
          native(work, ["add", file]);
          native(work, ["commit", "-m", `Add ${file}`]);
          yield* over(work, ["push", "origin", "HEAD:refs/heads/mate/nova/1"]);
          return native(work, ["rev-parse", "HEAD"]);
        }),
      );
    /** What the owner's comparison `base..head` names: each commit and the change it is. */
    const compared = (base: string, head: string) =>
      Effect.map(changes.compare("owner", appId, "appdev", { base, head }), (answer) =>
        answer.commits.map((commit) => [commit.sha, commit.change?.number ?? null] as const),
      );
    const changeRow = (number: number) =>
      Effect.map(
        sql<{
          readonly state: string;
          readonly merged_sha: string | null;
          readonly landed_head: string | null;
        }>`
          SELECT state, merged_sha, landed_head FROM hq_change
          WHERE app_id::text = ${appId} AND repo = 'appdev' AND number = ${number}`,
        (rows) => rows[0],
      );
    /** A task done by `nova` whose change is change 1, waiting for review. */
    const task = Effect.map(
      sql<{ readonly id: string }>`
        INSERT INTO hq_task (app_id, repo, number, title, body, url, delivery_id, state,
          mate_project_id, change_repo, change_number, source_kind, source, source_key)
        VALUES (${appId}::uuid, 'acme/tea-shop', 7, 'Add a search box', '',
          'https://example.test/7', 'delivery-7', 'done', 'nova', 'appdev', 1, 'github-issue',
          '{}'::jsonb, 'github:acme/tea-shop#7')
        RETURNING id::text AS id`,
      (rows) => rows[0]!.id,
    );
    /** The change's head as HQ recorded it, once it is `head`. */
    const headIs = (head: string) =>
      sql<{ readonly head: string | null }>`SELECT head FROM hq_change WHERE number = 1`.pipe(
        Effect.filterOrFail((rows) => rows[0]?.head === head),
        Effect.retry(Schedule.spaced(Duration.millis(50))),
        Effect.timeout(Duration.seconds(10)),
      );
    return {
      sql,
      told,
      task,
      headIs,
      git,
      host,
      mirror,
      changes,
      events,
      auth,
      appId,
      repo,
      main,
      github,
      hqDir,
      recorded,
      openChange,
      push,
      compared,
      changeRow,
    };
  });

describe("a repository mirrored to GitHub through the organization's app", () => {
  it("a change's branch on GitHub is its number and its title's words, at most 40 characters", () => {
    assert.strictEqual(changeBranch(1, "Add a search box"), "mate/1-add-a-search-box");
    assert.strictEqual(
      changeBranch(12, "  Fix: the menu's  ÜBER-width!  "),
      "mate/12-fix-the-menu-s-ber-width",
    );
    assert.strictEqual(
      changeBranch(3, "Make every product page load its pictures lazily on scroll"),
      "mate/3-make-every-product-page-load-its",
    );
    assert.strictEqual(changeBranch(4, "!!!"), "mate/4-change");
  });

  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("an empty GitHub repository gets Mate's main", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* mirrored();
          assert.strictEqual(yield* f.mirror.repositoryOf(f.appId, "appdev"), REPOSITORY);
          assert.deepStrictEqual(yield* f.mirror.sync(f.appId, "appdev"), {
            kind: "pushed",
            sha: f.main,
          });
          assert.strictEqual(refIn(f.github, "refs/heads/main"), f.main);
          assert.deepStrictEqual(yield* f.mirror.sync(f.appId, "appdev"), {
            kind: "same",
            sha: f.main,
          });
          assert.includeMembers(f.auth.asked, [REPOSITORY]);
        }),
      ),
    );

    it.effect(
      "a merge on GitHub moves Mate's main forward, and the change it brought in is merged with its rollout",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* mirrored();
            yield* f.mirror.sync(f.appId, "appdev");
            yield* f.openChange("Add a search box");
            const head = yield* f.push("search.ts");
            yield* until(() => refIn(f.github, "refs/heads/mate/1-add-a-search-box"), head);
            // Merged on GitHub with a merge commit: main there now holds the change's head.
            const merged = commitIn(f.github, [f.main, head], "merged");
            native(f.github, ["update-ref", "refs/heads/main", merged]);
            assert.deepStrictEqual(yield* f.mirror.sync(f.appId, "appdev"), {
              kind: "imported",
              from: f.main,
              to: merged,
            });
            assert.strictEqual(refIn(f.hqDir, "refs/heads/main"), merged);
            assert.deepStrictEqual(yield* f.changeRow(1), {
              state: "merged",
              merged_sha: merged,
              landed_head: head,
            });
            const rollouts = yield* f.sql<{ readonly n: number }>`
              SELECT count(*)::int AS n FROM hq_rollout WHERE cause = 'merge' AND sha = ${merged}`;
            assert.strictEqual(rollouts[0]?.n, 1);
            const logged = yield* f.sql<{ readonly by: string }>`
              SELECT data->>'by' AS by FROM hq_git_event WHERE kind = 'merged' AND number = 1`;
            assert.deepStrictEqual(logged, [{ by: "github" }]);
            // Following again, and recording the merge again, change nothing.
            assert.deepStrictEqual(yield* f.mirror.sync(f.appId, "appdev"), {
              kind: "same",
              sha: merged,
            });
            const again = yield* f.changes.landImported(f.appId, "appdev", 1, merged);
            assert.strictEqual(again.state, "merged");
            const events = yield* f.sql<{ readonly n: number }>`
              SELECT count(*)::int AS n FROM hq_git_event WHERE kind = 'merged'`;
            assert.strictEqual(events[0]?.n, 1);
          }),
        ),
    );

    it.effect(
      "a merge recorded from GitHub lands the head GitHub merged, never a push that came after",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* mirrored();
            yield* f.mirror.sync(f.appId, "appdev");
            yield* f.openChange("Add a search box");
            const merged = yield* f.push("search.ts");
            yield* until(() => refIn(f.github, "refs/heads/mate/1-add-a-search-box"), merged);
            const squash = commitIn(f.github, [f.main], "squashed");
            native(f.github, ["update-ref", "refs/heads/main", squash]);
            yield* f.mirror.sync(f.appId, "appdev");
            // The Mate pushed again just after GitHub merged.
            const later = yield* f.push("search.css");
            assert.notStrictEqual(later, merged);
            yield* f.changes.landImported(f.appId, "appdev", 1, squash, merged);
            assert.deepStrictEqual(yield* f.changeRow(1), {
              state: "merged",
              merged_sha: squash,
              landed_head: merged,
            });
          }),
        ),
    );

    it.effect(
      "every commit a merge on GitHub brought in is the merged change's in a comparison",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* mirrored();
            yield* f.mirror.sync(f.appId, "appdev");
            yield* f.openChange("Add a search box");
            const first = yield* f.push("search.ts");
            const head = yield* f.push("search.css");
            yield* until(() => refIn(f.github, "refs/heads/mate/1-add-a-search-box"), head);
            const merged = commitIn(f.github, [f.main, head], "merged");
            native(f.github, ["update-ref", "refs/heads/main", merged]);
            yield* f.mirror.sync(f.appId, "appdev");
            assert.deepStrictEqual(yield* f.compared(f.main, merged), [
              [merged, 1],
              [head, 1],
              [first, 1],
            ]);
          }),
        ),
    );

    it.effect("a change squashed on GitHub is its squash's in a comparison", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* mirrored();
          yield* f.mirror.sync(f.appId, "appdev");
          yield* f.openChange("Add a search box");
          const head = yield* f.push("search.ts");
          yield* until(() => refIn(f.github, "refs/heads/mate/1-add-a-search-box"), head);
          const squash = commitIn(f.github, [f.main], "squashed");
          native(f.github, ["update-ref", "refs/heads/main", squash]);
          yield* f.mirror.sync(f.appId, "appdev");
          yield* f.changes.landImported(f.appId, "appdev", 1, squash, head);
          assert.deepStrictEqual(yield* f.compared(f.main, squash), [[squash, 1]]);
        }),
      ),
    );

    it.effect(
      "two changes GitHub merged before Mate followed are each merged as their own merge commit",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* mirrored();
            yield* f.mirror.sync(f.appId, "appdev");
            yield* f.openChange("Add a search box");
            const one = yield* f.push("search.ts");
            yield* until(() => refIn(f.github, "refs/heads/mate/1-add-a-search-box"), one);
            // Another Mate's change, its branch on GitHub.
            const two = commitIn(f.github, [f.main], "footer.html");
            yield* f.openChange("Add a footer", 2, "vega");
            yield* f.sql`UPDATE hq_change SET head = ${two} WHERE number = 2`;
            const first = commitIn(f.github, [f.main, one], "merged one");
            const second = commitIn(f.github, [first, two], "merged two");
            native(f.github, ["update-ref", "refs/heads/main", second]);
            yield* f.mirror.sync(f.appId, "appdev");
            assert.deepStrictEqual(
              [(yield* f.changeRow(1))?.merged_sha, (yield* f.changeRow(2))?.merged_sha],
              [first, second],
            );
            assert.deepStrictEqual(yield* f.compared(f.main, second), [
              [second, 2],
              [two, 2],
              [first, 1],
              [one, 1],
            ]);
          }),
        ),
    );

    it.effect("a merge recorded from GitHub must be a commit Mate's main holds", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* mirrored();
          yield* f.openChange("Add a search box");
          yield* f.push("search.ts");
          const elsewhere = commitIn(f.github, [], "elsewhere");
          const refused = yield* Effect.flip(
            f.changes.landImported(f.appId, "appdev", 1, elsewhere),
          );
          assert.strictEqual(refused._tag, "ChangeRefused");
          assert.strictEqual((yield* f.changeRow(1))?.state, "open");
        }),
      ),
    );

    it.effect("Mate's main ahead of GitHub's is pushed there", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* mirrored();
          yield* f.mirror.sync(f.appId, "appdev");
          // Moved behind HQ's back, so only the explicit follow pushes it.
          const ahead = commitIn(f.hqDir, [f.main], "ahead");
          native(f.hqDir, ["update-ref", "refs/heads/main", ahead]);
          assert.deepStrictEqual(yield* f.mirror.sync(f.appId, "appdev"), {
            kind: "pushed",
            sha: ahead,
          });
          assert.strictEqual(refIn(f.github, "refs/heads/main"), ahead);
        }),
      ),
    );

    it.effect("following GitHub talks to it without holding the repository's lock", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* mirrored();
          yield* f.mirror.sync(f.appId, "appdev");
          const ahead = commitIn(f.hqDir, [f.main], "ahead");
          native(f.hqDir, ["update-ref", "refs/heads/main", ahead]);
          // Someone holds the repository's row — a merge, a remote edit — for as long as this test.
          const held = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          yield* Effect.forkScoped(
            f.sql.withTransaction(
              Effect.gen(function* () {
                yield* f.sql`
                  SELECT 1 FROM hq_repo WHERE app_id::text = ${f.appId} AND name = 'appdev'
                  FOR UPDATE`;
                yield* Deferred.succeed(held, undefined);
                yield* Deferred.await(release);
              }),
            ),
          );
          yield* Deferred.await(held);
          assert.deepStrictEqual(
            yield* f.mirror.sync(f.appId, "appdev").pipe(Effect.timeout(Duration.seconds(5))),
            { kind: "pushed", sha: ahead },
          );
          assert.strictEqual(refIn(f.github, "refs/heads/main"), ahead);
          yield* Deferred.succeed(release, undefined);
        }),
      ),
    );

    it.effect("Mate's main moving in Mate reaches GitHub's default branch on its own", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* mirrored();
          yield* f.mirror.sync(f.appId, "appdev");
          const moved = yield* f.recorded(
            f.git.commitFiles(f.repo, "refs/heads/main", {
              files: { "about.html": "about\n" },
              expectedHead: f.main,
              message: "About page",
              author: AUTHOR,
            }),
          );
          const sha = "sha" in moved ? moved.sha : "";
          yield* until(() => refIn(f.github, "refs/heads/main"), sha);
        }),
      ),
    );

    it.effect("GitHub's push to its default branch moves Mate's main", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* mirrored();
          yield* f.mirror.sync(f.appId, "appdev");
          const theirs = commitIn(f.github, [f.main], "hotfix");
          native(f.github, ["update-ref", "refs/heads/main", theirs]);
          yield* f.events.dispatch({
            name: "push",
            deliveryId: "delivery-1",
            repository: "Acme/Tea-Shop",
            payload: { ref: "refs/heads/main", repository: { default_branch: "main" } },
          });
          assert.strictEqual(refIn(f.hqDir, "refs/heads/main"), theirs);
        }),
      ),
    );

    it.effect(
      "a repository HQ made but nobody wrote to takes the history of the GitHub repository it connects to",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* mirrored();
            const tree = native(f.hqDir, ["mktree"], "");
            const unwritten = native(f.hqDir, ["commit-tree", tree, "-m", "Initial commit"]);
            native(f.hqDir, ["update-ref", "refs/heads/main", unwritten]);
            const theirs = commitIn(f.github, [], "readme");
            native(f.github, ["update-ref", "refs/heads/main", theirs]);
            assert.deepStrictEqual(yield* f.mirror.sync(f.appId, "appdev"), {
              kind: "imported",
              from: unwritten,
              to: theirs,
            });
            assert.strictEqual(refIn(f.hqDir, "refs/heads/main"), theirs);
            assert.strictEqual(refIn(f.github, "refs/heads/main"), theirs);
          }),
        ),
    );

    it.effect("diverged histories move nothing, and the repository says since when", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* mirrored();
          yield* f.mirror.sync(f.appId, "appdev");
          const ours = commitIn(f.hqDir, [f.main], "ours");
          native(f.hqDir, ["update-ref", "refs/heads/main", ours]);
          const theirs = commitIn(f.github, [f.main], "theirs");
          native(f.github, ["update-ref", "refs/heads/main", theirs]);
          assert.deepStrictEqual(yield* f.mirror.sync(f.appId, "appdev"), {
            kind: "diverged",
            mate: ours,
            github: theirs,
          });
          assert.strictEqual(refIn(f.hqDir, "refs/heads/main"), ours);
          assert.strictEqual(refIn(f.github, "refs/heads/main"), theirs);
          const marked = yield* f.sql<{ readonly diverged: boolean }>`
            SELECT diverged_since IS NOT NULL AS diverged FROM hq_repo_mirror`;
          assert.deepStrictEqual(marked, [{ diverged: true }]);
          // Once GitHub takes Mate's main back, they follow again and the mark goes.
          native(f.github, ["update-ref", "refs/heads/main", f.main]);
          assert.deepStrictEqual(yield* f.mirror.sync(f.appId, "appdev"), {
            kind: "pushed",
            sha: ours,
          });
          const cleared = yield* f.sql<{ readonly diverged: boolean }>`
            SELECT diverged_since IS NOT NULL AS diverged FROM hq_repo_mirror`;
          assert.deepStrictEqual(cleared, [{ diverged: false }]);
        }),
      ),
    );

    it.effect(
      "a change's push reaches its own branch on GitHub, and its next push updates it",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* mirrored();
            yield* f.openChange("Add a search box");
            const first = yield* f.push("search.ts");
            yield* until(() => refIn(f.github, "refs/heads/mate/1-add-a-search-box"), first);
            // A title edited later keeps the branch it was given.
            yield* f.sql`UPDATE hq_change SET title = 'Search, faster' WHERE number = 1`;
            const second = yield* f.push("search.css");
            yield* until(() => refIn(f.github, "refs/heads/mate/1-add-a-search-box"), second);
            assert.deepStrictEqual(yield* f.mirror.pushChange(f.appId, "appdev", 1), {
              branch: "mate/1-add-a-search-box",
              sha: second,
            });
            assert.strictEqual(refIn(f.github, "refs/heads/mate/1-search-faster"), null);
          }),
        ),
    );

    it.effect("a change's branch someone else pushed to on GitHub is never overwritten", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* mirrored();
          yield* f.openChange("Add a search box");
          const first = yield* f.push("search.ts");
          yield* until(() => refIn(f.github, "refs/heads/mate/1-add-a-search-box"), first);
          const reviewer = commitIn(f.github, [first], "reviewer");
          native(f.github, ["update-ref", "refs/heads/mate/1-add-a-search-box", reviewer]);
          yield* f.push("search.css");
          const refused = yield* Effect.flip(f.mirror.pushChange(f.appId, "appdev", 1));
          assert.strictEqual(refused._tag, "GithubMirrorUnavailable");
          assert.strictEqual(refIn(f.github, "refs/heads/mate/1-add-a-search-box"), reviewer);
        }),
      ),
    );

    it.effect(
      "commits a reviewer adds to a change's branch on GitHub come into Mate's copy, and its Mate is told once",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* mirrored();
            yield* f.openChange("Add a search box");
            const taskId = yield* f.task;
            const first = yield* f.push("search.ts");
            // Once HQ kept what it pushed there (after the push's own follow, in turn).
            yield* f.mirror.pushChange(f.appId, "appdev", 1);
            assert.strictEqual(refIn(f.github, "refs/heads/mate/1-add-a-search-box"), first);
            const suggested = commitAs(f.github, [first], "Apply suggestion", {
              name: "Juno Reviewer",
              email: "7+juno-reviews@users.noreply.github.com",
            });
            native(f.github, ["update-ref", "refs/heads/mate/1-add-a-search-box", suggested]);
            const delivered = {
              name: "push",
              deliveryId: "delivery-suggestion",
              repository: REPOSITORY,
              payload: {
                ref: "refs/heads/mate/1-add-a-search-box",
                after: suggested,
                repository: { default_branch: "main" },
              },
            };
            yield* f.events.dispatch(delivered);
            assert.strictEqual(refIn(f.hqDir, "refs/heads/mate/nova/1"), suggested);
            yield* f.headIs(suggested);
            assert.deepStrictEqual(f.told, [
              {
                taskId,
                message: {
                  id: `github-commits:${suggested}`,
                  from: "review",
                  author: "juno-reviews",
                  text: `juno-reviews added commits to your change on GitHub (${suggested.slice(0, 7)} Apply suggestion). Pull Mate's copy of your branch before your next push.`,
                },
              },
            ]);
            // The same news again tells nobody again, and the next push goes on from it.
            yield* f.events.dispatch({ ...delivered, deliveryId: "delivery-again" });
            assert.strictEqual(f.told.length, 1);
            assert.deepStrictEqual(yield* f.mirror.pushChange(f.appId, "appdev", 1), {
              branch: "mate/1-add-a-search-box",
              sha: suggested,
            });
          }),
        ),
    );

    it.effect(
      "a change whose branch on GitHub diverged says so, and is tried again only when either side moves",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* mirrored();
            yield* f.openChange("Add a search box");
            const first = yield* f.push("search.ts");
            yield* until(() => refIn(f.github, "refs/heads/mate/1-add-a-search-box"), first);
            const reviewer = commitIn(f.github, [first], "reviewer");
            native(f.github, ["update-ref", "refs/heads/mate/1-add-a-search-box", reviewer]);
            yield* f.push("search.css");
            yield* Effect.flip(f.mirror.pushChange(f.appId, "appdev", 1));
            const change = yield* f.changes.change(f.appId, "appdev", 1);
            assert.isString(change.mirrorDivergedSince);
            assert.deepStrictEqual(yield* changesToPush(f.sql, f.appId, "appdev"), []);
            // Mate's side moving makes it worth trying again.
            yield* f.sql`UPDATE hq_change SET head = ${first} WHERE number = 1`;
            assert.deepStrictEqual(yield* changesToPush(f.sql, f.appId, "appdev"), [1]);
          }),
        ),
    );

    it.effect(
      "a change pushed while the app could not reach GitHub gets there on the next sweep",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* mirrored(Duration.millis(200));
            f.auth.installed = false;
            yield* f.openChange("Add a search box");
            const head = yield* f.push("search.ts");
            assert.strictEqual(refIn(f.github, "refs/heads/mate/1-add-a-search-box"), null);
            f.auth.installed = true;
            yield* until(() => refIn(f.github, "refs/heads/mate/1-add-a-search-box"), head);
            yield* until(() => refIn(f.github, "refs/heads/main"), f.main);
          }),
        ),
    );

    it.effect(
      "a GitHub repository made again under the connected one's name is never pushed to",
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            const f = yield* mirrored();
            f.auth.id = "999";
            const refused = yield* Effect.flip(f.mirror.sync(f.appId, "appdev"));
            assert.deepStrictEqual(
              {
                tag: refused._tag,
                reason: "reason" in refused ? refused.reason : undefined,
                detail: "detail" in refused ? refused.detail : undefined,
              },
              {
                tag: "GithubMirrorUnavailable",
                reason: "refused",
                detail: "the repository on GitHub is not the one connected",
              },
            );
            yield* f.openChange("Add a search box");
            yield* f.push("search.ts");
            const change = yield* Effect.flip(f.mirror.pushChange(f.appId, "appdev", 1));
            assert.strictEqual("reason" in change ? change.reason : undefined, "refused");
            assert.strictEqual(native(f.github, ["for-each-ref"]), "");
          }),
        ),
    );

    it.effect("a repository the app does not reach is not mirrored", () =>
      Effect.scoped(
        Effect.gen(function* () {
          const f = yield* mirrored();
          f.auth.installed = false;
          const refused = yield* Effect.flip(f.mirror.sync(f.appId, "appdev"));
          assert.deepStrictEqual(
            { tag: refused._tag, reason: "reason" in refused ? refused.reason : undefined },
            { tag: "GithubMirrorUnavailable", reason: "not_mirrored" },
          );
          yield* f.sql`UPDATE hq_repo_remote SET via = 'token'`;
          assert.strictEqual(yield* f.mirror.repositoryOf(f.appId, "appdev"), undefined);
          assert.strictEqual(refIn(f.github, "refs/heads/main"), null);
        }),
      ),
    );
  });
});
