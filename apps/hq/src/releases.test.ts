// @effect-diagnostics nodeBuiltinImport:off -- each test's git root is a temporary directory, its git read with the host's git.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";

import { assert, describe, it } from "@effect/vitest";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import type { Release } from "@t3tools/shared/hqRelease";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { gitClient } from "../test/harness/gitClient.ts";
import { addProject, mateInApp, remoteOf, rowsWhere } from "../test/harness/mates.ts";
import { groupCheckout, propose, stateBecomes } from "../test/harness/recipe.ts";
import { sessionFor, startCore, untilHealth } from "../test/harness/runningCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { GitHost, gitHostLayer, mainOf } from "./gitHost.ts";
import { RecipeTiers } from "./recipeTiers.ts";
import { ReleaseRefused, Releases, releasesLayer } from "./releases.ts";
import { Roles } from "./roles.ts";
import { rolloutsLayer } from "./rollouts.ts";
import type { ZeropsMember } from "./zerops/api.ts";

const AUTHOR = { name: "Ada", email: "ada@mate.test" };

const member = (userId: string, roleCode: string): ZeropsMember => ({
  name: userId,
  kind: "person",
  roleCode,
  status: "ACTIVE",
  userId,
  clientUserId: `C-${userId}`,
  canCreateProjects: false,
});

/**
 * The org as HQ reads it: its owner; admin, an org admin with Read access on Shop's production
 * project; dev, Basic user on Shop's production and stage projects, who may deploy there; viewer,
 * who sees them through Read access; stranger, who has nothing there.
 */
const ORG_VIEW = {
  orgId: "ORG",
  members: [
    member("owner", "OWNER"),
    member("admin", "ADMIN"),
    member("dev", "NO_ACCESS"),
    member("viewer", "NO_ACCESS"),
    member("stranger", "NO_ACCESS"),
  ],
  projects: [
    {
      id: "P_PROD",
      orgId: "ORG",
      name: "Shop - production",
      status: "ACTIVE",
      tags: [],
      userRoles: [
        { clientUserId: "C-admin", roleCode: "READ_ONLY" },
        { clientUserId: "C-dev", roleCode: "BASIC_USER" },
        { clientUserId: "C-viewer", roleCode: "READ_ONLY" },
      ],
      publicZone: "pprod.prg1-zerops.zone",
    },
    {
      id: "P_STAGE",
      orgId: "ORG",
      name: "Shop - stage",
      status: "ACTIVE",
      tags: [],
      userRoles: [
        { clientUserId: "C-dev", roleCode: "BASIC_USER" },
        { clientUserId: "C-viewer", roleCode: "READ_ONLY" },
      ],
      publicZone: "pstage.prg1-zerops.zone",
    },
  ],
};

/** A production tier whose runtimes are built from the application's repositories `repos`. */
const productionTier = (
  appId: string,
  runtimes: ReadonlyArray<{ readonly hostname: string; readonly repo: string }>,
): RecipeTierResponse => ({
  state: "present",
  mainHead: "0".repeat(40),
  importYaml: [
    "services:",
    ...runtimes.flatMap(({ hostname, repo }) => [
      `  - hostname: ${hostname}`,
      "    type: nodejs@22",
      `    buildFromGit: https://hq.example.test/git/${appId}/${repo}.git`,
      `    zeropsSetup: ${hostname}`,
    ]),
    "  - hostname: db",
    "    type: postgresql@16",
    "",
  ].join("\n"),
});

interface Rig {
  readonly appId: string;
  readonly root: string;
  readonly tiers: Map<string, RecipeTierResponse>;
  /** Commits `files` to `main` of the application's repository `repo`, made if new; the new head. */
  readonly commit: (repo: string, files: Readonly<Record<string, string>>) => Effect.Effect<string>;
  /** `git <args>` on the application's bare repository `repo`; its output. */
  readonly bare: (repo: string, args: ReadonlyArray<string>) => string;
}

/**
 * Releases over a leading Core's database and git: the application Shop with its production
 * project P_PROD and its stage P_STAGE; its production tier declares the runtime `app`, built from
 * its repository `appdev`.
 */
const withReleases = <A, E>(
  use: (rig: Rig) => Effect.Effect<A, E, Releases | SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-releases-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const tiers = new Map<string, RecipeTierResponse>();
    const context = yield* Layer.build(
      releasesLayer.pipe(
        Layer.provideMerge(gitHostLayer({ rootDir: root })),
        Layer.provideMerge(rolloutsLayer),
        Layer.provideMerge(activeCoreLayer(url)),
        Layer.provide(
          Layer.succeed(Roles, {
            view: Effect.succeed({ ...ORG_VIEW, freshness: "cached" as const }),
            forWrite: Effect.succeed({ ...ORG_VIEW, freshness: "recent" as const }),
            recent: Effect.succeed({ ...ORG_VIEW, freshness: "cached" as const }),
            exists: () => Effect.succeed(true),
            answeredAt: Effect.succeed(undefined),
            views: Stream.never,
          }),
        ),
        Layer.provide(
          Layer.succeed(RecipeTiers, {
            read: (appId, tier) =>
              Effect.succeed(tiers.get(`${appId}/${tier}`) ?? { state: "absent" as const }),
          }),
        ),
      ),
    );
    yield* untilActive.pipe(Effect.provide(context));
    const sql = Context.get(context, SqlClient.SqlClient);
    const git = yield* Context.get(context, GitHost).git.pipe(
      Effect.retry(Schedule.spaced(Duration.millis(50))),
      Effect.timeout(Duration.seconds(10)),
    );
    const [app] = yield* sql<{ readonly id: string }>`
      INSERT INTO hq_app (name, created_by) VALUES ('Shop', 'owner') RETURNING id::text AS id`;
    const appId = app!.id;
    yield* sql`
      INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
      VALUES ('P_PROD', ${appId}::uuid, 'production', 'owner'),
             ('P_STAGE', ${appId}::uuid, 'stage', 'owner')`;
    tiers.set(`${appId}/production`, productionTier(appId, [{ hostname: "app", repo: "appdev" }]));

    const heads = new Map<string, string>();
    const commit = (repo: string, files: Readonly<Record<string, string>>) =>
      Effect.gen(function* () {
        const at = { appId, id: repo };
        if (!heads.has(repo)) {
          yield* sql`
            INSERT INTO hq_repo (app_id, name, created_by) VALUES (${appId}::uuid, ${repo}, 'core')`;
          yield* git.create(at);
        }
        const made = yield* git.commitFiles(at, "refs/heads/main", {
          files,
          expectedHead: heads.get(repo) ?? null,
          message: `Change ${repo}`,
          author: AUTHOR,
        });
        const sha = "sha" in made ? made.sha : "";
        heads.set(repo, sha);
        return sha;
      }).pipe(Effect.orDie);
    const bare = (repo: string, args: ReadonlyArray<string>) =>
      NodeChildProcess.execFileSync(
        "git",
        ["--git-dir", NodePath.join(root, appId, `${repo}.git`), ...args],
        {
          encoding: "utf8",
          env: {
            PATH: process.env["PATH"] ?? "/usr/bin:/bin",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: "/dev/null",
            GIT_AUTHOR_NAME: AUTHOR.name,
            GIT_AUTHOR_EMAIL: AUTHOR.email,
            GIT_COMMITTER_NAME: AUTHOR.name,
            GIT_COMMITTER_EMAIL: AUTHOR.email,
          },
        },
      ).trim();
    return yield* use({ appId, root, tiers, commit, bare }).pipe(Effect.provide(context));
  });

const isReleaseRefused = Schema.is(ReleaseRefused);

/** What a refused ask answered: its code and reason, or what else failed it. */
const refusal = <A, E, R>(asked: Effect.Effect<A, E, R>) =>
  Effect.map(Effect.flip(asked), (error) =>
    isReleaseRefused(error) ? [error.code, error.reason] : [String(error), null],
  );

describe("an application's releases in HQ", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("makes no release without a production, whoever asks, and tags nothing", () =>
      withReleases(({ appId, commit, bare }) =>
        Effect.gen(function* () {
          const releases = yield* Releases;
          const sql = yield* SqlClient.SqlClient;
          yield* sql`DELETE FROM hq_app_project WHERE project_id = 'P_PROD'`;
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          const sha = yield* commit("appdev", { "index.js": "1\n" });
          const entries = [{ service: "app", sha }];
          for (const userId of ["admin", "owner", "dev"]) {
            assert.deepStrictEqual(
              yield* refusal(
                releases.release(userId, appId, { tag: "v0.1.0", groupHead, entries }),
              ),
              ["forbidden", "no_production"],
            );
            assert.deepStrictEqual(
              yield* refusal(releases.rollback(userId, appId, "v0.1.0", { groupHead })),
              ["forbidden", "no_production"],
            );
          }
          assert.strictEqual(bare("group", ["tag", "-l"]), "");
          assert.deepStrictEqual(yield* releases.list("admin", appId), []);
          assert.deepStrictEqual(yield* sql`SELECT id FROM hq_rollout WHERE cause = 'release'`, []);
        }),
      ),
    );

    it.effect("tags what was offered on the recipe's main, records it approved, and lists it", () =>
      withReleases(({ appId, commit, bare }) =>
        Effect.gen(function* () {
          const releases = yield* Releases;
          const sql = yield* SqlClient.SqlClient;
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          const first = yield* commit("appdev", { "index.js": "1\n" });
          const app = yield* commit("appdev", { "index.js": "2\n" });
          const made = yield* releases.release("dev", appId, {
            tag: "v0.1.0",
            groupHead,
            entries: [{ service: "app", sha: app }],
          });
          assert.deepStrictEqual({ ...made, at: typeof made.at }, {
            tag: "v0.1.0",
            sha: groupHead,
            entries: [{ service: "app", sha: app }],
            by: "dev",
            at: "string",
            state: "approved",
            reason: null,
            rollbackOf: null,
          } satisfies Partial<Record<keyof Release, unknown>>);
          // An annotated tag on the head offered, its message the release's lines.
          assert.strictEqual(bare("group", ["cat-file", "-t", "refs/tags/v0.1.0"]), "tag");
          assert.strictEqual(bare("group", ["rev-parse", "v0.1.0^{commit}"]), groupHead);
          assert.strictEqual(
            bare("group", ["tag", "-l", "--format=%(contents)", "v0.1.0"]),
            `app ${app}`,
          );
          const events = yield* sql<{ readonly repo: string; readonly tag: string }>`
              SELECT repo, data->>'tag' AS tag FROM hq_git_event WHERE kind = 'released'`;
          assert.deepStrictEqual(events, [{ repo: "group", tag: "v0.1.0" }]);
          // A commit main has passed since is still main's: a release names what it offered.
          const older = yield* releases.release("dev", appId, {
            tag: "v0.1.1",
            groupHead,
            entries: [{ service: "app", sha: first }],
          });
          assert.strictEqual(older.state, "approved");
          assert.deepStrictEqual(
            (yield* releases.list("dev", appId)).map((release) => release.tag),
            ["v0.1.1", "v0.1.0"],
          );
        }),
      ),
    );

    it.effect("refuses, and tags and records nothing, whatever it refuses", () =>
      withReleases(({ appId, commit, bare, tiers }) =>
        Effect.gen(function* () {
          const releases = yield* Releases;
          const sql = yield* SqlClient.SqlClient;
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          const app = yield* commit("appdev", { "index.js": "1\n" });
          const branched = bare("appdev", [
            "commit-tree",
            bare("appdev", ["rev-parse", `${app}^{tree}`]),
            "-p",
            app,
            "-m",
            "A branch's commit",
          ]);
          const entries = [{ service: "app", sha: app }];
          const ask = (
            userId: string,
            request: Partial<Parameters<typeof releases.release>[2]> = {},
            of = appId,
          ) =>
            refusal(
              releases.release(userId, of, { tag: "v0.2.0", groupHead, entries, ...request }),
            );
          yield* releases.release("dev", appId, { tag: "v0.1.0", groupHead, entries });
          const rows = [
            ["a name taken", ask("dev", { tag: "v0.1.0" })],
            ["a name older than a release", ask("dev", { tag: "v0.0.9" })],
            ["the same version under a different spelling", ask("dev", { tag: "v00.1.0" })],
            ["main moved since the offer", ask("dev", { groupHead: app })],
            [
              "a service production has not",
              ask("dev", { entries: [{ service: "web", sha: app }] }),
            ],
            [
              "a service no repository of the application builds",
              ask("dev", { entries: [{ service: "db", sha: app }] }),
            ],
            ["a commit main has not", ask("dev", { entries: [{ service: "app", sha: branched }] })],
            [
              "a commit of another repository",
              ask("dev", { entries: [{ service: "app", sha: groupHead }] }),
            ],
            // What it names comes before where it is: every service, then every commit.
            [
              "a commit main has not, beside a service production has not",
              ask("dev", {
                entries: [
                  { service: "app", sha: branched },
                  { service: "web", sha: app },
                ],
              }),
            ],
            ["Read access on production", ask("viewer")],
            ["nothing in the org there", ask("stranger")],
            ["an application HQ has not", ask("owner", {}, "00000000-0000-0000-0000-000000000000")],
          ] as const;
          const answered = yield* Effect.forEach(rows, ([name, refused]) =>
            Effect.map(refused, (answer) => [name, ...answer]),
          );
          assert.deepStrictEqual(answered, [
            ["a name taken", "conflict", "tag_taken"],
            ["a name older than a release", "conflict", "tag_not_newer"],
            ["the same version under a different spelling", "conflict", "tag_not_newer"],
            ["main moved since the offer", "conflict", "group_moved"],
            ["a service production has not", "conflict", "unknown_service"],
            ["a service no repository of the application builds", "conflict", "unknown_service"],
            ["a commit main has not", "conflict", "entry_not_on_main"],
            ["a commit of another repository", "conflict", "entry_not_on_main"],
            [
              "a commit main has not, beside a service production has not",
              "conflict",
              "unknown_service",
            ],
            ["Read access on production", "forbidden", "not_releaser"],
            ["nothing in the org there", "forbidden", "app_not_seen"],
            ["an application HQ has not", "app_not_found", "app_not_found"],
          ]);
          // No production tier at all: no service is production's.
          tiers.delete(`${appId}/production`);
          assert.deepStrictEqual(yield* ask("dev"), ["conflict", "unknown_service"]);
          // Without the recipe's main, nothing is tagged.
          yield* sql`DELETE FROM hq_repo WHERE name = 'group'`;
          assert.deepStrictEqual(yield* ask("dev", { tag: "v9.0.0" }), [
            "conflict",
            "no_group_main",
          ]);
          // One tag and one record, the first release's: every refusal was only an answer.
          assert.deepStrictEqual(bare("group", ["tag", "-l"]), "v0.1.0");
          assert.deepStrictEqual(
            yield* sql`SELECT kind FROM hq_git_event WHERE kind = 'released'`,
            [{ kind: "released" }],
          );
        }),
      ),
    );

    it.effect(
      "asks the same of a rollback as of a release, and tells no production only to a developer",
      () =>
        withReleases(({ appId, commit }) =>
          Effect.gen(function* () {
            const releases = yield* Releases;
            const sql = yield* SqlClient.SqlClient;
            const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
            const app = yield* commit("appdev", { "index.js": "1\n" });
            const entries = [{ service: "app", sha: app }];
            yield* releases.release("dev", appId, { tag: "v0.1.0", groupHead, entries });
            const both = (userId: string) =>
              Effect.map(
                Effect.all([
                  refusal(releases.release(userId, appId, { tag: "v0.2.0", groupHead, entries })),
                  refusal(releases.rollback(userId, appId, "v0.1.0", { groupHead })),
                ]),
                (answers): ReadonlyArray<unknown> => answers,
              );
            const refused = (code: string, reason: string) => [
              [code, reason],
              [code, reason],
            ];
            // An org admin with Read access on production deploys nothing there (main C12).
            assert.deepStrictEqual(yield* both("admin"), refused("forbidden", "not_releaser"));
            assert.deepStrictEqual(yield* both("viewer"), refused("forbidden", "not_releaser"));
            assert.deepStrictEqual(yield* both("stranger"), refused("forbidden", "app_not_seen"));
            // With no production, a developer hears so; who only sees the application, not.
            yield* sql`DELETE FROM hq_app_project WHERE project_id = 'P_PROD'`;
            assert.deepStrictEqual(yield* both("dev"), refused("forbidden", "no_production"));
            assert.deepStrictEqual(yield* both("viewer"), refused("forbidden", "not_releaser"));
          }),
        ),
    );

    it.effect(
      "rolls back with a new release of an earlier one's commits, the earlier left as it was",
      () =>
        withReleases(({ appId, commit, bare, tiers }) =>
          Effect.gen(function* () {
            const releases = yield* Releases;
            const sql = yield* SqlClient.SqlClient;
            const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
            const one = yield* commit("appdev", { "index.js": "1\n" });
            yield* releases.release("dev", appId, {
              tag: "v0.1.0",
              groupHead,
              entries: [{ service: "app", sha: one }],
            });
            const two = yield* commit("appdev", { "index.js": "2\n" });
            yield* releases.release("dev", appId, {
              tag: "v0.9.0",
              groupHead,
              entries: [{ service: "app", sha: two }],
            });
            const moved = yield* commit("group", { "README.md": "# Shop, again\n" });
            const back = yield* releases.rollback("dev", appId, "v0.1.0", { groupHead: moved });
            assert.deepStrictEqual(
              { tag: back.tag, sha: back.sha, entries: back.entries, rollbackOf: back.rollbackOf },
              {
                tag: "v0.9.1",
                sha: moved,
                entries: [{ service: "app", sha: one }],
                rollbackOf: "v0.1.0",
              },
            );
            assert.strictEqual(bare("group", ["rev-parse", "v0.1.0^{commit}"]), groupHead);
            assert.strictEqual(bare("group", ["rev-parse", "v0.9.1^{commit}"]), moved);
            assert.deepStrictEqual(
              (yield* releases.list("dev", appId)).map((release) => release.tag),
              ["v0.9.1", "v0.9.0", "v0.1.0"],
            );

            // An imported refusal is no release to go back to; an unknown one is not found; and a
            // rollback is a release's: its head must still be main.
            yield* sql`
              INSERT INTO hq_release (app_id, tag, sha, entries, released_by, state, reason)
              VALUES (${appId}::uuid, 'v0.5.0', ${groupHead}, '[]', 'u-imported', 'refused',
                'the tag lists a service this group does not deploy')`;
            assert.deepStrictEqual(
              yield* refusal(releases.rollback("dev", appId, "v0.5.0", { groupHead: moved })),
              ["conflict", "release_not_approved"],
            );
            assert.deepStrictEqual(
              yield* refusal(releases.rollback("dev", appId, "v0.4.0", { groupHead: moved })),
              ["release_not_found", "release_not_found"],
            );
            assert.deepStrictEqual(
              yield* refusal(releases.rollback("dev", appId, "v0.1.0", { groupHead })),
              ["conflict", "group_moved"],
            );
            assert.deepStrictEqual(
              yield* refusal(releases.rollback("viewer", appId, "v0.1.0", { groupHead: moved })),
              ["forbidden", "not_releaser"],
            );

            // Production no longer builds `app`: a rollback still carries it as it was (main C16 —
            // its deploy reports it and deploys the rest); a new release of it is refused.
            tiers.set(
              `${appId}/production`,
              productionTier(appId, [{ hostname: "web", repo: "appdev" }]),
            );
            const kept = yield* releases.rollback("dev", appId, "v0.1.0", { groupHead: moved });
            assert.deepStrictEqual(
              [kept.tag, kept.entries, kept.rollbackOf],
              ["v0.9.2", [{ service: "app", sha: one }], "v0.1.0"],
            );
            assert.deepStrictEqual(
              yield* refusal(
                releases.release("dev", appId, {
                  tag: "v1.0.0",
                  groupHead: moved,
                  entries: [{ service: "app", sha: one }],
                }),
              ),
              ["conflict", "unknown_service"],
            );
          }),
        ),
    );

    it.effect("lists the newest ten by version, to whoever reads the application's changes", () =>
      withReleases(({ appId, commit }) =>
        Effect.gen(function* () {
          const releases = yield* Releases;
          const sql = yield* SqlClient.SqlClient;
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          for (const tag of ["v0.2.0", "v0.10.0", "v0.9.0", "v1.0.0", "v0.1.0", "v0.3.0"]) {
            for (const patch of ["", "1", "2"]) {
              const named = patch === "" ? tag : tag.replace(/\.0$/u, `.${patch}`);
              yield* sql`
                INSERT INTO hq_release (app_id, tag, sha, entries, released_by, state)
                VALUES (${appId}::uuid, ${named}, ${groupHead}, '[]', 'dev', 'approved')`;
            }
          }
          assert.deepStrictEqual(
            (yield* releases.list("dev", appId)).map((release) => release.tag),
            [
              "v1.0.2",
              "v1.0.1",
              "v1.0.0",
              "v0.10.2",
              "v0.10.1",
              "v0.10.0",
              "v0.9.2",
              "v0.9.1",
              "v0.9.0",
              "v0.3.2",
            ],
          );
          assert.deepStrictEqual(yield* refusal(releases.list("viewer", appId)), [
            "forbidden",
            "changes_not_seen",
          ]);
          assert.deepStrictEqual(yield* refusal(releases.list("stranger", appId)), [
            "forbidden",
            "app_not_seen",
          ]);
        }),
      ),
    );
  });
});

/**
 * Over HQ's API: Shop, whose recipe's production tier builds its service `app` from the repository
 * appdev, merged; production attached with its deploy token kept and `app` in its project; appdev's
 * `main` buildable (`app`). The owner's POSTs to the application timed (`inTime`: answered within
 * 5 s), and its releases' tags as the owner reads them.
 */
const productionApp = Effect.gen(function* () {
  const { call, fake, origin, url, gitHost } = yield* startCore(true);
  yield* untilHealth(call, "active");
  const owner = yield* sessionFor(call, "door-owner");
  const { appId, credential, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
  addProject(fake, "P_PROD");
  yield* call("POST", `/api/apps/${appId}/projects`, {
    session: owner,
    body: { projectId: "P_PROD", kind: "production", environment: { name: "production" } },
  });
  fake.tokens.set("key-prod", {
    id: "T_PROD",
    name: "deploy-production",
    orgId: "ORG",
    roleCode: "NO_ACCESS",
    canCreateProjects: false,
    canViewFinances: false,
    canEditFinances: false,
    projects: [{ projectId: "P_PROD", roleCode: "BASIC_USER" }],
    createdMs: 0,
    createdByUser: "owner",
  });
  const kept = yield* call("PUT", `/api/apps/${appId}/environments/production/deploy-token`, {
    session: owner,
    body: { token: "key-prod" },
  });
  assert.strictEqual(kept.status, 200);
  fake.services.push({
    id: "S-app-prod",
    projectId: "P_PROD",
    name: "app",
    status: "ACTIVE",
    isSystem: false,
    subdomainAccess: false,
    http: true,
    named: { id: "V0-app", name: "" },
    activeVersionId: "V0-app",
  });
  // The service's repository, buildable, and the recipe's production tier built from it.
  yield* call("POST", "/api/mate/repos", { headers: auth, body: { name: "appdev" } });
  const git = yield* gitHost.git;
  const appdev = { appId, id: "appdev" };
  const built = yield* git.commitFiles(appdev, "refs/heads/main", {
    files: {
      "zerops.yaml": "zerops:\n  - setup: app\n    run:\n      start: node index.js\n",
    },
    expectedHead: yield* mainOf(git, appdev),
    message: "Build it",
    author: AUTHOR,
  });
  const app = "sha" in built ? built.sha : "";
  const number = yield* propose(call, auth);
  const group = yield* groupCheckout(yield* gitClient, origin, credential, appId, "group");
  yield* group.write(
    {
      "4 — Small Production/import.yaml": [
        "services:",
        "  - hostname: app",
        "    type: nodejs@22",
        `    buildFromGit: ${origin}/git/${appId}/appdev.git`,
        "    zeropsSetup: app",
        "",
      ].join("\n"),
    },
    "The production's",
  );
  yield* group.push("P_MATE", number);
  yield* stateBecomes(call, owner, appId, number, "merged");
  const groupHead = yield* group.main;
  /** The owner's POST, timed, and the states of the deploys it answers. */
  const timed = (path: string, body: unknown) =>
    Effect.map(
      Effect.timed(call("POST", `/api/apps/${appId}${path}`, { session: owner, body })),
      ([took, answer]) => ({
        status: answer.status,
        inTime: Duration.toMillis(took) < 5000,
        deploys: (
          answer.body as {
            readonly deploys?: { readonly jobs: ReadonlyArray<{ readonly state: string }> };
          }
        ).deploys?.jobs.map((job) => job.state),
      }),
    );
  const tags = Effect.map(
    call("GET", `/api/apps/${appId}/releases`, { session: owner }),
    (answer) =>
      (answer.body as { readonly releases: ReadonlyArray<Release> }).releases.map(
        (release) => release.tag,
      ),
  );
  return { fake, url, app, groupHead, timed, tags };
});

describe("an application's releases over HQ's API", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect(
      "a person releases what main has, rolls it back, and reads it, as their role allows",
      () =>
        Effect.gen(function* () {
          const { call, fake, origin } = yield* startCore(true);
          yield* untilHealth(call, "active");
          const owner = yield* sessionFor(call, "door-owner");
          const { appId, credential, auth } = yield* mateInApp(call, fake, owner, "P_MATE", "Shop");
          addProject(fake, "P_PROD");
          const attached = yield* call("POST", `/api/apps/${appId}/projects`, {
            session: owner,
            body: { projectId: "P_PROD", kind: "production", environment: { name: "production" } },
          });
          assert.strictEqual(attached.status, 201);
          // The service's repository, and the recipe's production tier built from it, landed by Core.
          yield* call("POST", "/api/mate/repos", { headers: auth, body: { name: "appdev" } });
          const number = yield* propose(call, auth);
          const git = yield* gitClient;
          const group = yield* groupCheckout(git, origin, credential, appId, "group");
          yield* group.write(
            {
              "4 — Small Production/import.yaml": [
                "services:",
                "  - hostname: app",
                "    type: nodejs@22",
                `    buildFromGit: ${origin}/git/${appId}/appdev.git`,
                "    zeropsSetup: app",
                "",
              ].join("\n"),
            },
            "The production's",
          );
          yield* group.push("P_MATE", number);
          yield* stateBecomes(call, owner, appId, number, "merged");
          const groupHead = yield* group.main;
          const app = (yield* git.checked([
            "ls-remote",
            remoteOf(origin, credential, appId, "appdev"),
            "refs/heads/main",
          ])).split("\t")[0];
          const release = (session: string, body: unknown) =>
            call("POST", `/api/apps/${appId}/releases`, { session, body });
          const answer = (asked: Effect.Success<ReturnType<typeof release>>) => [
            asked.status,
            asked.body,
          ];

          const made = yield* release(owner, {
            tag: "v0.1.0",
            groupHead,
            entries: [{ service: "app", sha: app }],
          });
          assert.strictEqual(made.status, 201);
          const { deploys, ...madeRelease } = made.body as Record<string, unknown> & {
            readonly deploys: { readonly jobs: ReadonlyArray<Record<string, unknown>> };
          };
          assert.deepStrictEqual(
            { ...madeRelease, at: "at" },
            {
              tag: "v0.1.0",
              sha: groupHead,
              entries: [{ service: "app", sha: app }],
              by: "owner",
              at: "at",
              state: "approved",
              reason: null,
              rollbackOf: null,
            },
          );
          // The release answers where production's deploy of it stands: appdev's commit carries no
          // zerops.yaml here, so HQ skips it, saying why.
          assert.deepStrictEqual(
            deploys.jobs.map(({ environment, service, state, reason }) => [
              environment,
              service,
              state,
              reason,
            ]),
            [["production", "app", "skipped", `appdev has no zerops.yaml at ${app?.slice(0, 7)}`]],
          );
          const back = yield* call("POST", `/api/apps/${appId}/releases/v0.1.0/rollback`, {
            session: owner,
            body: { groupHead },
          });
          assert.deepStrictEqual(
            [back.status, (back.body as { readonly tag: string; readonly rollbackOf: string }).tag],
            [201, "v0.1.1"],
          );
          const listed = yield* call("GET", `/api/apps/${appId}/releases`, { session: owner });
          assert.deepStrictEqual(
            (
              listed.body as { readonly releases: ReadonlyArray<{ readonly tag: string }> }
            ).releases.map((listedRelease) => listedRelease.tag),
            ["v0.1.1", "v0.1.0"],
          );

          // What each refusal answers, as the wire says.
          const again = { tag: "v0.1.1", groupHead, entries: [{ service: "app", sha: app }] };
          const reader = yield* sessionFor(call, "door-reader");
          const dev = yield* sessionFor(call, "door-dev");
          assert.deepStrictEqual(answer(yield* release(owner, again)), [
            409,
            { code: "conflict", reason: "tag_taken" },
          ]);
          assert.deepStrictEqual(answer(yield* release(reader, { ...again, tag: "v0.2.0" })), [
            403,
            { code: "forbidden", reason: "not_releaser" },
          ]);
          assert.deepStrictEqual(answer(yield* release(dev, { ...again, tag: "v0.2.0" })), [
            403,
            { code: "forbidden", reason: "app_not_seen" },
          ]);
          assert.deepStrictEqual(
            answer(yield* release(owner, { ...again, tag: "v0.2.0", entries: [] })),
            [400, { code: "invalid" }],
          );
          assert.deepStrictEqual(
            answer(
              yield* call("POST", `/api/apps/${appId}/releases/v0.0.9/rollback`, {
                session: owner,
                body: { groupHead },
              }),
            ),
            [404, { code: "release_not_found", reason: "release_not_found" }],
          );
          assert.deepStrictEqual(
            answer(yield* call("GET", `/api/apps/${appId}/releases`, { session: dev })),
            [403, { code: "forbidden", reason: "app_not_seen" }],
          );
        }),
    );

    // F22 (2026-10-03): a release whose client gave up at 20 s. A release, its rollback and a
    // redeploy answer once they submitted what they could — never waiting for a build to end.
    it.effect(
      "answers a release, a rollback and a redeploy within 5 s while production's build runs",
      () =>
        Effect.gen(function* () {
          const { fake, url, app, groupHead, timed, tags } = yield* productionApp;
          // Production's builds never end here.
          fake.outcome = () => "BUILDING";

          const first = yield* timed("/releases", {
            tag: "v0.1.0",
            groupHead,
            entries: [{ service: "app", sha: app }],
          });
          // Submitted before it answers: production's app building.
          assert.deepStrictEqual(
            [first, yield* tags],
            [{ status: 201, inTime: true, deploys: ["building"] }, ["v0.1.0"]],
          );
          yield* Effect.sync(() => fake.calls.includes("buildAndDeploy:key-prod")).pipe(
            Effect.filterOrFail((building) => building),
            Effect.retry(Schedule.spaced(Duration.millis(20))),
            Effect.timeout(Duration.seconds(10)),
          );
          // A failed deploy of production's, for a person's "Run again".
          const failed = "a".repeat(40);
          yield* rowsWhere(
            url,
            `INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state,
               reason, ended_at)
             SELECT id, 'deploy', 'P_PROD', 'app', 'appdev', '${failed}', 'failed',
               'failed: Build failed', now()
             FROM hq_rollout ORDER BY id LIMIT 1
             RETURNING 1`,
            (rows) => rows.length === 1,
          );
          assert.deepStrictEqual(
            [
              yield* timed("/releases", {
                tag: "v0.2.0",
                groupHead,
                entries: [{ service: "app", sha: app }],
              }),
              yield* timed("/releases/v0.1.0/rollback", { groupHead }),
              yield* timed("/environments/production/redeploy", { service: "app", sha: failed }),
              yield* tags,
            ],
            // The release and the rollback list the commit already building: skipped, saying so;
            // the failed commit, asked again, waits behind the build — one at a time.
            [
              { status: 201, inTime: true, deploys: ["skipped"] },
              { status: 201, inTime: true, deploys: ["skipped"] },
              { status: 200, inTime: true, deploys: ["queued"] },
              ["v0.2.1", "v0.2.0", "v0.1.0"],
            ],
          );
        }),
      { timeout: 60_000 },
    );

    // F22, option A (2026-10-03): while Zerops left KRLS's member list unanswered for minutes,
    // every read past the view's 30 s waited until the read failed — 44 s in HQ's log. A read
    // waits on Zerops 3 s, then is served the last view Zerops answered within five minutes.
    it.effect(
      "lists an application's releases within 5 s while Zerops's member list stalls, over a view read within the last five minutes",
      () =>
        Effect.gen(function* () {
          const { fake, tags } = yield* productionApp;
          fake.membersTake = 40_000;
          // Past the view's 200 ms here: the last one Zerops answered is all there is.
          yield* Effect.sleep(Duration.millis(500));
          const [took, listed] = yield* Effect.timed(tags);
          assert.deepStrictEqual([listed, Duration.toMillis(took) < 5000], [[], true]);
        }),
      { timeout: 60_000 },
    );

    // F22 (2026-10-03): while Zerops left KRLS's member list unanswered for minutes, a release
    // waited on it for its client's whole 20 s. The owner, 2026-10-05: a release cannot be taken
    // back, so it is decided over roles Zerops answers for it — a slow answer still decides it, none
    // refuses it at once, and nothing is released over a view kept from before.
    it.effect(
      "releases over roles Zerops answers slowly, and refuses one it does not answer at all",
      () =>
        Effect.gen(function* () {
          const { fake, app, groupHead, timed, tags } = yield* productionApp;
          // Past the view's 200 ms here: every release reads the org again.
          yield* Effect.sleep(Duration.millis(500));
          fake.unanswered.add("members");
          const refused = yield* timed("/releases", {
            tag: "v0.1.0",
            groupHead,
            entries: [{ service: "app", sha: app }],
          });
          fake.unanswered.delete("members");
          assert.deepStrictEqual([refused.status, refused.inTime, yield* tags], [503, true, []]);
          fake.membersTake = 2000;
          yield* Effect.sleep(Duration.millis(500));
          const { status, deploys } = yield* timed("/releases", {
            tag: "v0.1.0",
            groupHead,
            entries: [{ service: "app", sha: app }],
          });
          assert.deepStrictEqual([status, deploys], [201, ["building"]]);
        }),
      { timeout: 60_000 },
    );
  });
});
