// @effect-diagnostics nodeBuiltinImport:off -- each test's git root is a temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Logger from "effect/Logger";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import type { OperationSignal } from "./operationWatch.ts";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import { HqDeployAnswer as DeployAnswerSchema } from "@t3tools/shared/hqDeploys";
import * as Schedule from "effect/Schedule";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { fakeOperationWatch } from "../test/harness/operationWatch.ts";
import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { OTHER_KEY_SECRET, sealedFor, testKey } from "../test/harness/deployKeys.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import {
  type FakeService,
  type FakeWorld,
  emptyWorld,
  fakeZeropsApi,
  fakeZeropsDeploy,
} from "../test/harness/zeropsFake.ts";
import { type KeySecret, deployKeysLayer, keySecretOf } from "./deployKeys.ts";
import type { HqDeployAnswer } from "@t3tools/shared/hqDeploys";

import { Deploys, type DeploysOptions, deploysLayer } from "./deploys.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { treeMigrations } from "./migrationFiles.ts";
import { migrate } from "./migrations.ts";
import { RecipeTiers } from "./recipeTiers.ts";
import { Releases, releasesLayer } from "./releases.ts";
import { Roles } from "./roles.ts";
import { environmentBirths } from "./births.ts";
import { type RolloutCause, Rollouts, addRollout, rolloutsLayer } from "./rollouts.ts";
import { ZeropsApi, ZeropsDeploy, ZeropsRefused, type ZeropsMember } from "./zerops/api.ts";

const decodeDeployAnswer = Schema.decodeUnknownEffect(DeployAnswerSchema);

const AUTHOR = { name: "Ada", email: "ada@mate.test" };
/** A `zerops.yaml` carrying `setup`. */
const zeropsYaml = (setup: string) =>
  `zerops:\n  - setup: ${setup}\n    run:\n      start: node index.js\n`;
const ZEROPS_YAML = zeropsYaml("web");
const FAST: DeploysOptions = {};
const ABSENT: RecipeTierResponse = { state: "absent" };

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
 * The org as HQ reads it: its owner; dev, who develops Shop (Basic user on its stage's project)
 * and may release it (Basic user on its production's); viewer, who sees it through a Read only
 * grant; stranger, who has nothing there.
 */
const ORG_VIEW = {
  orgId: "ORG",
  members: [
    member("owner", "OWNER"),
    member("dev", "NO_ACCESS"),
    member("viewer", "NO_ACCESS"),
    member("stranger", "NO_ACCESS"),
  ],
  projects: [
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
    {
      id: "P_PROD",
      orgId: "ORG",
      name: "Shop - production",
      status: "ACTIVE",
      tags: [],
      userRoles: [{ clientUserId: "C-dev", roleCode: "BASIC_USER" }],
      publicZone: "pprod.prg1-zerops.zone",
    },
  ],
};

/** A stage tier whose runtimes are `services`, each built from the application's repository of its name. */
const stageTier = (
  appId: string,
  services: ReadonlyArray<{ readonly hostname: string; readonly priority?: number }>,
): RecipeTierResponse => ({
  state: "present",
  mainHead: "0".repeat(40),
  importYaml: [
    "services:",
    ...services.flatMap(({ hostname, priority }) => [
      `  - hostname: ${hostname}`,
      "    type: nodejs@22",
      `    buildFromGit: https://hq.example.test/git/${appId}/${hostname}.git`,
      `    zeropsSetup: ${hostname}`,
      ...(priority === undefined ? [] : [`    priority: ${String(priority)}`]),
    ]),
    "",
  ].join("\n"),
});

/** A stage tier written out, its services' lines as given. */
const tierOf = (...lines: ReadonlyArray<string>): RecipeTierResponse => ({
  state: "present",
  mainHead: "0".repeat(40),
  importYaml: ["services:", ...lines, ""].join("\n"),
});

/** A runtime of the application `appId`, built from its repository of the same name. */
const runtime = (appId: string, hostname: string, ...extra: ReadonlyArray<string>) => [
  `  - hostname: ${hostname}`,
  "    type: nodejs@22",
  `    buildFromGit: https://hq.example.test/git/${appId}/${hostname}.git`,
  `    zeropsSetup: ${hostname}`,
  ...extra,
];

const fakeService = (name: string, over: Partial<FakeService> = {}): FakeService => ({
  id: `S-${name}`,
  projectId: "P_STAGE",
  name,
  status: "ACTIVE",
  isSystem: false,
  subdomainAccess: false,
  http: true,
  named: { id: `V0-${name}`, name: "" },
  activeVersionId: `V0-${name}`,
  ...over,
});

/** `value`, kept as the deploy token of `projectId`'s environment, sealed under the test key. */
const keepToken = (projectId: string, value: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { keyId, sealed } = sealedFor(projectId, value);
    yield* sql`
      INSERT INTO hq_deploy_token (project_id, key_id, sealed, kept_by)
      VALUES (${projectId}, ${keyId}, ${sealed}, 'owner')`;
  }).pipe(Effect.orDie);

/** A commit's files: content, or null to delete one. */
type Files = Readonly<Record<string, string | null>>;

/** A deploy job as the tests read it. */
interface JobRow {
  readonly project: string;
  readonly service: string;
  readonly sha: string;
  readonly state: string;
  readonly reason: string | null;
  readonly requested_by: string | null;
}

interface Rig {
  readonly appId: string;
  readonly world: FakeWorld;
  /** Each application's tiers, by `<appId>/<tier>`. */
  readonly tiers: Map<string, RecipeTierResponse>;
  /**
   * Commits `files` (null deletes one) to `main` of `repo`, made with its first commit; the new head, once HQ has
   * recorded main moving.
   */
  readonly commit: (repo: string, files: Files) => Effect.Effect<string>;
  /** The deploy jobs HQ records, oldest first. */
  readonly deploys: Effect.Effect<ReadonlyArray<JobRow>>;
  /** Waits until the jobs satisfy `found`. */
  readonly until: (found: (deploys: ReadonlyArray<JobRow>) => boolean) => Effect.Effect<void>;
  /** An event's rollout, written as its writer writes it, and the leading Core woken. */
  readonly ask: (event: RolloutCause) => Effect.Effect<void>;
  /** An event's rollout, written as its writer writes it, and run as its request runs it. */
  readonly request: (event: RolloutCause) => Effect.Effect<HqDeployAnswer>;
  /** Waits until every rollout is planned. */
  readonly planned: Effect.Effect<void>;
  readonly drained: Effect.Effect<void>;
  readonly again: (userId: string, sha: string) => Effect.Effect<HqDeployAnswer>;
  /**
   * The Core stopped, `meanwhile` done while none leads, and another leading over the same
   * database, git and Zerops.
   */
  readonly takeover: (meanwhile?: Effect.Effect<void>) => Effect.Effect<void>;
}

type RigServices = Deploys | Releases | Rollouts | SqlClient.SqlClient;

/**
 * The deploy engine leading over a fresh database and git root: the application Shop with the
 * stage environment `shop-stage` (project P_STAGE, its deploy token kept), a Zerops whose P_STAGE
 * has the service `web`, and Shop's stage tier as `tiers` holds it. HQ's key is the test key, the
 * token's too, unless `keySecret` gives HQ another.
 */
const withDeploys = <A, E>(
  use: (rig: Rig) => Effect.Effect<A, E, RigServices>,
  options: DeploysOptions = FAST,
  keySecret: KeySecret = testKey(),
) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-deploys-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const world = emptyWorld();
    const tiers = new Map<string, RecipeTierResponse>();
    const layer = deploysLayer({
      ...options,
      observer: options.observer ?? fakeOperationWatch(world),
    }).pipe(
      Layer.provideMerge(releasesLayer),
      Layer.provide(deployKeysLayer(keySecret)),
      Layer.provideMerge(gitHostLayer({ rootDir: root })),
      Layer.provideMerge(rolloutsLayer),
      Layer.provideMerge(activeCoreLayer(url)),
      Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(world))),
      Layer.provide(Layer.succeed(ZeropsDeploy, fakeZeropsDeploy(world))),
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
          read: (appId, tier) => Effect.succeed(tiers.get(`${appId}/${tier}`) ?? ABSENT),
        }),
      ),
    );
    /** A Core over the test's database, git and Zerops, for as long as its scope. */
    const start = Effect.gen(function* () {
      const scope = yield* Scope.make();
      const context = yield* Layer.buildWithScope(layer, scope);
      yield* untilActive.pipe(Effect.provide(context));
      return { context, scope };
    });
    let core = yield* start;
    yield* Effect.addFinalizer(() => Scope.close(core.scope, Exit.void));
    // The test's own pool, which outlives every Core.
    const testSql = yield* Layer.build(PgClient.layer({ url: Redacted.make(url) }));
    const sql = Context.get(testSql, SqlClient.SqlClient);
    const gitOf = (context: typeof core.context) =>
      Context.get(context, GitHost).git.pipe(
        Effect.retry(Schedule.spaced(Duration.millis(50))),
        Effect.timeout(Duration.seconds(10)),
      );
    let git = yield* gitOf(core.context);
    const [app] = yield* sql<{ readonly id: string }>`
      INSERT INTO hq_app (name, created_by) VALUES ('Shop', 'owner') RETURNING id::text AS id`;
    const appId = app!.id;
    yield* sql`
      INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
      VALUES ('P_STAGE', ${appId}::uuid, 'stage', 'owner')`;
    yield* sql`
      INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by)
      VALUES ('P_STAGE', ${appId}::uuid, 'stage', 'shop-stage', '{main}', 'owner')`;
    yield* keepToken("P_STAGE", "key-stage").pipe(Effect.provideService(SqlClient.SqlClient, sql));
    world.projects.push({
      id: "P_STAGE",
      orgId: "ORG",
      name: "Shop - stage",
      status: "ACTIVE",
      tags: [],
      userRoles: [],
      publicZone: "pstage.prg1-zerops.zone",
    });
    world.services.push(fakeService("web"));
    world.tokens.set("key-stage", {
      id: "T_STAGE",
      name: "deploy-shop-stage",
      orgId: "ORG",
      roleCode: "NO_ACCESS",
      canCreateProjects: false,
      canViewFinances: false,
      canEditFinances: false,
      projects: [{ projectId: "P_STAGE", roleCode: "BASIC_USER" }],
      createdMs: 0,
      createdByUser: "owner",
    });

    const heads = new Map<string, string>();
    const commit = (repo: string, files: Files) =>
      Effect.gen(function* () {
        const at = { appId, id: repo };
        if (!heads.has(repo)) {
          yield* sql`
            INSERT INTO hq_repo (app_id, name, created_by) VALUES (${appId}::uuid, ${repo}, 'owner')`;
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
        // Once HQ has recorded main moving.
        yield* sql`
          SELECT 1 FROM hq_repo
          WHERE app_id::text = ${appId} AND name = ${repo} AND main_head = ${sha}`.pipe(
          Effect.filterOrFail(
            (rows) => rows.length === 1,
            () => "not yet",
          ),
          Effect.retry(Schedule.spaced(Duration.millis(10))),
          Effect.timeout(Duration.seconds(10)),
        );
        return sha;
      }).pipe(Effect.orDie);
    const deploys = sql<JobRow>`
      SELECT project_id AS project, service, sha, state, reason, requested_by
      FROM hq_deploy_job WHERE kind = 'deploy' ORDER BY id`.pipe(Effect.orDie);
    const until = (found: (rows: ReadonlyArray<JobRow>) => boolean) =>
      deploys.pipe(
        Effect.filterOrFail(found, () => "not yet"),
        Effect.retry(Schedule.spaced(Duration.millis(20))),
        Effect.timeout(Duration.seconds(10)),
        Effect.asVoid,
        Effect.orDie,
      );
    const ask = (event: RolloutCause) =>
      Effect.gen(function* () {
        yield* addRollout(sql, event);
        yield* Context.get(core.context, Rollouts).wake;
      }).pipe(Effect.orDie);
    const request = (event: RolloutCause) =>
      Effect.gen(function* () {
        yield* addRollout(sql, event);
        return yield* Context.get(core.context, Deploys).runOf(event);
      }).pipe(Effect.orDie);
    const planned = sql`SELECT 1 FROM hq_rollout WHERE planned_at IS NULL`.pipe(
      Effect.filterOrFail(
        (rows) => rows.length === 0,
        () => "not yet",
      ),
      Effect.retry(Schedule.spaced(Duration.millis(20))),
      Effect.timeout(Duration.seconds(10)),
      Effect.asVoid,
      Effect.orDie,
    );
    const takeover = (meanwhile: Effect.Effect<void> = Effect.void) =>
      Effect.gen(function* () {
        yield* Scope.close(core.scope, Exit.void);
        yield* meanwhile;
        core = yield* start;
        git = yield* gitOf(core.context);
      }).pipe(Effect.orDie);
    return yield* use({
      appId,
      world,
      tiers,
      commit,
      deploys,
      until,
      ask,
      request,
      planned,
      drained: Effect.suspend(() => Context.get(core.context, Deploys).drain).pipe(
        Effect.timeout("10 seconds"),
        Effect.orDie,
      ),
      again: (userId, sha) =>
        Context.get(core.context, Deploys)
          .redeploy(userId, appId, "shop-stage", "web", sha)
          .pipe(Effect.orDie),
      takeover,
    }).pipe(Effect.provide(Context.merge(core.context, testSql)));
  });

/** The environment of `projectId` attached as created for HQ to deploy (audit R1, D6). */
const createdForHq = (projectId: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`INSERT INTO hq_subdomain_intent (project_id) VALUES (${projectId})`;
  }).pipe(Effect.orDie);

/** Every job not superseded is `state`, and there is one. */
const settled = (state: string) => (rows: ReadonlyArray<{ readonly state: string }>) => {
  const standing = rows.filter((row) => row.state !== "superseded");
  return standing.length > 0 && standing.every((row) => row.state === state);
};

/** The names of every version Zerops was asked to make, in order. */
const versions = (world: FakeWorld) =>
  [...world.appVersions.values()].map((version) => version.name);

/**
 * Shop's production environment `shop-production` (project P_PROD, its deploy token kept, its
 * service `web`), following its releases.
 */
const withProduction = (appId: string, world: FakeWorld) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
      VALUES ('P_PROD', ${appId}::uuid, 'production', 'owner')`;
    yield* sql`
      INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by)
      VALUES ('P_PROD', ${appId}::uuid, 'production', 'shop-production', '{release}', 'owner')`;
    yield* keepToken("P_PROD", "key-prod");
    world.projects.push({
      id: "P_PROD",
      orgId: "ORG",
      name: "Shop - production",
      status: "ACTIVE",
      tags: [],
      userRoles: [],
      publicZone: "pprod.prg1-zerops.zone",
    });
    world.services.push(fakeService("web", { id: "S-web-prod", projectId: "P_PROD" }));
    world.tokens.set("key-prod", {
      id: "T_PROD",
      name: "deploy-shop-production",
      orgId: "ORG",
      roleCode: "NO_ACCESS",
      canCreateProjects: false,
      canViewFinances: false,
      canEditFinances: false,
      projects: [{ projectId: "P_PROD", roleCode: "BASIC_USER" }],
      createdMs: 0,
      createdByUser: "owner",
    });
  }).pipe(Effect.orDie);

/** Production's `web`, as the fake Zerops holds it. */
const prodService = (world: FakeWorld) =>
  world.services.find((service) => service.id === "S-web-prod");

/** A person's Run again of `service` at `sha` in the stage, answered "ok" or the refusal's reason. */
const runAgain = (
  appId: string,
  userId: string,
  sha: string,
  service = "web",
  name = "shop-stage",
) =>
  Effect.gen(function* () {
    const deploys = yield* Deploys;
    return yield* deploys.redeploy(userId, appId, name, service, sha).pipe(
      Effect.match({
        onSuccess: () => "ok",
        onFailure: (error) => ("reason" in error ? String(error.reason) : error._tag),
      }),
    );
  });

describe("deploys", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    // SPEC §3.2b, main B10/B15/B16/B17: main moving deploys the exact commit's archive to every stage
    // environment following main, with the tier's setup, named `main <7 hex>`; live once the
    // service runs it.
    it.effect("deploys the commit main moved to, and calls it live once the service runs it", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          const first = yield* commit("web", {
            "zerops.yaml": ZEROPS_YAML,
            "index.js": "console.log('one')\n",
          });
          yield* until(settled("live"));
          const version = [...world.appVersions.values()][0];
          assert.deepStrictEqual(
            [version?.name, version?.setup, version?.zeropsYaml],
            [`main ${first.slice(0, 7)}`, "web", ZEROPS_YAML],
          );
          // The commit's tree as git archives it: a gzip whose tar holds the commit's files.
          const tar = NodeZlib.gunzipSync(version?.archive ?? new Uint8Array()).toString("latin1");
          assert.include(tar, "index.js");
          assert.include(tar, "console.log('one')");

          const second = yield* commit("web", { "index.js": "console.log('two')\n" });
          yield* until((rows) => rows.some((row) => row.sha === second && row.state === "live"));
          assert.deepStrictEqual(
            (yield* deploys).map(({ sha, state }) => [sha, state]),
            [
              [first, "live"],
              [second, "live"],
            ],
          );
          assert.strictEqual(
            world.services[0]?.activeVersionId,
            [...world.appVersions.values()][1]?.id,
          );
        }),
      ),
    );

    // The deploy-jobs design: the request that asked submits what it can before it answers — one
    // build at a time per environment, so the next service waits, queued behind it — and answers
    // where each job stands.
    it.effect(
      "answers its request with each job building, or queued behind the one that builds",
      () =>
        withDeploys(({ appId, world, tiers, commit, planned, request, until }) =>
          Effect.gen(function* () {
            world.services.push(fakeService("api"));
            const web = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            const api = yield* commit("api", { "zerops.yaml": zeropsYaml("api") });
            yield* planned;
            tiers.set(
              `${appId}/stage`,
              stageTier(appId, [{ hostname: "web" }, { hostname: "api", priority: 5 }]),
            );
            world.outcome = () => "BUILDING";
            const answer = yield* request({ cause: "key_kept", projectId: "P_STAGE", by: "owner" });
            const [first, second] = answer.jobs;
            assert.deepStrictEqual(
              answer.jobs.map(({ environment, service, sha, state }) => [
                environment,
                service,
                sha,
                state,
              ]),
              [
                ["shop-stage", "api", api, "building"],
                ["shop-stage", "web", web, "queued"],
              ],
            );
            assert.match(first?.processId ?? "", /^process-/u);
            assert.strictEqual(second?.behind, first?.job);
            assert.lengthOf(versions(world), 1);
            world.outcome = () => "ACTIVE";
            yield* until((rows) => rows.length === 2 && settled("live")(rows));
          }),
        ),
    );

    // A person's merge writes its rollout in its own write, before git's report of main moving is
    // recorded: its request deploys the merged commit, whatever `main` HQ last recorded.
    it.effect("deploys the commit its merge names, before HQ records main moving to it", () =>
      withDeploys(({ appId, tiers, commit, until, request }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          const before = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("live"));
          const merged = yield* commit("web", { "zerops.yaml": ZEROPS_YAML, "a.txt": "a\n" });
          yield* until((rows) => rows.some((row) => row.sha === merged && row.state === "live"));
          // As the merge's request meets it: its rollout written, main not yet recorded as moved.
          yield* sql`DELETE FROM hq_deploy_job WHERE sha = ${merged}`;
          yield* sql`DELETE FROM hq_rollout WHERE sha = ${merged}`;
          yield* sql`UPDATE hq_repo SET main_head = ${before} WHERE name = 'web'`;
          const answer = yield* request({ cause: "merge", appId, repo: "web", sha: merged });
          assert.deepStrictEqual(
            answer.jobs.map(({ service, sha, job }) => [service, sha, job === null]),
            [["web", merged, false]],
          );
        }),
      ),
    );

    // The structure's readers hear of every change of a job (`stream.ts`).
    it.effect("ticks as a deploy job changes", () =>
      withDeploys(({ appId, tiers, commit, until }) =>
        Effect.gen(function* () {
          const heard = yield* Stream.runCollect(
            (yield* Deploys).changes.pipe(Stream.take(3)),
          ).pipe(Effect.forkChild);
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("live"));
          assert.lengthOf(yield* Fiber.join(heard), 3);
        }),
      ),
    );

    // The deploy-jobs design: nothing asks for a deploy but an event — main moving with no stage
    // tier to read asks for nothing, and no timer asks later; a key kept asks for what the
    // environment is wanted at, its services one after another, higher priority first (B19).
    it.effect("deploys an environment's services in the tier's priority order, on an event", () =>
      withDeploys(({ appId, world, tiers, commit, until, ask, planned, deploys, drained }) =>
        Effect.gen(function* () {
          world.services.push(fakeService("api"));
          const web = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          const api = yield* commit("api", { "zerops.yaml": zeropsYaml("api") });
          yield* planned;
          tiers.set(
            `${appId}/stage`,
            stageTier(appId, [{ hostname: "web" }, { hostname: "api", priority: 5 }]),
          );
          yield* drained;
          assert.deepStrictEqual(yield* deploys, []);
          yield* ask({ cause: "key_kept", projectId: "P_STAGE", by: "owner" });
          yield* until((rows) => rows.length === 2 && settled("live")(rows));
          assert.deepStrictEqual(versions(world), [
            `main ${api.slice(0, 7)}`,
            `main ${web.slice(0, 7)}`,
          ]);
        }),
      ),
    );

    // Main E08: without the environment's key HQ deploys nothing, saying so in main's words — a
    // person's to mend, so the job ends refused at once; keeping a key asks again.
    it.effect(
      "refuses a deploy without the environment's key, in main's words, and deploys once one is kept",
      () =>
        withDeploys(({ appId, world, tiers, commit, deploys, until, ask }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`DELETE FROM hq_deploy_token`;
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("refused"));
            assert.deepStrictEqual(
              (yield* deploys).map(({ state, reason }) => [state, reason]),
              [
                [
                  "refused",
                  "shop-stage has no deploy token yet; an admin who opens the projects page in Zerops Mate mints it",
                ],
              ],
            );
            assert.deepStrictEqual(versions(world), []);
            yield* keepToken("P_STAGE", "key-stage");
            yield* ask({ cause: "key_kept", projectId: "P_STAGE", by: "owner" });
            yield* until((rows) => rows.at(-1)?.state === "live");
          }),
        ),
    );

    // Review #1: the client attaches an environment first and keeps its deploy token after, so the
    // birth's first job is refused for want of a key. The birth follows it to the deploy the kept
    // key asks for, and ends only once that one ran; a Run again after is no birth's.
    it.effect(
      "an environment's birth runs from its attach to the first deploy the kept key makes",
      () =>
        withDeploys(({ appId, tiers, commit, until, ask }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`DELETE FROM hq_deploy_token`;
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("refused"));
            yield* sql`DELETE FROM hq_deploy_job`;
            yield* sql`DELETE FROM hq_rollout`;
            const birth = Effect.map(environmentBirths(sql), (births) => births.get("P_STAGE"));
            // Attached: its rollout refused for want of a key — still coming up, awaiting one.
            yield* ask({ cause: "env_added", projectId: "P_STAGE", by: "owner" });
            yield* until(settled("refused"));
            assert.deepStrictEqual(yield* birth, { ended: false });
            // The key kept: its rollout deploys, and the birth runs until that deploy is live.
            yield* keepToken("P_STAGE", "key-stage");
            yield* ask({ cause: "key_kept", projectId: "P_STAGE", by: "owner" });
            yield* until((rows) => rows.at(-1)?.state === "live");
            assert.deepStrictEqual(yield* birth, { ended: true });
            // A Run again after its first deploy is no birth's.
            yield* sql`
            INSERT INTO hq_rollout (app_id, cause, project_id, by)
            VALUES (${appId}::uuid, 'run_again', 'P_STAGE', 'dev')`;
            assert.deepStrictEqual(yield* birth, { ended: true });
          }),
        ),
    );

    it.effect.each<[string, (sql: SqlClient.SqlClient) => Effect.Effect<void>]>([
      ["a key held, its first job refused: ended", () => Effect.void],
      [
        "no key held, its first job refused: awaiting one",
        (sql) => sql`DELETE FROM hq_deploy_token`.pipe(Effect.asVoid, Effect.orDie),
      ],
      [
        "a key that no longer works: awaiting a new one",
        (sql) =>
          sql`UPDATE hq_deploy_token SET invalid_since = now()`.pipe(Effect.asVoid, Effect.orDie),
      ],
    ])("an environment's birth whose first job HQ refused, %s", ([name, keyed]) =>
      withDeploys(({ appId }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* keyed(sql);
          const [rollout] = yield* sql<{ readonly id: string }>`
            INSERT INTO hq_rollout (app_id, cause, project_id, planned_at)
            VALUES (${appId}::uuid, 'env_added', 'P_STAGE', now())
            RETURNING id::text AS id`;
          yield* sql`
            INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state,
              reason, ended_at)
            VALUES (${rollout!.id}::bigint, 'deploy', 'P_STAGE', 'web', 'web', ${"6".repeat(40)},
              'refused', 'Zerops did not answer', now())`;
          const births = yield* environmentBirths(sql);
          assert.deepStrictEqual(births.get("P_STAGE"), { ended: name.endsWith("ended") });
        }),
      ),
    );

    // Without HQ's key no deploy token opens (`deployKeys.ts`): every deploy is refused, saying so,
    // and no key is marked — an admin minting a new one would not help.
    it.effect.each<[string, string | undefined]>([
      ["no key", undefined],
      ["a key that is no key", "not-a-key"],
    ])("refuses every deploy while HQ has %s, marking no environment's key", ([, raw]) =>
      withDeploys(
        ({ appId, world, tiers, commit, deploys, until }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("refused"));
            assert.deepStrictEqual(
              (yield* deploys).map(({ reason }) => reason),
              ["HQ cannot open shop-stage's deploy token: HQ_KEY_SECRET is not set to a key"],
            );
            assert.deepStrictEqual(versions(world), []);
            const [token] = yield* sql<{ readonly invalid: boolean }>`
              SELECT invalid_since IS NOT NULL AS invalid FROM hq_deploy_token`;
            assert.isFalse(token?.invalid);
          }),
        FAST,
        keySecretOf(raw === undefined ? Option.none() : Option.some(Redacted.make(raw))),
      ),
    );

    // A token that does not open under HQ's key — sealed under another, as after a restore onto an
    // HQ with another key, or copied from another environment's row — is HQ's own state: refused,
    // saying so, and not marked.
    it.effect.each<[string, string, string | undefined]>([
      ["sealed under another key", "P_STAGE", OTHER_KEY_SECRET],
      ["sealed for another environment", "P_PROD", undefined],
    ])("refuses a deploy whose key does not open under HQ's: %s", ([, projectId, raw]) =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const elsewhere = sealedFor(projectId, "key-stage", raw);
          yield* sql`
            UPDATE hq_deploy_token SET key_id = ${elsewhere.keyId}, sealed = ${elsewhere.sealed}`;
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("refused"));
          assert.deepStrictEqual(
            (yield* deploys).map(({ reason }) => reason),
            [
              "shop-stage's deploy token does not open with HQ's key: HQ deploys again once HQ_KEY_SECRET is the key it was sealed under, or once an admin who opens the projects page in Zerops Mate mints a new one",
            ],
          );
          assert.deepStrictEqual(versions(world), []);
          const [token] = yield* sql<{ readonly invalid: boolean }>`
            SELECT invalid_since IS NOT NULL AS invalid FROM hq_deploy_token`;
          assert.isFalse(token?.invalid);
        }),
      ),
    );

    // A key is checked as every job runs: one that now reaches more than its project, or no longer
    // answers, is no key — the job is refused in main's words (E08), never attempted; a person asks
    // again once it is mended.
    it.effect("refuses a deploy with a key that now reaches more, or no longer answers", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const kept = world.tokens.get("key-stage")!;
          const invalid = Effect.map(
            sql<{ readonly invalid: boolean }>`
              SELECT invalid_since IS NOT NULL AS invalid FROM hq_deploy_token`,
            (rows) => rows[0]?.invalid,
          );
          const refusedWith = (reason: string) => (rows: ReadonlyArray<JobRow>) =>
            rows.at(-1)?.state === "refused" && rows.at(-1)?.reason === reason;
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          // Widened past its project (the platform lets a token raise its own role).
          world.tokens.set("key-stage", { ...kept, roleCode: "READ_ONLY" });
          const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(
            refusedWith(
              "shop-stage's deploy token reaches more than its project; an admin who opens the projects page in Zerops Mate mints a new one",
            ),
          );
          assert.isTrue(yield* invalid);
          // Dead.
          world.tokens.delete("key-stage");
          assert.strictEqual(yield* runAgain(appId, "dev", sha), "ok");
          yield* until(
            refusedWith(
              "shop-stage's deploy token no longer answers; an admin who opens the projects page in Zerops Mate mints a new one",
            ),
          );
          assert.deepStrictEqual(versions(world), []);
          world.tokens.set("key-stage", kept);
          assert.strictEqual(yield* runAgain(appId, "dev", sha), "ok");
          yield* until((rows) => rows.at(-1)?.state === "live");
          assert.isFalse(yield* invalid);
          assert.lengthOf(yield* deploys, 3);
        }),
      ),
    );

    // The deploy-jobs design: nothing is tried twice — a Zerops that does not answer ends the job
    // refused at once, in HQ's words, for a person's Run again; it says nothing of the key, which
    // stays unmarked.
    it.effect("refuses at once what Zerops did not answer, and never tries it again", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until, drained }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.down = true;
          const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("refused"));
          world.down = false;
          yield* drained;
          const [ended] = yield* deploys;
          assert.lengthOf(yield* deploys, 1);
          assert.match(ended?.reason ?? "", /^Zerops did not answer: /u);
          assert.deepStrictEqual(versions(world), []);
          const [token] = yield* sql<{ readonly invalid: boolean }>`
            SELECT invalid_since IS NOT NULL AS invalid FROM hq_deploy_token`;
          assert.isFalse(token?.invalid);
          assert.strictEqual(yield* runAgain(appId, "dev", sha), "ok");
          yield* until((rows) => rows.at(-1)?.state === "live");
        }),
      ),
    );

    // Main B37: a build's own failure is final — no event but a person's or a release's deploys
    // that commit again; the event's job is skipped, saying so, and a newer commit deploys.
    it.effect(
      "never deploys a commit whose build failed again on an event a person did not make",
      () =>
        withDeploys(({ appId, world, tiers, commit, deploys, until, request }) =>
          Effect.gen(function* () {
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            world.outcome = () => "BUILD_FAILED";
            yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("failed"));
            assert.deepStrictEqual(
              (yield* deploys).map(({ state, reason }) => [state, reason]),
              [["failed", "failed: Build failed: npm run build exited 1"]],
            );
            world.outcome = () => "ACTIVE";
            const answer = yield* request({ cause: "key_kept", projectId: "P_STAGE", by: "owner" });
            assert.deepStrictEqual(
              answer.jobs.map(({ state }) => state),
              ["skipped"],
            );
            assert.match(
              answer.jobs[0]?.reason ?? "",
              /^its deploy failed at \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC; Run again to retry$/u,
            );
            assert.deepStrictEqual(
              (yield* deploys).map(({ state }) => state),
              ["failed", "skipped"],
            );
            assert.lengthOf(versions(world), 1);

            const second = yield* commit("web", { "index.js": "two\n" });
            yield* until((rows) => rows.some((row) => row.sha === second && row.state === "live"));
          }),
        ),
    );

    // The deploy-jobs design: an event creates a job only where none is in flight and HQ did not
    // last make the service run that commit, and its answer says so; a person's Run again makes
    // one whatever stands.
    it.effect("asks for no job an event finds in flight, or running what it asks for", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until, request }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILDING";
          const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("building"));
          const [building] = yield* (yield* SqlClient.SqlClient)<{ readonly id: string }>`
            SELECT id::text AS id FROM hq_deploy_job`;
          const left = (answer: HqDeployAnswer) =>
            answer.jobs.map(({ environment, service, job, state, reason }) => [
              environment,
              service,
              job,
              state,
              reason,
            ]);
          assert.deepStrictEqual(
            left(yield* request({ cause: "key_kept", projectId: "P_STAGE", by: "owner" })),
            [
              [
                "shop-stage",
                "web",
                building?.id ?? null,
                "skipped",
                `a job of ${sha.slice(0, 7)} is under way`,
              ],
            ],
          );
          assert.lengthOf(yield* deploys, 1);
          world.outcome = () => "ACTIVE";
          yield* until(settled("live"));
          assert.deepStrictEqual(
            left(yield* request({ cause: "env_added", projectId: "P_STAGE", by: "owner" })),
            [["shop-stage", "web", null, "skipped", `web already runs ${sha.slice(0, 7)}`]],
          );
          assert.lengthOf(yield* deploys, 1);
          assert.lengthOf(versions(world), 1);
          // A person asks for it again: a job, which finds the service running it, and builds nothing.
          assert.strictEqual(yield* runAgain(appId, "dev", sha), "ok");
          yield* until((rows) => rows.length === 2 && settled("live")(rows));
          assert.deepStrictEqual(
            (yield* deploys).map(({ reason, requested_by }) => [reason, requested_by]),
            [
              [null, null],
              ["web already runs it", "dev"],
            ],
          );
          const operation = (yield* (yield* Deploys).operations(appId)).at(-1)!;
          assert.strictEqual(
            operation.verifiedVersionId,
            world.services.find((service) => service.name === "web")!.activeVersionId,
          );
          assert.lengthOf(versions(world), 1);
        }),
      ),
    );

    // Main B17: the running version is verified separately; a mismatch leaves the operation unresolved.
    it.effect("calls a deploy live only once the service runs that commit", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          // Someone else's version takes the service as the job ends, named as HQ would name a
          // commit: what it runs is that version, whatever HQ's job said of its own (audit N7).
          world.outcome = (version) => {
            const service = world.services.find((candidate) => candidate.id === version.serviceId);
            if (service !== undefined) {
              service.named = { id: "V-other", name: "main 1234567" };
              Object.defineProperty(service, "activeVersionId", {
                get: () => "V-other",
                set: () => {},
                configurable: true,
              });
            }
            return "ACTIVE";
          };
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("unresolved"));
          assert.deepStrictEqual(
            (yield* deploys).map(({ reason }) => reason),
            [
              "The process finished but the expected running version is not verified; a person must inspect the original handle in Zerops",
            ],
          );
        }),
      ),
    );

    // Main B17/E13: an HTTP service created for HQ gets its subdomain after its first verified
    // deploy, with the environment's own key; one serving no HTTP never does.
    it.effect("turns on an HTTP service's subdomain after its deploy, and no other's", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          yield* createdForHq("P_STAGE");
          world.services.push(fakeService("worker", { http: false }));
          tiers.set(
            `${appId}/stage`,
            stageTier(appId, [{ hostname: "web" }, { hostname: "worker" }]),
          );
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* commit("worker", { "zerops.yaml": zeropsYaml("worker") });
          yield* until((rows) => rows.length === 2 && settled("live")(rows));
          assert.deepStrictEqual(
            world.services.map(({ name, subdomainAccess }) => [name, subdomainAccess]),
            [
              ["web", true],
              ["worker", false],
            ],
          );
        }),
      ),
    );

    // Audit R1 (D6): HQ turns a subdomain on only on the first deploy of a service created for it
    // to deploy — by the person's client, which said so as it attached the environment, or by
    // HQ's own recipe delta — and on no later deploy, where a person may have turned it off since.
    it.effect("opens the subdomain on a created service's first deploy, and on no later one", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          yield* createdForHq("P_STAGE");
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until((rows) => rows.length === 1 && settled("live")(rows));
          const web = world.services.find((service) => service.name === "web")!;
          assert.isTrue(web.subdomainAccess);

          web.subdomainAccess = false;
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML, "index.js": "2\n" });
          yield* until((rows) => rows.length === 2 && settled("live")(rows));
          assert.isFalse(web.subdomainAccess);
        }),
      ),
    );

    // The subdomain is the last step of a first deploy HQ makes: followed by its process before the
    // job ends live, and where it does not come on the live job says so in HQ's words.
    it.effect("a subdomain request whose answer is lost ends visibly unresolved", () =>
      withDeploys(({ appId, world, tiers, commit, until, deploys }) =>
        Effect.gen(function* () {
          yield* createdForHq("P_STAGE");
          world.unanswered.add("enableSubdomainAccess");
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until((found) => found.length === 1 && settled("unresolved")(found));
          const [row] = yield* deploys;
          assert.match(
            row?.reason ?? "",
            /^its subdomain (was not turned on|could not be verified): /u,
          );
          assert.isFalse(world.services.find((service) => service.name === "web")!.subdomainAccess);
        }),
      ),
    );

    // Each accepted side effect is followed by its own handle through takeover.
    it.effect("follows a subdomain by its own process after an old build finishes", () =>
      withDeploys(
        ({ appId, world, tiers, commit, deploys, until, takeover }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* createdForHq("P_STAGE");
            world.outcome = () => "BUILDING";
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("building"));
            yield* takeover(
              Effect.gen(function* () {
                // Submitted all but a moment of its bound ago: the build lands at once, and its
                // subdomain comes on three reads later.
                yield* sql`
                  UPDATE hq_deploy_job SET submitted_at = now() - interval '950 milliseconds'`;
                world.outcome = () => "ACTIVE";
                world.subdomainRunningReads = 3;
              }).pipe(Effect.orDie),
            );
            yield* until(settled("live"));
            assert.deepStrictEqual(
              (yield* deploys).map(({ reason }) => reason),
              [null],
            );
          }),
        FAST,
      ),
    );

    it.effect("opens no subdomain on the first deploy of a service not created for HQ", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("live"));
          assert.isFalse(world.services.find((service) => service.name === "web")!.subdomainAccess);
        }),
      ),
    );

    // Audit R1 (D6): a person who turned a service's subdomain off in Zerops keeps it off — a Run
    // again that finds the service running its commit turns nothing on.
    it.effect(
      "turns on no subdomain a person turned off, asked again for a service that runs its commit",
      () =>
        withDeploys(({ appId, world, tiers, commit, until }) =>
          Effect.gen(function* () {
            yield* createdForHq("P_STAGE");
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("live"));
            const web = world.services.find((service) => service.name === "web")!;
            assert.isTrue(web.subdomainAccess);
            web.subdomainAccess = false;
            assert.strictEqual(yield* runAgain(appId, "dev", sha), "ok");
            yield* until((rows) => rows.length === 2 && settled("live")(rows));
            assert.isFalse(web.subdomainAccess);
          }),
        ),
    );

    // Main B20: the newest commit wins — a job still waiting when a newer commit of its service
    // comes is superseded, never deployed; one HQ submitted runs to its own end.
    it.effect("deploys only the newest commit once a running deploy ends", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILDING";
          const first = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("building"));
          const second = yield* commit("web", { "index.js": "two\n" });
          const third = yield* commit("web", { "index.js": "three\n" });
          yield* until((rows) => rows.some((row) => row.sha === third));
          world.outcome = () => "ACTIVE";
          yield* until((rows) => rows.some((row) => row.sha === third && row.state === "live"));
          assert.deepStrictEqual(
            (yield* deploys).map(({ sha, state, reason }) => [sha, state, reason]),
            [
              [first, "live", null],
              [second, "superseded", `superseded by ${third.slice(0, 7)}`],
              [third, "live", null],
            ],
          );
          assert.deepStrictEqual(versions(world), [
            `main ${first.slice(0, 7)}`,
            `main ${third.slice(0, 7)}`,
          ]);
        }),
      ),
    );

    // Main B36/B37: a build's own failure is final, but a person who develops the application asks
    // for it again ("Run again"): that commit is deployed once more, the job saying who asked. One
    // still in flight is asked for by nobody.
    it.effect("deploys again a commit whose build failed, once a developer asks", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILD_FAILED";
          const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("failed"));
          world.outcome = () => "BUILDING";
          assert.deepStrictEqual(
            [
              yield* runAgain(appId, "stranger", sha),
              yield* runAgain(appId, "viewer", sha),
              yield* runAgain(appId, "dev", sha, "web", "production"),
              yield* runAgain(appId, "dev", "f".repeat(40)),
            ],
            ["app_not_seen", "not_app_developer", "environment_not_found", "deploy_not_found"],
          );
          assert.strictEqual(yield* runAgain(appId, "dev", sha), "ok");
          yield* until((rows) => rows.at(-1)?.state === "building");
          assert.strictEqual(yield* runAgain(appId, "dev", sha), "deploy_running");
          world.outcome = () => "ACTIVE";
          yield* until((rows) => rows.at(-1)?.state === "live");
          assert.lengthOf(versions(world), 2);
          assert.deepStrictEqual(
            (yield* deploys).map(({ state, requested_by }) => [state, requested_by]),
            [
              ["failed", null],
              ["live", "dev"],
            ],
          );
        }),
      ),
    );

    // The deploy-jobs design: a service running a version HQ did not make is never overwritten by
    // an event; a developer's Run again of HQ's live commit builds it again.
    it.effect(
      "deploys its live commit again over a version deployed by hand, only once asked",
      () =>
        withDeploys(({ appId, world, tiers, commit, deploys, until, ask, planned }) =>
          Effect.gen(function* () {
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("live"));
            const web = world.services.find((service) => service.id === "S-web")!;
            Object.assign(web, {
              named: { id: "V-hand", name: "hotfix by hand" },
              activeVersionId: "V-hand",
            });
            yield* ask({ cause: "key_kept", projectId: "P_STAGE", by: "owner" });
            yield* planned;
            assert.lengthOf(yield* deploys, 1);
            assert.strictEqual(yield* runAgain(appId, "dev", sha), "ok");
            yield* until((rows) => rows.length === 2 && settled("live")(rows));
            assert.lengthOf(versions(world), 2);
            assert.deepStrictEqual(
              (yield* deploys).map(({ state, reason, requested_by }) => [
                state,
                reason,
                requested_by,
              ]),
              [
                ["live", null, null],
                ["live", null, "dev"],
              ],
            );
          }),
        ),
    );

    // Audit N6: a job is its service's, by the service's id; the hostname only names it. A service
    // deleted and made again under the same hostname runs nothing HQ made: asked again, it builds.
    it.effect(
      "deploys a service made again under its hostname, its predecessor's version not its own",
      () =>
        withDeploys(({ appId, world, tiers, commit, until }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("live"));
            world.services.splice(
              world.services.findIndex((service) => service.id === "S-web"),
              1,
              fakeService("web", { id: "S-web-again" }),
            );
            assert.strictEqual(yield* runAgain(appId, "dev", sha), "ok");
            yield* until((rows) => rows.length === 2 && settled("live")(rows));
            assert.lengthOf(versions(world), 2);
            assert.deepStrictEqual(
              yield* sql<{ readonly service_id: string }>`
                SELECT service_id FROM hq_deploy_job ORDER BY id`,
              [{ service_id: "S-web" }, { service_id: "S-web-again" }],
            );
          }),
        ),
    );

    // Audit N7: what a service runs is HQ's own record of the version it made, never a label: a
    // version somebody named as HQ names a commit runs whatever they deployed.
    it.effect("deploys over a version only named as HQ would name the commit", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          // No key yet: the first job is refused, and the first key asks again.
          yield* sql`DELETE FROM hq_deploy_token WHERE project_id = 'P_STAGE'`;
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("refused"));
          const web = world.services.find((service) => service.id === "S-web")!;
          Object.assign(web, {
            named: { id: "V-by-hand", name: `main ${sha.slice(0, 7)}` },
            activeVersionId: "V-by-hand",
          });
          yield* keepToken("P_STAGE", "key-stage");
          yield* addRollout(sql, { cause: "key_kept", projectId: "P_STAGE", by: "owner" });
          yield* (yield* Rollouts).wake;
          yield* until((rows) => rows.at(-1)?.state === "live");
          assert.deepStrictEqual(versions(world), [`main ${sha.slice(0, 7)}`]);
        }),
      ),
    );

    // A newer commit's deploy stands for its service: an older one is not asked for again.
    it.effect("refuses to ask again for a deploy a newer one superseded", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILD_FAILED";
          const first = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("failed"));
          const second = yield* commit("web", { "index.js": "two\n" });
          yield* until((rows) => rows.some((row) => row.sha === second && row.state === "failed"));
          assert.strictEqual(yield* runAgain(appId, "dev", first), "deploy_superseded");
        }),
      ),
    );

    // Main D15, with what HQ saw of a tier kept in its database: a tier first seen is the one its
    // environments were made from, and imports nothing; a later change merged into the recipe
    // imports into every environment of the tier the services it lacks — a runtime created empty,
    // for HQ deploys it, a managed one as declared — and asks for the runtime's deploy.
    it.effect("imports what a merged tier change adds into its environments, and deploys it", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until, planned }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const digest = Effect.map(
            sql<{ readonly digest: string }>`SELECT digest FROM hq_recipe_seen`,
            (rows) => rows.map((row) => row.digest),
          );
          const deltas = sql<{ readonly state: string; readonly reason: string | null }>`
            SELECT state, reason FROM hq_deploy_job WHERE kind = 'delta' ORDER BY id`;
          tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web")));
          const api = yield* commit("api", { "zerops.yaml": zeropsYaml("api") });
          // First seen: the baseline, imports nothing.
          yield* commit("group", { "README.md": "# Shop\n" });
          yield* planned;
          assert.deepStrictEqual(world.imports, []);
          const first = yield* digest;
          assert.lengthOf(first, 1);

          tiers.set(
            `${appId}/stage`,
            tierOf(
              ...runtime(appId, "web"),
              ...runtime(appId, "api"),
              "  - hostname: cache",
              "    type: valkey@7.2",
              "    mode: NON_HA",
            ),
          );
          yield* commit("group", { "README.md": "# Shop, with a cache\n" });
          yield* until((rows) => rows.some((row) => row.service === "api" && row.state === "live"));
          assert.lengthOf(world.imports, 1);
          const [delta] = world.imports;
          assert.strictEqual(delta?.projectId, "P_STAGE");
          assert.include(delta?.yaml ?? "", "hostname: api");
          assert.include(delta?.yaml ?? "", "startWithoutCode: true");
          assert.notInclude(delta?.yaml ?? "", "buildFromGit");
          assert.include(delta?.yaml ?? "", "hostname: cache");
          assert.notInclude(delta?.yaml ?? "", "hostname: web");
          assert.deepStrictEqual(
            world.services.map((service) => service.name),
            ["web", "api", "cache"],
          );
          assert.deepStrictEqual(yield* deltas, [{ state: "live", reason: "added api, cache" }]);
          assert.deepStrictEqual(
            (yield* deploys).map(({ service, sha, state }) => [service, sha, state]),
            [["api", api, "live"]],
          );
          assert.notDeepEqual(yield* digest, first);
          // Seen: no second import.
          yield* commit("group", { "README.md": "# Shop again\n" });
          yield* planned;
          assert.lengthOf(world.imports, 1);
        }),
      ),
    );

    // The deploy-jobs design: a delta follows its own import's processes to their end, and only
    // then asks for its services' deploys — none refused for a service Zerops was still making.
    describe("a delta's import, followed", () => {
      const deltas = (sql: SqlClient.SqlClient) =>
        sql<{ readonly state: string; readonly reason: string | null }>`
          SELECT state, reason FROM hq_deploy_job WHERE kind = 'delta' ORDER BY id`.pipe(
          Effect.orDie,
        );
      const deltaIs = (sql: SqlClient.SqlClient, state: string) =>
        deltas(sql).pipe(
          Effect.filterOrFail(
            (rows) => rows.at(-1)?.state === state,
            () => "not yet",
          ),
          Effect.retry(Schedule.spaced(Duration.millis(20))),
          Effect.timeout(Duration.seconds(10)),
          Effect.orDie,
        );
      /** Shop's stage tier first seen with `web`, then merged adding `api`. */
      const addApi = ({
        appId,
        tiers,
        commit,
        planned,
      }: Pick<Rig, "appId" | "tiers" | "commit" | "planned">) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web")));
          const api = yield* commit("api", { "zerops.yaml": zeropsYaml("api") });
          yield* commit("group", { "README.md": "# Shop\n" });
          // The tier is read when a rollout is planned: the first must see it before it changes.
          yield* planned;
          tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web"), ...runtime(appId, "api")));
          yield* commit("group", { "README.md": "# Shop, with an api\n" });
          return api;
        });

      it.effect("asks for the services' deploys only once its import ended", () =>
        withDeploys(({ appId, world, tiers, commit, deploys, until, planned }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const followed = yield* Deferred.make<void>();
            let readBefore = false;
            world.importOutcome = () => {
              if (readBefore) Deferred.doneUnsafe(followed, Effect.void);
              readBefore = true;
              return "RUNNING";
            };
            const api = yield* addApi({ appId, tiers, commit, planned });
            yield* deltaIs(sql, "building");
            yield* Deferred.await(followed).pipe(Effect.timeout("5 seconds"), Effect.orDie);
            assert.deepStrictEqual(
              (yield* deploys).filter((row) => row.service === "api"),
              [],
            );
            world.importOutcome = () => "FINISHED";
            yield* until((rows) => rows.some((row) => row.sha === api && row.state === "live"));
            assert.deepStrictEqual(yield* deltas(sql), [{ state: "live", reason: "added api" }]);
          }),
        ),
      );

      it.effect("fails a delta whose import failed, asking for no deploy", () =>
        withDeploys(({ appId, world, tiers, commit, deploys, planned }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            world.importOutcome = () => "FAILED";
            yield* addApi({ appId, tiers, commit, planned });
            yield* deltaIs(sql, "failed");
            assert.deepStrictEqual(yield* deltas(sql), [
              {
                state: "failed",
                reason: "the import of api failed: Import failed: the service could not be created",
              },
            ]);
            assert.deepStrictEqual(
              (yield* deploys).filter((row) => row.service === "api"),
              [],
            );
          }),
        ),
      );

      it.effect("ends a lost import handle as unresolved without submitting again", () =>
        withDeploys(({ appId, world, tiers, commit, planned }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            world.lost.add("importServices");
            yield* addApi({ appId, tiers, commit, planned });
            yield* deltaIs(sql, "unresolved");
            assert.lengthOf(world.imports, 1);
            assert.match((yield* deltas(sql))[0]?.reason ?? "", /person must inspect/u);
          }),
        ),
      );
    });

    // Main D15: a changed declaration of a service the project has is reported, never applied, and
    // a service the tier no longer declares is reported, never deleted — a change that adds nothing
    // imports nothing.
    it.effect("never applies a changed declaration, nor deletes a service the tier drops", () =>
      withDeploys(({ appId, world, tiers, commit, planned }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          world.services.push(fakeService("worker", { http: false }));
          tiers.set(
            `${appId}/stage`,
            tierOf(...runtime(appId, "web"), ...runtime(appId, "worker")),
          );
          yield* commit("group", { "README.md": "# Shop\n" });
          // The tier is read when a rollout is planned: the first must see it before it changes.
          yield* planned;
          tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web", "    minContainers: 2")));
          const changed = yield* commit("group", { "README.md": "# Shop, scaled\n" });
          yield* planned;
          assert.deepStrictEqual(yield* sql`SELECT 1 FROM hq_deploy_job WHERE kind = 'delta'`, []);
          assert.deepStrictEqual(world.imports, []);
          assert.deepStrictEqual(
            world.services.map((service) => service.name),
            ["web", "worker"],
          );
          assert.deepStrictEqual(
            yield* sql<{ readonly note: string }>`
              SELECT note FROM hq_rollout WHERE sha = ${changed}`,
            [
              {
                note: "the stage recipe for web changed: reported, never applied to a service that exists; the stage tier no longer declares worker: HQ never deletes a service",
              },
            ],
          );
        }),
      ),
    );

    // Audit D2: a recipe merge's delta carries only what that merge's tier change added. One that
    // could not import ends refused, and no later merge asks it again; a service a person deleted
    // is never imported again by a merge — only a person's Add service brings it back.
    it.effect(
      "imports only what a tier change added, once, and a deleted service only when asked",
      () =>
        withDeploys(({ appId, world, tiers, commit, planned }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            const deltas = sql<{
              readonly state: string;
              readonly services: ReadonlyArray<string>;
            }>`
            SELECT state, services FROM hq_deploy_job WHERE kind = 'delta' ORDER BY id`;
            const cache = ["  - hostname: cache", "    type: valkey@7.2"];
            const queue = ["  - hostname: queue", "    type: nats@2.10"];
            tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web")));
            yield* commit("group", { "README.md": "# Shop\n" });
            // The tier is read when a rollout is planned: the first must see it before it changes.
            yield* planned;
            // The key gone: the merge that added the cache cannot import it.
            const kept = world.tokens.get("key-stage")!;
            world.tokens.delete("key-stage");
            tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web"), ...cache));
            yield* commit("group", { "README.md": "# Shop, with a cache\n" });
            yield* planned;
            yield* deltas.pipe(
              Effect.filterOrFail(
                (rows) => rows.length === 1 && rows[0]?.state === "refused",
                () => "not yet",
              ),
              Effect.retry(Schedule.spaced(Duration.millis(20))),
              Effect.timeout(Duration.seconds(10)),
              Effect.orDie,
            );
            world.tokens.set("key-stage", kept);
            yield* sql`UPDATE hq_deploy_token SET invalid_since = NULL`;
            // A later merge adds a queue: its delta carries the queue only.
            tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web"), ...cache, ...queue));
            yield* commit("group", { "README.md": "# Shop, with a queue\n" });
            yield* deltas.pipe(
              Effect.filterOrFail(
                (rows) => rows.length === 2 && rows[1]?.state === "live",
                () => "not yet",
              ),
              Effect.retry(Schedule.spaced(Duration.millis(20))),
              Effect.timeout(Duration.seconds(10)),
              Effect.orDie,
            );
            assert.deepStrictEqual(
              (yield* deltas).map(({ state, services }) => [state, services]),
              [
                ["refused", ["cache"]],
                ["live", ["queue"]],
              ],
            );
            assert.lengthOf(world.imports, 1);
            assert.include(world.imports[0]?.yaml ?? "", "hostname: queue");
            assert.notInclude(world.imports[0]?.yaml ?? "", "hostname: cache");
            // A person deletes the queue; the next merge brings it back no more.
            world.services.splice(
              world.services.findIndex((service) => service.name === "queue"),
              1,
            );
            yield* commit("group", { "README.md": "# Shop, again\n" });
            yield* planned;
            assert.lengthOf(world.imports, 1);
            // Asked by a person, each is added: its import asked, then followed to its end.
            const added = yield* (yield* Deploys).addService("dev", appId, "shop-stage", "cache");
            assert.deepStrictEqual(
              added.jobs.map(({ kind, state, reason }) => [kind, state, reason]),
              [["delta", "building", null]],
            );
            assert.include(world.imports[1]?.yaml ?? "", "hostname: cache");
            yield* deltas.pipe(
              Effect.filterOrFail(
                (rows) => rows.at(-1)?.state === "live",
                () => "not yet",
              ),
              Effect.retry(Schedule.spaced(Duration.millis(20))),
              Effect.timeout(Duration.seconds(10)),
              Effect.orDie,
            );
          }),
        ),
    );

    // Add service, a person's: only what the tier declares, by whoever may Run again; one the
    // project has already is skipped, saying so.
    it.effect("adds a service the tier declares, for whoever may Run again, and nothing else", () =>
      withDeploys(({ appId, world, tiers }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web")));
          const deploys = yield* Deploys;
          const add = (userId: string, service: string) =>
            deploys.addService(userId, appId, "shop-stage", service).pipe(
              Effect.match({
                onSuccess: (answer) =>
                  answer.jobs.map(({ state, reason }) => `${state}: ${reason ?? ""}`).join(),
                onFailure: (error) => ("reason" in error ? String(error.reason) : error._tag),
              }),
            );
          assert.deepStrictEqual(
            [
              yield* add("stranger", "web"),
              yield* add("viewer", "web"),
              yield* add("dev", "cache"),
              yield* add("dev", "web"),
            ],
            [
              "app_not_seen",
              "not_app_developer",
              "service_not_declared",
              "skipped: the project has web already",
            ],
          );
          assert.deepStrictEqual(world.imports, []);
        }),
      ),
    );

    // Audit H6: Zerops takes no idempotency key, so a build HQ submitted is never submitted again
    // while it runs, however long it takes.
    it.effect("never submits again a deploy still building", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILDING";
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("building"));
          // Past the slow-down: still read, never submitted again.
          yield* Effect.sleep(Duration.millis(600));
          assert.lengthOf(versions(world), 1);
          world.outcome = () => "ACTIVE";
          yield* until(settled("live"));
          assert.lengthOf(versions(world), 1);
        }),
      ),
    );

    it.effect(
      "ends an unobservable subdomain step as unresolved while retaining the verified deploy",
      () =>
        Effect.gen(function* () {
          let world: FakeWorld | undefined;
          let watches = 0;
          return yield* withDeploys(
            ({ appId, world: rigWorld, tiers, commit, until }) =>
              Effect.gen(function* () {
                world = rigWorld;
                yield* createdForHq("P_STAGE");
                tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
                yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
                yield* until(
                  (rows) => rows[0]?.state === "unresolved" || rows[0]?.state === "live",
                );
                const [operation] = yield* (yield* Deploys).operations(appId);
                assert.strictEqual(operation?.state, "unresolved");
                assert.lengthOf(operation?.handles ?? [], 2);
                assert.strictEqual(operation?.verifiedVersionId, operation?.versionId);
                assert.strictEqual(operation?.evidence?.nextActor, "person");
              }),
            {
              observer: {
                watch: (target) =>
                  ++watches === 1
                    ? fakeOperationWatch(world!).watch(target)
                    : Stream.fail(
                        new ZeropsRefused({
                          operation: "observation",
                          reason: "forbidden",
                          status: 403,
                          code: "access_gone",
                        }),
                      ),
              },
            },
          );
        }),
    );

    it.effect("resumes the recorded subdomain handle at takeover without submitting it again", () =>
      withDeploys(({ appId, world, tiers, commit, until, takeover }) =>
        Effect.gen(function* () {
          const service = yield* Deploys;
          yield* createdForHq("P_STAGE");
          world.subdomainRunningReads = 10_000;
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* service.changes.pipe(
            Stream.mapEffect(() => service.operations(appId)),
            Stream.filter(
              (rows) =>
                rows[0]?.evidence?.processes.some(
                  (process) => process.id !== rows[0]?.handle && process.status === "RUNNING",
                ) === true,
            ),
            Stream.take(1),
            Stream.runHead,
          );
          const before = (yield* service.operations(appId))[0]!;
          assert.lengthOf(before.handles, 2);
          const submitted = world.calls.filter((call) =>
            call.startsWith("enableSubdomainAccess:"),
          ).length;
          yield* takeover(
            Effect.sync(() => {
              for (const job of world.jobs.values())
                if (job.appVersionId === undefined) job.runningReads = 0;
            }),
          );
          yield* until(settled("live"));
          assert.strictEqual(
            world.calls.filter((call) => call.startsWith("enableSubdomainAccess:")).length,
            submitted,
          );
        }),
      ),
    );

    it.effect(
      "keeps operation evidence through recovery and verifies the version on a terminal push",
      () =>
        Effect.gen(function* () {
          const signals = yield* Queue.unbounded<"recovering" | "finished">();
          return yield* withDeploys(
            ({ appId, world, tiers, commit, until }) =>
              Effect.gen(function* () {
                const service = yield* Deploys;
                tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
                world.outcome = () => "BUILDING";
                yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
                yield* until(settled("building"));
                const atPhase = (phase: string) =>
                  service.changes.pipe(
                    Stream.mapEffect(() => service.operations(appId)),
                    Stream.filter((rows) => rows[0]?.evidence?.phase === phase),
                    Stream.take(1),
                    Stream.runHead,
                  );
                yield* atPhase("live");
                const before = (yield* service.operations(appId))[0]!;
                yield* Queue.offer(signals, "recovering");
                yield* atPhase("recovering");
                const gap = (yield* service.operations(appId))[0]!;
                assert.deepStrictEqual(gap.evidence?.processes, before.evidence?.processes);
                assert.strictEqual(gap.evidence?.nextActor, "hq");
                const web = world.services.find((row) => row.name === "web")!;
                web.activeVersionId = before.versionId;
                yield* Queue.offer(signals, "finished");
                yield* until(settled("live"));
                const done = (yield* service.operations(appId))[0]!;
                assert.strictEqual(done.handle, before.handle);
                assert.strictEqual(done.verifiedVersionId, before.versionId);
                assert.isTrue(
                  done.steps.some((step) =>
                    step.processes.some((process) => process.status === "FINISHED"),
                  ),
                );
                assert.strictEqual(done.evidence?.nextActor, "none");
              }),
            {
              observer: {
                watch: (target) => {
                  const running: OperationSignal = {
                    phase: "live",
                    processes: target.processIds.map((id) => ({ id, status: "RUNNING" })),
                    version: null,
                  };
                  return Stream.concat(
                    Stream.succeed(running),
                    Stream.fromQueue(signals).pipe(
                      Stream.map((kind): OperationSignal =>
                        kind === "recovering"
                          ? { phase: "recovering", processes: [], version: null }
                          : {
                              phase: "live",
                              processes: target.processIds.map((id) => ({
                                id,
                                status: "FINISHED",
                              })),
                              version: null,
                            },
                      ),
                    ),
                  );
                },
              },
            },
          );
        }),
    );

    it.effect.each(["version first", "process first"] as const)(
      "joins terminal process and ACTIVE version evidence despite a stale service read: %s",
      (order) =>
        withDeploys(
          ({ appId, world, tiers, commit, until }) =>
            Effect.gen(function* () {
              tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
              world.outcome = () => "BUILDING";
              yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
              yield* until(settled("live"));
              const operation = (yield* (yield* Deploys).operations(appId))[0]!;
              assert.strictEqual(operation.verifiedVersionId, operation.versionId);
              assert.notStrictEqual(world.services[0]!.activeVersionId, operation.versionId);
            }),
          {
            observer: {
              watch: (target) =>
                Stream.fromIterable([
                  {
                    phase: "live",
                    processes: target.processIds.map((id) => ({
                      id,
                      status: order === "version first" ? "RUNNING" : "FINISHED",
                    })),
                    version: {
                      id: target.versionId!,
                      status: order === "version first" ? "ACTIVE" : "BUILDING",
                    },
                  },
                  {
                    phase: "live",
                    processes: target.processIds.map((id) => ({ id, status: "FINISHED" })),
                    version: { id: target.versionId!, status: "ACTIVE" },
                  },
                ] as const).pipe(Stream.concat(Stream.never)),
            },
          },
        ),
    );

    it.effect.each(
      Array.from(["evidence", "verified_version_id"] as const, (column) => ({
        title: `restarts an environment worker after a transient ${column} SQL failure`,
        column,
      })),
    )("$title", ({ column }) =>
      Effect.gen(function* () {
        const stopped = yield* Queue.unbounded<Fiber.Fiber<unknown, unknown>>();
        let platform: FakeWorld | undefined;
        return yield* withDeploys(
          ({ appId, world, tiers, commit, deploys }) =>
            Effect.gen(function* () {
              platform = world;
              const sql = yield* SqlClient.SqlClient;
              yield* sql.unsafe(
                `CREATE FUNCTION reject_observation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'temporary observation write failure'; END $$`,
              );
              yield* sql.unsafe(
                `CREATE TRIGGER reject_observation BEFORE UPDATE OF ${column} ON hq_deploy_job FOR EACH ROW EXECUTE FUNCTION reject_observation()`,
              );
              tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
              world.outcome = () => "BUILDING";
              yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
              // Observer finalization precedes the worker's registry cleanup. Join the worker
              // that reported the SQL failure before waking dispatch again.
              yield* Fiber.await(yield* Queue.take(stopped));
              yield* sql`DROP TRIGGER reject_observation ON hq_deploy_job`;
              yield* (yield* Rollouts).wake;
              yield* (yield* Deploys).changes.pipe(
                Stream.mapEffect(() => deploys),
                Stream.filter(settled("live")),
                Stream.take(1),
                Stream.runDrain,
              );
              assert.lengthOf(versions(world), 1);
            }),
          {
            observer: {
              watch: (target) =>
                Stream.unwrap(
                  Effect.sync(() => {
                    if (platform !== undefined)
                      platform.services[0]!.activeVersionId = target.versionId;
                    return Stream.succeed({
                      phase: "live",
                      processes: target.processIds.map((id) => ({ id, status: "FINISHED" })),
                      version: { id: target.versionId!, status: "ACTIVE" },
                    } as const);
                  }),
                ),
            },
          },
        ).pipe(
          Effect.provide(
            Logger.layer([
              Logger.make(({ message, fiber }) => {
                if (Array.isArray(message) && message[0] === "an environment's deploys stopped")
                  Queue.offerUnsafe(stopped, fiber);
              }),
            ]),
          ),
        );
      }),
    );

    it.effect(
      "B9: an accepted build reads UPLOADING before it appears and is followed to its end",
      () =>
        withDeploys(({ appId, world, tiers, commit, until }) =>
          Effect.gen(function* () {
            const service = yield* Deploys;
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            world.uploadTakes = 200;
            world.buildSeenAfter = 500;
            world.outcome = () => "BUILDING";
            world.lost.add("buildAndDeploy");
            yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* service.changes.pipe(
              Stream.mapEffect(() => service.operations(appId)),
              Stream.filter((rows) => rows[0]?.evidence?.phase === "waiting-for-build"),
              Stream.take(1),
              Stream.runDrain,
              Effect.timeout(2000),
            );
            const waiting = (yield* service.operations(appId))[0]!;
            assert.strictEqual(waiting.state, "submitting");
            assert.strictEqual(waiting.evidence?.nextActor, "person");
            assert.include(waiting.evidence!.nextAction, "Run again");
            world.outcome = () => "ACTIVE";
            yield* until(settled("live"));
            assert.lengthOf(versions(world), 1);
          }),
        ),
    );

    it.effect(
      "carries unresolved operation evidence and known facts in the decoded server answer",
      () =>
        withDeploys(({ appId, world, tiers, commit, until }) =>
          Effect.gen(function* () {
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            world.lost.add("upload");
            yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("unresolved"));
            const service = yield* Deploys;
            const [row] = yield* (yield* SqlClient.SqlClient)<{
              id: string;
            }>`SELECT rollout_id::text AS id FROM hq_deploy_job LIMIT 1`;
            const answer = yield* decodeDeployAnswer(yield* service.run(row!.id));
            const operation = (yield* service.operations(appId))[0]!;
            assert.deepStrictEqual(answer.jobs[0]?.evidence, operation.evidence);
            assert.deepStrictEqual(answer.jobs[0]?.steps, operation.steps);
            assert.strictEqual(answer.jobs[0]?.appVersionId, operation.versionId);
            assert.strictEqual(answer.jobs[0]?.evidence?.nextActor, "person");
          }),
        ),
    );

    it.effect("keeps a running build after 75 minutes and follows its owner's end", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until, takeover }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILDING";
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("building"));
          const sql = yield* SqlClient.SqlClient;
          yield* takeover(
            Effect.gen(function* () {
              yield* sql`UPDATE hq_deploy_job SET submitted_at = now() - interval '80 minutes'`;
            }).pipe(Effect.orDie),
          );
          yield* until((rows) => rows[0]?.state !== "queued");
          assert.strictEqual((yield* deploys)[0]?.state, "building");
          world.outcome = () => "ACTIVE";
          yield* until(settled("live"));
          assert.lengthOf(versions(world), 1);
        }),
      ),
    );

    // Audit H6: a build whose answer was lost may be running: the job stays submitting, HQ reads
    // the version it made, and never submits the commit again.
    it.effect("never submits again a build whose answer was lost, and reads where it stands", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILDING";
          world.lost.add("buildAndDeploy");
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("building"));
          assert.lengthOf(versions(world), 1);
          world.outcome = () => "ACTIVE";
          yield* until(settled("live"));
          assert.lengthOf(versions(world), 1);
        }),
      ),
    );

    // A Zerops that does not answer says nothing of a build HQ submitted: it is read again, and
    // never submitted again.
    it.effect("never submits again a build while Zerops does not answer about it", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILDING";
          world.lost.add("buildAndDeploy");
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("building"));
          world.unanswered.add("appVersion");
          const service = yield* Deploys;
          yield* service.changes.pipe(
            Stream.mapEffect(() => service.operations(appId)),
            Stream.filter((rows) => rows[0]?.evidence?.phase === "recovering"),
            Stream.take(1),
            Stream.runDrain,
            Effect.timeout("2 seconds"),
          );
          world.unanswered.clear();
          world.outcome = () => "ACTIVE";
          yield* until(settled("live"));
          assert.lengthOf(versions(world), 1);
        }),
      ),
    );

    // A version whose upload went unanswered is one whose build HQ never asked for: it waits for its
    // archive for good, which HQ knows by its own record — no clock, however long its window. The
    // job ends refused at once, never submitted again; a person's Run again makes another.
    it.effect("ends an unanswered upload as unresolved, and submits again only when asked", () =>
      withDeploys(
        ({ appId, world, tiers, commit, deploys, until }) =>
          Effect.gen(function* () {
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            world.lost.add("upload");
            const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("unresolved"));
            assert.deepStrictEqual(
              (yield* deploys).map(({ reason }) => reason),
              [
                "HQ's archive upload went unanswered; no build was asked for; a person must inspect the original handle in Zerops",
              ],
            );
            assert.deepStrictEqual(
              [...world.appVersions.values()].map((version) => version.status),
              ["UPLOADING"],
            );
            assert.strictEqual(yield* runAgain(appId, "dev", sha), "ok");
            yield* until((rows) => rows.at(-1)?.state === "live");
            assert.deepStrictEqual(
              [...world.appVersions.values()].map((version) => version.status),
              ["UPLOADING", "ACTIVE"],
            );
          }),
        FAST,
      ),
    );

    it.effect("a newer deploy supersedes a waiting build and the environment worker moves on", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.unanswered.add("buildAndDeploy");
          const first = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          const service = yield* Deploys;
          yield* service.changes.pipe(
            Stream.mapEffect(() => service.operations(appId)),
            Stream.filter((rows) => rows[0]?.evidence?.phase === "waiting-for-build"),
            Stream.take(1),
            Stream.runDrain,
            Effect.timeout("2 seconds"),
          );
          world.unanswered.clear();
          const second = yield* commit("web", { "index.js": "newer deploy\n" });
          yield* until((rows) => rows.length === 2);
          assert.strictEqual((yield* deploys)[0]?.state, "superseded");
          yield* until((rows) => rows.at(-1)?.state === "live");
          assert.deepStrictEqual(
            (yield* deploys).map(({ sha, state }) => [sha, state]),
            [
              [first, "superseded"],
              [second, "live"],
            ],
          );
          const records = yield* service.operations(appId);
          assert.strictEqual(records[0]?.evidence?.phase, "closed");
          assert.strictEqual(records[0]?.evidence?.nextActor, "none");
          const sql = yield* SqlClient.SqlClient;
          const [link] = yield* sql<{ successor: string; newest: string }>`
            SELECT superseded_by::text AS successor,
              (SELECT max(id)::text FROM hq_deploy_job) AS newest
            FROM hq_deploy_job WHERE sha = ${first}`;
          assert.strictEqual(link?.successor, link?.newest);
        }),
      ),
    );

    it.effect(
      "an unobservable build stays pending across restart and explicit Run again supersedes the wait",
      () =>
        withDeploys(({ appId, world, tiers, commit, deploys, until, takeover, again }) =>
          Effect.gen(function* () {
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            world.unanswered.add("buildAndDeploy");
            const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            const sql = yield* SqlClient.SqlClient;
            const waiting =
              sql`SELECT 1 FROM hq_deploy_job WHERE evidence->>'phase' = 'waiting-for-build'`.pipe(
                Effect.filterOrFail((rows) => rows.length === 1),
                Effect.retry(Schedule.spaced("20 millis")),
                Effect.timeout("2 seconds"),
              );
            yield* waiting;
            assert.strictEqual((yield* deploys)[0]?.state, "submitting");
            yield* takeover();
            yield* waiting;
            world.unanswered.clear();
            yield* again("owner", sha);
            yield* until((rows) => rows.length === 2 && rows.at(-1)?.state === "live");
            assert.strictEqual((yield* deploys)[0]?.state, "superseded");
            assert.lengthOf(versions(world), 2);
          }),
        ),
    );

    // A version made whose answer was lost is one HQ cannot name: the job ends refused, and HQ
    // makes no other.
    it.effect("marks unresolved a deploy whose version's answer was lost, making no other", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until, drained }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.lost.add("createAppVersion");
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("unresolved"));
          assert.match((yield* deploys)[0]?.reason ?? "", /HQ has no handle to follow/u);
          yield* drained;
          assert.lengthOf(versions(world), 1);
        }),
      ),
    );

    // The deploy-jobs design: a Core taking the lead resumes its jobs from their records — a build
    // by its version and job, submitting nothing again — and plans the rollouts no Core planned.
    it.effect(
      "resumes its jobs at takeover from their records, and plans what no Core planned",
      () =>
        withDeploys(({ appId, world, tiers, commit, deploys, until, takeover }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            world.outcome = () => "BUILDING";
            yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("building"));
            yield* takeover();
            world.outcome = () => "ACTIVE";
            yield* until(settled("live"));
            assert.lengthOf(versions(world), 1);

            // A key kept while no Core leads: the next one plans what it asks for.
            world.services.push(fakeService("api"));
            const api = yield* commit("api", { "zerops.yaml": zeropsYaml("api") });
            yield* takeover(
              Effect.gen(function* () {
                tiers.set(
                  `${appId}/stage`,
                  stageTier(appId, [{ hostname: "web" }, { hostname: "api" }]),
                );
                yield* addRollout(sql, { cause: "key_kept", projectId: "P_STAGE", by: "owner" });
              }).pipe(Effect.orDie),
            );
            yield* until((rows) => rows.some((row) => row.sha === api && row.state === "live"));
            assert.deepStrictEqual(
              (yield* deploys).map(({ service, state }) => [service, state]),
              [
                ["web", "live"],
                ["api", "live"],
              ],
            );
          }),
        ),
    );

    // The deploy-jobs design: a submission a Core stopped in before Zerops answered — no version
    // recorded — is no longer being made: the next Core ends it refused, never submitting it, and
    // submits what waited behind it, its first submission.
    it.effect("ends at takeover a submission no version was heard of, and submits what waits", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until, takeover }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          world.services.push(fakeService("api"));
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }, { hostname: "api" }]));
          const web = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          const api = yield* commit("api", { "zerops.yaml": zeropsYaml("api") });
          yield* until((rows) => rows.length === 2 && settled("live")(rows));
          yield* takeover(
            Effect.gen(function* () {
              const [rollout] = yield* sql<{ readonly id: string }>`
                INSERT INTO hq_rollout (app_id, cause, project_id, by, planned_at)
                VALUES (${appId}::uuid, 'run_again', 'P_STAGE', 'dev', now())
                RETURNING id::text AS id`;
              yield* sql`
                INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, ord,
                  state, submitted_at)
                VALUES (${rollout!.id}::bigint, 'deploy', 'P_STAGE', 'web', 'web', ${web}, 0,
                  'submitting', now())`;
              yield* sql`
                INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, ord,
                  state, requested_by)
                VALUES (${rollout!.id}::bigint, 'deploy', 'P_STAGE', 'api', 'api', ${api}, 1,
                  'queued', 'dev')`;
            }).pipe(Effect.orDie),
          );
          yield* until(
            (rows) => rows.length === 4 && rows.at(-1)?.reason === "api already runs it",
          );
          assert.deepStrictEqual(
            (yield* deploys).slice(2).map(({ service, state, reason }) => [service, state, reason]),
            [
              [
                "web",
                "unresolved",
                "HQ restarted before Zerops answered; a person must inspect the original handle in Zerops",
              ],
              ["api", "live", "api already runs it"],
            ],
          );
          assert.lengthOf(versions(world), 2);
        }),
      ),
    );

    // An old version-only record does not prove build acceptance, even if a build appears later.
    it.effect.each<{
      readonly name: string;
      /** When its build shows, ms after the takeover; never where undefined. */
      readonly seenAfter?: number;
      readonly ends: readonly [string, string | null];
    }>([
      {
        name: "its build appears later: followed to its owner’s end",
        seenAfter: 100,
        ends: ["live", null],
      },
      {
        name: "its build has not appeared: still pending with a person’s next action",
        ends: ["submitting", null],
      },
    ])(
      "a submission left from before HQ recorded uploads, at takeover: $name",
      ({ seenAfter, ends }) =>
        withDeploys(({ appId, world, tiers, commit, deploys, until, takeover }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("live"));
            const web = world.services.find((service) => service.name === "web")!;
            const now = yield* Clock.currentTimeMillis;
            world.appVersions.set("V-legacy", {
              id: "V-legacy",
              serviceId: web.id,
              name: "legacy",
              status: "UPLOADING",
              archive: new Uint8Array([1]),
              zeropsYaml: ZEROPS_YAML,
              setup: "web",
              ...(seenAfter === undefined ? {} : { buildSeenAtMs: now + seenAfter }),
            });
            if (seenAfter !== undefined) {
              world.jobs.set("process-legacy", {
                status: "RUNNING",
                failure: null,
                appVersionId: "V-legacy",
              });
            }
            yield* takeover(
              Effect.gen(function* () {
                const [rollout] = yield* sql<{ readonly id: string }>`
                INSERT INTO hq_rollout (app_id, cause, project_id, by, planned_at)
                VALUES (${appId}::uuid, 'run_again', 'P_STAGE', 'dev', now())
                RETURNING id::text AS id`;
                yield* sql`
                INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, service_id, repo,
                  sha, ord, state, submitted_at, app_version_id, upload_recorded)
                VALUES (${rollout!.id}::bigint, 'deploy', 'P_STAGE', 'web', ${web.id}, 'web',
                  ${sha}, 0, 'submitting', now(), 'V-legacy', false)`;
              }).pipe(Effect.orDie),
            );
            yield* until((rows) => rows.length === 2 && rows[1]?.state === ends[0]);
            const legacy = (yield* deploys)[1];
            assert.deepStrictEqual([legacy?.state, legacy?.reason ?? null], [...ends]);
          }),
        ),
    );

    // F17, main #162: a commit whose zerops.yaml does not carry the tier's setup — none at all, under
    // zcli's first name or its second — is not submitted: its job is skipped, saying why, so a
    // stage's first deploy reads "Nothing deployed yet" until code lands, and the next merge asks.
    it.effect.each<{
      readonly name: string;
      /** A commit deployed there before, if any. */
      readonly before?: Files;
      readonly head: Files;
      /** Why it is skipped, of the commit's short sha; deployed where none. */
      readonly skipped?: (short: string) => string;
    }>([
      {
        name: "first, no zerops.yaml: skipped",
        head: { "README.md": "# Shop\n" },
        skipped: (short) => `web has no zerops.yaml at ${short}`,
      },
      {
        name: "first, no setup for the tier: skipped",
        head: { "zerops.yaml": zeropsYaml("api") },
        skipped: (short) => `web's zerops.yaml at ${short} has no setup web`,
      },
      // Code main has deploys at once: under zcli's second name too.
      { name: "first, a zerops.yml with it: deploys", head: { "zerops.yml": ZEROPS_YAML } },
      // What Zerops makes of a zerops.yaml HQ cannot read is Zerops' to say.
      { name: "first, a zerops.yaml not YAML: deploys", head: { "zerops.yaml": "zerops: [\n" } },
      {
        name: "after a deploy, no zerops.yaml: skipped",
        before: { "zerops.yaml": ZEROPS_YAML },
        head: { "zerops.yaml": null },
        skipped: (short) => `web has no zerops.yaml at ${short}`,
      },
    ])("a stage's deploy of main's head: $name", ({ before, head, skipped }) =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          if (before !== undefined) {
            yield* commit("web", before);
            yield* until(settled("live"));
          }
          const made = versions(world).length;
          const sha = yield* commit("web", head);
          if (skipped === undefined) {
            yield* until((rows) => rows.some((row) => row.sha === sha && row.state === "live"));
            assert.deepStrictEqual(
              [...world.appVersions.values()].map(({ name, zeropsYaml }) => [name, zeropsYaml]),
              [[`main ${sha.slice(0, 7)}`, head["zerops.yaml"] ?? head["zerops.yml"]]],
            );
            return;
          }
          yield* until((rows) => rows.some((row) => row.sha === sha && row.state === "skipped"));
          assert.deepStrictEqual(
            (yield* deploys).filter((row) => row.sha === sha).map(({ reason }) => reason),
            [skipped(sha.slice(0, 7))],
          );
          assert.lengthOf(versions(world), made);
          const next = yield* commit("web", { "zerops.yaml": ZEROPS_YAML, "next.txt": "1\n" });
          yield* until((rows) => rows.some((row) => row.sha === next && row.state === "live"));
        }),
      ),
    );

    // An application with no stage tier deploys nothing; a production follows releases (T9), never
    // main.
    it.effect("deploys nothing without a stage tier, and no production", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, ask, planned }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* planned;
          assert.deepStrictEqual(yield* deploys, []);

          yield* sql`DELETE FROM hq_environment`;
          yield* sql`UPDATE hq_app_project SET kind = 'production' WHERE project_id = 'P_STAGE'`;
          yield* sql`
            INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by)
            VALUES ('P_STAGE', ${appId}::uuid, 'production', 'shop', '{release}', 'owner')`;
          yield* keepToken("P_STAGE", "key-stage");
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          tiers.set(`${appId}/production`, stageTier(appId, [{ hostname: "web" }]));
          yield* ask({ cause: "env_added", projectId: "P_STAGE", by: "owner" });
          yield* commit("web", { "index.js": "two\n" });
          yield* planned;
          assert.deepStrictEqual(yield* deploys, []);
          assert.deepStrictEqual(versions(world), []);
        }),
      ),
    );

    // SPEC §3.2d, main C15/C16/B16: an approved release deploys every production environment, each
    // service at the commit the release lists, named `{tag} <7 hex>`; a rollback is a release.
    it.effect("deploys an approved release to production, and every later one, rollbacks too", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          yield* withProduction(appId, world);
          const releases = yield* Releases;
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          tiers.set(`${appId}/production`, tierOf(...runtime(appId, "web")));
          const one = yield* commit("web", { "zerops.yaml": ZEROPS_YAML, "index.js": "1\n" });
          const atProduction = (sha: string) => (rows: ReadonlyArray<JobRow>) =>
            rows.some((row) => row.project === "P_PROD" && row.sha === sha && row.state === "live");
          yield* releases.release("dev", appId, {
            tag: "v0.1.0",
            groupHead,
            entries: [{ service: "web", sha: one }],
          });
          yield* until(atProduction(one));
          const two = yield* commit("web", { "index.js": "2\n" });
          yield* releases.release("dev", appId, {
            tag: "v0.2.0",
            groupHead,
            entries: [{ service: "web", sha: two }],
          });
          yield* until(atProduction(two));
          yield* releases.rollback("dev", appId, "v0.1.0", { groupHead });
          yield* until(
            (rows) =>
              atProduction(one)(rows) &&
              prodService(world)?.named?.name === `v0.2.1 ${one.slice(0, 7)}`,
          );
          assert.deepStrictEqual(
            versions(world).filter((name) => name.startsWith("v")),
            [`v0.1.0 ${one.slice(0, 7)}`, `v0.2.0 ${two.slice(0, 7)}`, `v0.2.1 ${one.slice(0, 7)}`],
          );
        }),
      ),
    );

    // Main C16: a production service the release does not list is reported and not deployed; the
    // rest deploy. No approved release deploys nothing, and is no failure.
    it.effect("deploys what the release lists of production, and nothing before a release", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until, ask, planned }) =>
        Effect.gen(function* () {
          yield* withProduction(appId, world);
          world.services.push(fakeService("api", { id: "S-api-prod", projectId: "P_PROD" }));
          const sql = yield* SqlClient.SqlClient;
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          tiers.set(
            `${appId}/production`,
            tierOf(...runtime(appId, "web"), ...runtime(appId, "api")),
          );
          const web = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* commit("api", { "zerops.yaml": ZEROPS_YAML });
          yield* ask({ cause: "env_added", projectId: "P_PROD", by: "owner" });
          yield* planned;
          assert.deepStrictEqual(
            (yield* deploys).filter((row) => row.project === "P_PROD"),
            [],
          );
          yield* (yield* Releases).release("dev", appId, {
            tag: "v0.1.0",
            groupHead,
            entries: [{ service: "web", sha: web }],
          });
          yield* until((rows) =>
            rows.some((row) => row.project === "P_PROD" && row.state === "live"),
          );
          assert.deepStrictEqual(
            (yield* deploys)
              .filter((row) => row.project === "P_PROD")
              .map(({ service, sha, state }) => [service, sha, state]),
            [["web", web, "live"]],
          );
          assert.deepStrictEqual(
            yield* sql<{ readonly note: string }>`
              SELECT note FROM hq_rollout WHERE cause = 'release'`,
            [{ note: "v0.1.0 lists no api" }],
          );

          // A rollback carries a service production no longer builds: reported, the rest deploy.
          const next = yield* commit("web", { "index.js": "next\n" });
          yield* sql`
            INSERT INTO hq_release (app_id, tag, sha, entries, released_by, state, rollback_of)
            VALUES (${appId}::uuid, 'v0.1.1', ${groupHead},
              ${`[{"service":"web","sha":"${next}"},{"service":"gone","sha":"${web}"}]`}::jsonb,
              'dev', 'approved', 'v0.0.9')`;
          yield* ask({ cause: "release", appId, tag: "v0.1.1", by: "dev" });
          yield* until((rows) =>
            rows.some(
              (row) => row.project === "P_PROD" && row.sha === next && row.state === "live",
            ),
          );
          assert.deepStrictEqual(
            (yield* deploys)
              .filter((row) => row.project === "P_PROD")
              .map(({ service, sha }) => [service, sha]),
            [
              ["web", web],
              ["web", next],
            ],
          );
        }),
      ),
    );

    // A production follows the releases made after it was attached: attaching, keeping its key or
    // replacing it deploys nothing of an older one, a rolled-back snapshot of v0.13.x included.
    it.effect("deploys nothing of a release made before the production was attached", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until, ask, planned }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          tiers.set(`${appId}/production`, tierOf(...runtime(appId, "web")));
          const old = yield* commit("web", { "zerops.yaml": ZEROPS_YAML, "index.js": "old\n" });
          yield* sql`
            INSERT INTO hq_release
              (app_id, tag, sha, entries, released_by, state, snapshot, released_at)
            VALUES (${appId}::uuid, 'v0.1.0', ${groupHead},
              ${`[{"service":"web","sha":"${old}"}]`}::jsonb, 'dev', 'approved', true,
              now() - interval '1 hour')`;
          yield* withProduction(appId, world);
          yield* sql`UPDATE hq_environment SET release_floor = now() WHERE project_id = 'P_PROD'`;
          for (const cause of ["env_added", "key_kept"] as const) {
            yield* ask({ cause, projectId: "P_PROD", by: "owner" });
          }
          yield* planned;
          assert.deepStrictEqual(
            (yield* deploys).filter((row) => row.project === "P_PROD"),
            [],
          );
          // The first release made after it is what it follows.
          const fresh = yield* commit("web", { "index.js": "fresh\n" });
          yield* (yield* Releases).release("dev", appId, {
            tag: "v0.1.1",
            groupHead,
            entries: [{ service: "web", sha: fresh }],
          });
          yield* until((rows) =>
            rows.some(
              (row) => row.project === "P_PROD" && row.sha === fresh && row.state === "live",
            ),
          );
          // Replaced, it follows nothing again until the next release.
          yield* sql`DELETE FROM hq_environment WHERE project_id = 'P_PROD'`;
          yield* sql`
            INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by,
              release_floor)
            VALUES ('P_PROD', ${appId}::uuid, 'production', 'shop-production', '{release}', 'owner',
              now())`;
          const before = (yield* deploys).filter((row) => row.project === "P_PROD").length;
          yield* ask({ cause: "env_added", projectId: "P_PROD", by: "owner" });
          yield* planned;
          assert.strictEqual(
            (yield* deploys).filter((row) => row.project === "P_PROD").length,
            before,
          );
        }),
      ),
    );

    // A production that existed before releases had a floor keeps following the newest approved
    // release, whenever it was made: tags recovered from git carry their own, older times.
    it.effect("keeps an existing production following a release older than its record", () =>
      withDeploys(({ appId, world, tiers, commit, until, ask }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          tiers.set(`${appId}/production`, tierOf(...runtime(appId, "web")));
          const old = yield* commit("web", { "zerops.yaml": ZEROPS_YAML, "index.js": "old\n" });
          yield* sql`
            INSERT INTO hq_release (app_id, tag, sha, entries, released_by, state, released_at)
            VALUES (${appId}::uuid, 'v0.1.0', ${groupHead},
              ${`[{"service":"web","sha":"${old}"}]`}::jsonb, 'dev', 'approved',
              now() - interval '1 hour')`;
          yield* withProduction(appId, world);
          yield* ask({ cause: "key_kept", projectId: "P_PROD", by: "owner" });
          yield* until((rows) =>
            rows.some((row) => row.project === "P_PROD" && row.sha === old && row.state === "live"),
          );
        }),
      ),
    );

    // F17: a release listing a commit with no zerops.yaml submits nothing of it: its job is skipped,
    // saying so.
    it.effect("skips production's deploy of a release commit with no zerops.yaml", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          yield* withProduction(appId, world);
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          tiers.set(`${appId}/production`, tierOf(...runtime(appId, "web")));
          const bare = yield* commit("web", { "README.md": "# Shop\n" });
          yield* (yield* Releases).release("dev", appId, {
            tag: "v0.1.0",
            groupHead,
            entries: [{ service: "web", sha: bare }],
          });
          yield* until((rows) =>
            rows.some((row) => row.project === "P_PROD" && row.state === "skipped"),
          );
          assert.deepStrictEqual(
            (yield* deploys).filter((row) => row.project === "P_PROD").map(({ reason }) => reason),
            [`web has no zerops.yaml at ${bare.slice(0, 7)}`],
          );
        }),
      ),
    );

    // Main C15: a new release, a rollback too, asks production again even over a failed deploy of
    // the same commit — the build's own failure, which no other event asks for again (B37).
    it.effect("deploys again a commit whose build failed once a new release lists it", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          yield* withProduction(appId, world);
          const releases = yield* Releases;
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          tiers.set(`${appId}/production`, tierOf(...runtime(appId, "web")));
          const web = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          const entries = [{ service: "web", sha: web }];
          const atProduction = (state: string) => (rows: ReadonlyArray<JobRow>) =>
            rows.at(-1)?.project === "P_PROD" && rows.at(-1)?.state === state;
          world.outcome = () => "BUILD_FAILED";
          yield* releases.release("dev", appId, { tag: "v0.1.0", groupHead, entries });
          yield* until(atProduction("failed"));
          world.outcome = () => "ACTIVE";
          yield* releases.release("dev", appId, { tag: "v0.1.1", groupHead, entries });
          yield* until(atProduction("live"));
          assert.deepStrictEqual(
            (yield* deploys)
              .filter((row) => row.project === "P_PROD")
              .map(({ state, requested_by }) => [state, requested_by]),
            [
              ["failed", "dev"],
              ["live", "dev"],
            ],
          );
          assert.deepStrictEqual(
            versions(world).filter((name) => name.startsWith("v")),
            [`v0.1.0 ${web.slice(0, 7)}`, `v0.1.1 ${web.slice(0, 7)}`],
          );
        }),
      ),
    );
  });
});

// The deploy-jobs design: every deploy record of before is a job — a live one live, with the
// version it runs where HQ kept it; a build's own failure final; a build HQ submitted followed by
// its version and job; one waiting or refused by HQ ended refused, for Run again.
describe("migration 0032", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect("makes every deploy record of before a job, by its state", () =>
      Effect.gen(function* () {
        const url = yield* (yield* TempPostgres).createDatabase;
        yield* Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* migrate(treeMigrations().filter(({ name }) => name < "0032"));
          const [app] = yield* sql<{ readonly id: string }>`
            INSERT INTO hq_app (name, created_by) VALUES ('Shop', 'owner')
            RETURNING id::text AS id`;
          yield* sql`
            INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
            VALUES ('P_STAGE', ${app!.id}::uuid, 'stage', 'owner')`;
          yield* sql`
            INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by)
            VALUES ('P_STAGE', ${app!.id}::uuid, 'stage', 'shop-stage', '{main}', 'owner')`;
          const sha = (n: number) => String(n).repeat(40);
          const rows: ReadonlyArray<{
            readonly service: string;
            readonly state: string;
            readonly failure: string | null;
            readonly message: string | null;
            readonly version: string | null;
            readonly process: string | null;
            readonly serviceId: string | null;
          }> = [
            {
              service: "live",
              state: "live",
              failure: null,
              message: null,
              version: "V1",
              process: "J1",
              serviceId: "S1",
            },
            {
              service: "legacy",
              state: "live",
              failure: null,
              message: null,
              version: null,
              process: null,
              serviceId: null,
            },
            {
              service: "built",
              state: "failed",
              failure: "job",
              message: "failed: npm",
              version: "V2",
              process: "J2",
              serviceId: "S2",
            },
            {
              service: "refused",
              state: "failed",
              failure: "refused",
              message: "Zerops did not answer",
              version: null,
              process: null,
              serviceId: "S3",
            },
            {
              service: "waiting",
              state: "pending",
              failure: null,
              message: null,
              version: null,
              process: null,
              serviceId: null,
            },
            {
              service: "building",
              state: "deploying",
              failure: null,
              message: null,
              version: "V4",
              process: "J4",
              serviceId: "S4",
            },
            {
              service: "uploading",
              state: "deploying",
              failure: null,
              message: null,
              version: "V5",
              process: null,
              serviceId: "S5",
            },
          ];
          for (const [i, row] of rows.entries()) {
            yield* sql`
              INSERT INTO hq_deploy (project_id, service, sha, repo, state, failure, message,
                app_version_id, process_id, service_id)
              VALUES ('P_STAGE', ${row.service}, ${sha(i + 1)}, ${row.service}, ${row.state},
                ${row.failure}, ${row.message}, ${row.version}, ${row.process}, ${row.serviceId})`;
          }
          yield* migrate(treeMigrations());
          assert.deepStrictEqual(
            yield* sql`
              SELECT service, state, reason, app_version_id, process_id, service_id,
                ended_at IS NOT NULL AS ended, submitted_at IS NOT NULL AS submitted
              FROM hq_deploy_job ORDER BY service`,
            [
              {
                service: "building",
                state: "building",
                reason: null,
                app_version_id: "V4",
                process_id: "J4",
                service_id: "S4",
                ended: false,
                submitted: true,
              },
              {
                service: "built",
                state: "failed",
                reason: "failed: npm",
                app_version_id: "V2",
                process_id: "J2",
                service_id: "S2",
                ended: true,
                submitted: false,
              },
              {
                service: "legacy",
                state: "live",
                reason: null,
                app_version_id: null,
                process_id: null,
                service_id: null,
                ended: true,
                submitted: false,
              },
              {
                service: "live",
                state: "live",
                reason: null,
                app_version_id: "V1",
                process_id: "J1",
                service_id: "S1",
                ended: true,
                submitted: false,
              },
              {
                service: "refused",
                state: "refused",
                reason: "Zerops did not answer — Run again asks for it.",
                app_version_id: null,
                process_id: null,
                service_id: "S3",
                ended: true,
                submitted: false,
              },
              {
                service: "uploading",
                state: "submitting",
                reason: null,
                app_version_id: "V5",
                process_id: null,
                service_id: "S5",
                ended: false,
                submitted: true,
              },
              {
                service: "waiting",
                state: "refused",
                reason: "Run again asks for it.",
                app_version_id: null,
                process_id: null,
                service_id: null,
                ended: true,
                submitted: false,
              },
            ],
          );
          assert.deepStrictEqual(
            yield* sql`SELECT cause, planned_at IS NOT NULL AS planned FROM hq_rollout`,
            [{ cause: "migrated", planned: true }],
          );
          assert.deepStrictEqual(yield* sql`SELECT to_regclass('hq_deploy') IS NULL AS gone`, [
            { gone: true },
          ]);
        }).pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) })));
      }),
    );
  });
});
