// @effect-diagnostics nodeBuiltinImport:off -- each test's git root is a temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

import { assert, describe, it } from "@effect/vitest";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import {
  type FakeService,
  type FakeWorld,
  emptyWorld,
  fakeZeropsApi,
  fakeZeropsDeploy,
} from "../test/harness/zeropsFake.ts";
import { Deploys, type DeploysOptions, deploysLayer } from "./deploys.ts";
import { GitHost, gitHostLayer } from "./gitHost.ts";
import { type RecipeTierRead, RecipeTiers } from "./recipeTiers.ts";
import { ZeropsApi, ZeropsDeploy } from "./zerops/api.ts";

const AUTHOR = { name: "Ada", email: "ada@mate.test" };
const ZEROPS_YAML = "zerops:\n  - setup: web\n    run:\n      start: node index.js\n";
const FAST: DeploysOptions = {
  pollEvery: Duration.millis(20),
  patience: Duration.millis(800),
  catchUpEvery: Duration.hours(1),
};
const ABSENT: RecipeTierRead = { state: "absent" };

/** A stage tier whose runtimes are `services`, each built from the application's repository of its name. */
const stageTier = (
  appId: string,
  services: ReadonlyArray<{ readonly hostname: string; readonly priority?: number }>,
): RecipeTierRead => ({
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

interface Rig {
  readonly appId: string;
  readonly world: FakeWorld;
  /** Each application's tiers, by `<appId>/<tier>`. */
  readonly tiers: Map<string, RecipeTierRead>;
  /**
   * Commits `files` to `main` of `repo`, made with its first commit; the new head, once HQ has
   * recorded main moving.
   */
  readonly commit: (repo: string, files: Readonly<Record<string, string>>) => Effect.Effect<string>;
  /** The deploys HQ records, oldest first. */
  readonly deploys: Effect.Effect<
    ReadonlyArray<{
      readonly service: string;
      readonly sha: string;
      readonly state: string;
      readonly failure: string | null;
      readonly message: string | null;
    }>
  >;
  /** Waits until the records satisfy `found`. */
  readonly until: (
    found: (deploys: Effect.Success<Rig["deploys"]>) => boolean,
  ) => Effect.Effect<void>;
}

/**
 * The deploy engine leading over a fresh database and git root: the application Shop with the
 * stage environment `shop-stage` (project P_STAGE, its deploy token kept), a Zerops whose P_STAGE
 * has the service `web`, and Shop's stage tier as `tiers` holds it.
 */
const withDeploys = <A, E>(
  use: (rig: Rig) => Effect.Effect<A, E, Deploys | SqlClient.SqlClient>,
  options: DeploysOptions = FAST,
) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-deploys-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const world = emptyWorld();
    const tiers = new Map<string, RecipeTierRead>();
    const context = yield* Layer.build(
      deploysLayer(options).pipe(
        Layer.provideMerge(gitHostLayer({ rootDir: root })),
        Layer.provideMerge(activeCoreLayer(url)),
        Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(world))),
        Layer.provide(Layer.succeed(ZeropsDeploy, fakeZeropsDeploy(world))),
        Layer.provide(
          Layer.succeed(RecipeTiers, {
            read: (appId, tier) => Effect.succeed(tiers.get(`${appId}/${tier}`) ?? ABSENT),
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
      VALUES ('P_STAGE', ${appId}::uuid, 'stage', 'owner')`;
    yield* sql`
      INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by)
      VALUES ('P_STAGE', ${appId}::uuid, 'stage', 'shop-stage', '{main}', 'owner')`;
    yield* sql`
      INSERT INTO hq_deploy_token (project_id, token, kept_by) VALUES ('P_STAGE', 'key-stage', 'owner')`;
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
    const commit = (repo: string, files: Readonly<Record<string, string>>) =>
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
    const deploys = sql<{
      readonly service: string;
      readonly sha: string;
      readonly state: string;
      readonly failure: string | null;
      readonly message: string | null;
    }>`
      SELECT service, sha, state, failure, message FROM hq_deploy ORDER BY created_at, service`.pipe(
      Effect.orDie,
    );
    const until = (found: (rows: Effect.Success<typeof deploys>) => boolean) =>
      deploys.pipe(
        Effect.filterOrFail(found, () => "not yet"),
        Effect.retry(Schedule.spaced(Duration.millis(20))),
        Effect.timeout(Duration.seconds(10)),
        Effect.asVoid,
        Effect.orDie,
      );
    return yield* use({ appId, world, tiers, commit, deploys, until }).pipe(
      Effect.provide(context),
    );
  });

const settled = (state: string) => (rows: ReadonlyArray<{ readonly state: string }>) =>
  rows.length > 0 && rows.every((row) => row.state === state);

/** The names of every version Zerops was asked to make, in order. */
const versions = (world: FakeWorld) =>
  [...world.appVersions.values()].map((version) => version.name);

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

    // The structure's readers hear of every change of a deploy's record (`stream.ts`).
    it.effect("ticks as a deploy's record changes", () =>
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

    // Main B10/B11/B19: an environment's services one after another, higher priority first; a
    // service of a repository whose main has not moved is not deployed again.
    it.effect("deploys an environment's services in the tier's priority order", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          world.services.push(fakeService("api"));
          const web = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          const api = yield* commit("api", { "zerops.yaml": ZEROPS_YAML });
          tiers.set(
            `${appId}/stage`,
            stageTier(appId, [{ hostname: "web" }, { hostname: "api", priority: 5 }]),
          );
          yield* (yield* Deploys).catchUp;
          yield* until((rows) => rows.length === 2 && settled("live")(rows));
          assert.deepStrictEqual(versions(world), [
            `main ${api.slice(0, 7)}`,
            `main ${web.slice(0, 7)}`,
          ]);
        }),
      ),
    );

    // Main E08: without the environment's key HQ deploys nothing, saying so in main's words; a key
    // kept afterwards lets the next pass deploy.
    it.effect(
      "refuses a deploy without the environment's key, in main's words, and deploys once one is kept",
      () =>
        withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
          Effect.gen(function* () {
            const sql = yield* SqlClient.SqlClient;
            yield* sql`DELETE FROM hq_deploy_token`;
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("failed"));
            assert.deepStrictEqual(
              (yield* deploys).map(({ failure, message }) => [failure, message]),
              [
                [
                  "refused",
                  "shop-stage has no deploy token yet; an admin who opens the projects page in Zerops Mate mints it",
                ],
              ],
            );
            assert.deepStrictEqual(versions(world), []);
            yield* sql`
            INSERT INTO hq_deploy_token (project_id, token, kept_by) VALUES ('P_STAGE', 'key-stage', 'owner')`;
            yield* (yield* Deploys).catchUp;
            yield* until(settled("live"));
          }),
        ),
    );

    // Main B37/B38: a build's own failure is final — no pass deploys that commit again; HQ's own
    // refusal is asked again by the next pass.
    it.effect(
      "never deploys a commit whose build failed again by itself, and retries its own refusal",
      () =>
        withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
          Effect.gen(function* () {
            const deploysService = yield* Deploys;
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            world.outcome = () => "BUILD_FAILED";
            yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("failed"));
            assert.deepStrictEqual(
              (yield* deploys).map(({ failure, message }) => [failure, message]),
              [["job", "failed: Build failed: npm run build exited 1"]],
            );
            world.outcome = () => "ACTIVE";
            yield* deploysService.catchUp;
            yield* Effect.sleep(Duration.millis(200));
            assert.lengthOf(versions(world), 1);

            world.down = true;
            const second = yield* commit("web", { "index.js": "two\n" });
            yield* until((rows) =>
              rows.some((row) => row.sha === second && row.failure === "refused"),
            );
            world.down = false;
            yield* deploysService.catchUp;
            yield* until((rows) => rows.some((row) => row.sha === second && row.state === "live"));
          }),
        ),
    );

    // Main B17: live is what the service runs, read back; a deploy that ends while it runs another
    // commit failed.
    it.effect("calls a deploy live only once the service runs that commit", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          // Someone else's version takes the service as the job ends.
          world.outcome = (version) => {
            const service = world.services.find((candidate) => candidate.id === version.serviceId);
            if (service !== undefined) service.named = { id: "V-other", name: "main 1234567" };
            return "ACTIVE";
          };
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("failed"));
          assert.deepStrictEqual(
            (yield* deploys).map(({ failure, message }) => [failure, message]),
            [["job", 'the deploy finished, but web runs "1234567"']],
          );
        }),
      ),
    );

    // Main B17/E13: an HTTP service gets its subdomain after a verified deploy, with the
    // environment's own key; one serving no HTTP never does.
    it.effect("turns on an HTTP service's subdomain after its deploy, and no other's", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          world.services.push(fakeService("worker", { http: false }));
          tiers.set(
            `${appId}/stage`,
            stageTier(appId, [{ hostname: "web" }, { hostname: "worker" }]),
          );
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* commit("worker", { "zerops.yaml": ZEROPS_YAML });
          yield* (yield* Deploys).catchUp;
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

    // Main B20: one queue per environment, the newest commit wins — commits main moved past while
    // a deploy ran are never deployed.
    it.effect("deploys only the newest commit once a running deploy ends", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILDING";
          const first = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* Effect.sleep(Duration.millis(150));
          yield* commit("web", { "index.js": "two\n" });
          const third = yield* commit("web", { "index.js": "three\n" });
          yield* Effect.sleep(Duration.millis(150));
          world.outcome = () => "ACTIVE";
          yield* until((rows) => rows.some((row) => row.sha === third && row.state === "live"));
          assert.deepStrictEqual(versions(world), [
            `main ${first.slice(0, 7)}`,
            `main ${third.slice(0, 7)}`,
          ]);
        }),
      ),
    );

    // Main B38: a deploy still running past its patience is deployed again by the next pass.
    it.effect("deploys again a deploy still running past its patience", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILDING";
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("deploying"));
          yield* (yield* Deploys).catchUp;
          assert.lengthOf(versions(world), 1);
          yield* Effect.sleep(FAST.patience ?? Duration.zero);
          world.outcome = () => "ACTIVE";
          yield* (yield* Deploys).catchUp;
          yield* until(settled("live"));
          assert.lengthOf(versions(world), 2);
        }),
      ),
    );

    // A commit with no `zerops.yaml` (zcli's first name, then `zerops.yml`) cannot deploy: its own
    // failure.
    it.effect("fails a commit with no zerops.yaml, and deploys one with a zerops.yml", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          const bare = yield* commit("web", { "index.js": "one\n" });
          yield* until(settled("failed"));
          assert.deepStrictEqual(
            (yield* deploys).map(({ failure, message }) => [failure, message]),
            [["job", `web has no zerops.yaml at ${bare.slice(0, 7)}`]],
          );
          yield* commit("web", { "zerops.yml": ZEROPS_YAML });
          yield* until((rows) => rows.some((row) => row.state === "live"));
          assert.strictEqual([...world.appVersions.values()][0]?.zeropsYaml, ZEROPS_YAML);
        }),
      ),
    );

    // An application with no stage tier deploys nothing; a production follows releases (T9), never
    // main.
    it.effect("deploys nothing without a stage tier, and no production", () =>
      withDeploys(({ appId, world, tiers, commit, deploys }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* (yield* Deploys).catchUp;
          yield* Effect.sleep(Duration.millis(200));
          assert.deepStrictEqual(yield* deploys, []);

          yield* sql`DELETE FROM hq_environment`;
          yield* sql`UPDATE hq_app_project SET kind = 'production' WHERE project_id = 'P_STAGE'`;
          yield* sql`
            INSERT INTO hq_environment (project_id, app_id, tier, name, sources, created_by)
            VALUES ('P_STAGE', ${appId}::uuid, 'production', 'shop', '{release}', 'owner')`;
          yield* sql`
            INSERT INTO hq_deploy_token (project_id, token, kept_by)
            VALUES ('P_STAGE', 'key-stage', 'owner')`;
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          tiers.set(`${appId}/production`, stageTier(appId, [{ hostname: "web" }]));
          yield* (yield* Deploys).catchUp;
          yield* Effect.sleep(Duration.millis(200));
          assert.deepStrictEqual(yield* deploys, []);
          assert.deepStrictEqual(versions(world), []);
        }),
      ),
    );
  });
});
