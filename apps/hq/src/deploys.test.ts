// @effect-diagnostics nodeBuiltinImport:off -- each test's git root is a temporary directory.
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeZlib from "node:zlib";

import { assert, describe, it } from "@effect/vitest";
import type { RecipeTierResponse } from "@t3tools/shared/hqRecipe";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
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
import { RecipeTiers } from "./recipeTiers.ts";
import { Releases, releasesLayer } from "./releases.ts";
import { Roles } from "./roles.ts";
import { ZeropsApi, ZeropsDeploy, type ZeropsMember } from "./zerops/api.ts";

const AUTHOR = { name: "Ada", email: "ada@mate.test" };
const ZEROPS_YAML = "zerops:\n  - setup: web\n    run:\n      start: node index.js\n";
const FAST: DeploysOptions = {
  pollEvery: Duration.millis(20),
  patience: Duration.millis(800),
  catchUpEvery: Duration.hours(1),
};
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

interface Rig {
  readonly appId: string;
  readonly world: FakeWorld;
  /** Each application's tiers, by `<appId>/<tier>`. */
  readonly tiers: Map<string, RecipeTierResponse>;
  /**
   * Commits `files` to `main` of `repo`, made with its first commit; the new head, once HQ has
   * recorded main moving.
   */
  readonly commit: (repo: string, files: Readonly<Record<string, string>>) => Effect.Effect<string>;
  /** The deploys HQ records, oldest first. */
  readonly deploys: Effect.Effect<
    ReadonlyArray<{
      readonly project: string;
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
  use: (rig: Rig) => Effect.Effect<A, E, Deploys | Releases | SqlClient.SqlClient>,
  options: DeploysOptions = FAST,
) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const root = yield* Effect.acquireRelease(
      Effect.sync(() => NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "hq-deploys-"))),
      (dir) => Effect.sync(() => NodeFS.rmSync(dir, { recursive: true, force: true })),
    );
    const world = emptyWorld();
    const tiers = new Map<string, RecipeTierResponse>();
    const context = yield* Layer.build(
      deploysLayer(options).pipe(
        Layer.provideMerge(releasesLayer),
        Layer.provideMerge(gitHostLayer({ rootDir: root })),
        Layer.provideMerge(activeCoreLayer(url)),
        Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(world))),
        Layer.provide(Layer.succeed(ZeropsDeploy, fakeZeropsDeploy(world))),
        Layer.provide(
          Layer.succeed(Roles, {
            view: Effect.succeed({ ...ORG_VIEW, freshness: "cached" as const }),
            fresh: Effect.succeed({ ...ORG_VIEW, freshness: "fresh" as const }),
            recent: Effect.succeed({ ...ORG_VIEW, freshness: "cached" as const }),
            exists: () => Effect.succeed(true),
          }),
        ),
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
      readonly project: string;
      readonly service: string;
      readonly sha: string;
      readonly state: string;
      readonly failure: string | null;
      readonly message: string | null;
    }>`
      SELECT project_id AS project, service, sha, state, failure, message FROM hq_deploy
      ORDER BY created_at, service`.pipe(Effect.orDie);
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
    yield* sql`
      INSERT INTO hq_deploy_token (project_id, token, kept_by) VALUES ('P_PROD', 'key-prod', 'owner')`;
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

    // A key is checked again at every hand-over: one that now reaches more than its project, or no
    // longer answers, is no key — the deploy is refused in main's words (E08), never attempted.
    it.effect("refuses a deploy with a key that now reaches more, or no longer answers", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          const deploysService = yield* Deploys;
          const sql = yield* SqlClient.SqlClient;
          const kept = world.tokens.get("key-stage")!;
          const invalid = Effect.map(
            sql<{ readonly invalid: boolean }>`
              SELECT invalid_since IS NOT NULL AS invalid FROM hq_deploy_token`,
            (rows) => rows[0]?.invalid,
          );
          const refusedWith = (message: string) => (rows: Effect.Success<typeof deploys>) =>
            rows.length === 1 && rows[0]?.failure === "refused" && rows[0].message === message;
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          // Widened past its project (the platform lets a token raise its own role).
          world.tokens.set("key-stage", { ...kept, roleCode: "READ_ONLY" });
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(
            refusedWith(
              "shop-stage's deploy token reaches more than its project; an admin who opens the projects page in Zerops Mate mints a new one",
            ),
          );
          assert.isTrue(yield* invalid);
          // Dead.
          world.tokens.delete("key-stage");
          yield* deploysService.catchUp;
          yield* until(
            refusedWith(
              "shop-stage's deploy token no longer answers; an admin who opens the projects page in Zerops Mate mints a new one",
            ),
          );
          assert.deepStrictEqual(versions(world), []);
          // Zerops not answering says nothing of the key: refused, not marked.
          world.tokens.set("key-stage", kept);
          yield* deploysService.catchUp;
          yield* until(settled("live"));
          assert.isFalse(yield* invalid);
        }),
      ),
    );

    it.effect("does not mark a key Zerops could not be asked about", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          const sql = yield* SqlClient.SqlClient;
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.down = true;
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("failed"));
          assert.match((yield* deploys)[0]?.message ?? "", /^Zerops did not answer/u);
          const [token] = yield* sql<{ readonly invalid: boolean }>`
            SELECT invalid_since IS NOT NULL AS invalid FROM hq_deploy_token`;
          assert.isFalse(token?.invalid);
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
      withDeploys(
        ({ appId, world, tiers, commit, until }) =>
          Effect.gen(function* () {
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            world.outcome = () => "BUILDING";
            const first = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            yield* until(settled("deploying"));
            yield* commit("web", { "index.js": "two\n" });
            const third = yield* commit("web", { "index.js": "three\n" });
            yield* until((rows) => rows.some((row) => row.sha === third));
            world.outcome = () => "ACTIVE";
            yield* until((rows) => rows.some((row) => row.sha === third && row.state === "live"));
            assert.deepStrictEqual(versions(world), [
              `main ${first.slice(0, 7)}`,
              `main ${third.slice(0, 7)}`,
            ]);
          }),
        // The first deploy is still running when the later commits come, however slow they are.
        { ...FAST, patience: Duration.seconds(30) },
      ),
    );

    // Main B36/B37: a build's own failure is final, but a person who develops the application asks
    // for it again ("Run again"): that commit is deployed once more, and the record says who asked.
    it.effect("deploys again a commit whose build failed, once a developer asks", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          const deploysService = yield* Deploys;
          const sql = yield* SqlClient.SqlClient;
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          world.outcome = () => "BUILD_FAILED";
          const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("failed"));
          world.outcome = () => "ACTIVE";
          const ask = (
            userId: string,
            over: { readonly name?: string; readonly sha?: string } = {},
          ) =>
            deploysService
              .redeploy(userId, appId, over.name ?? "shop-stage", "web", over.sha ?? sha)
              .pipe(
                Effect.match({
                  onSuccess: () => "ok",
                  onFailure: (error) => ("reason" in error ? String(error.reason) : error._tag),
                }),
              );
          assert.deepStrictEqual(
            [
              yield* ask("stranger"),
              yield* ask("viewer"),
              yield* ask("dev", { name: "production" }),
              yield* ask("dev", { sha: "f".repeat(40) }),
            ],
            ["app_not_seen", "not_app_developer", "environment_not_found", "deploy_not_found"],
          );
          assert.strictEqual(yield* ask("dev"), "ok");
          yield* until(settled("live"));
          assert.lengthOf(versions(world), 2);
          const [asked] = yield* sql<{ readonly requested_by: string | null }>`
            SELECT requested_by FROM hq_deploy`;
          assert.strictEqual(asked?.requested_by, "dev");
          // Only a failed deploy is asked for again.
          assert.strictEqual(yield* ask("dev"), "deploy_not_failed");
          assert.lengthOf(yield* deploys, 1);
        }),
      ),
    );

    // T13: an environment the migration brought, held until a person asks where it does not run what
    // it is wanted at; its first key deploys nothing either way.
    const imported = (world: FakeWorld) =>
      Effect.gen(function* () {
        const sql = yield* SqlClient.SqlClient;
        // Keyless, as the import leaves it; HQ reads it with its own org credential.
        yield* sql`DELETE FROM hq_deploy_token WHERE project_id = 'P_STAGE'`;
        world.tokens.set("hq", {
          id: "T_HQ",
          name: "mate-hq-org:HQ",
          orgId: "ORG",
          roleCode: "READ_ONLY",
          canCreateProjects: false,
          canViewFinances: false,
          canEditFinances: false,
          projects: [],
          createdMs: 0,
          createdByUser: "owner",
        });
        const firstKey = Effect.andThen(
          sql`
            INSERT INTO hq_deploy_token (project_id, token, kept_by)
            VALUES ('P_STAGE', 'key-stage', 'owner')`,
          (yield* Deploys).catchUp,
        );
        return { firstKey };
      }).pipe(Effect.orDie);
    const running = (world: FakeWorld, name: string) => {
      const web = world.services.find((service) => service.id === "S-web")!;
      Object.assign(web, { named: { id: "V-imported", name }, activeVersionId: "V-imported" });
    };

    it.effect(
      "holds an imported environment that runs another commit; a Run brings it to that one",
      () =>
        withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
          Effect.gen(function* () {
            const { firstKey } = yield* imported(world);
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            const older = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML, "a.txt": "a\n" });
            // A keyless pass came first: its record is HQ's own, pending or refused for want of a key,
            // which the next pass would ask again.
            yield* until((rows) => rows.some((row) => row.sha === sha));
            const before = (yield* deploys).find((row) => row.sha === sha);
            assert.notStrictEqual(before?.failure, "job");
            running(world, `main ${older.slice(0, 7)}`);
            const report = yield* (yield* Deploys).hold(["P_STAGE"], Redacted.make("hq"));
            const message = `Held at migration: web runs ${older.slice(0, 7)}; Run brings it to ${sha.slice(0, 7)}.`;
            assert.deepStrictEqual(report, [
              {
                projectId: "P_STAGE",
                name: "shop-stage",
                services: [{ service: "web", sha, state: "held", runs: older.slice(0, 7) }],
              },
            ]);
            yield* firstKey;
            assert.deepStrictEqual(
              (yield* deploys)
                .filter((row) => row.sha === sha)
                .map((row) => [row.state, row.failure, row.message]),
              [["failed", "job", message]],
            );
            assert.deepStrictEqual(versions(world), []);
            yield* (yield* Deploys).redeploy("owner", appId, "shop-stage", "web", sha);
            yield* until((rows) => rows.some((row) => row.sha === sha && row.state === "live"));
            assert.deepStrictEqual(versions(world), [`main ${sha.slice(0, 7)}`]);
          }),
        ),
    );

    it.effect(
      "calls an imported environment at its target live, and its first key deploys nothing",
      () =>
        withDeploys(({ appId, world, tiers, commit, deploys }) =>
          Effect.gen(function* () {
            const { firstKey } = yield* imported(world);
            tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
            const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
            // Main's own broker named it so: the bare whole sha.
            running(world, sha);
            const report = yield* (yield* Deploys).hold(["P_STAGE"], Redacted.make("hq"));
            assert.deepStrictEqual(report, [
              {
                projectId: "P_STAGE",
                name: "shop-stage",
                services: [{ service: "web", sha, state: "live", runs: sha.slice(0, 7) }],
              },
            ]);
            yield* firstKey;
            assert.deepStrictEqual(
              (yield* deploys).map((row) => [row.sha, row.state]),
              [[sha, "live"]],
            );
            assert.deepStrictEqual(versions(world), []);
          }),
        ),
    );

    it.effect("says what an imported service runs when its version's name spells no commit", () =>
      withDeploys(({ appId, world, tiers, commit, deploys }) =>
        Effect.gen(function* () {
          yield* imported(world);
          tiers.set(`${appId}/stage`, stageTier(appId, [{ hostname: "web" }]));
          const sha = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          running(world, "hotfix by hand");
          yield* (yield* Deploys).hold(["P_STAGE"], Redacted.make("hq"));
          assert.deepStrictEqual(
            (yield* deploys).map((row) => row.message),
            [`Held at migration: web runs hotfix by hand; Run brings it to ${sha.slice(0, 7)}.`],
          );
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
          const deploysService = yield* Deploys;
          const reasonOf = (sha: string) =>
            deploysService.redeploy("dev", appId, "shop-stage", "web", sha).pipe(
              Effect.match({
                onSuccess: () => "ok",
                onFailure: (error) => ("reason" in error ? String(error.reason) : error._tag),
              }),
            );
          assert.strictEqual(yield* reasonOf(first), "deploy_superseded");
        }),
      ),
    );

    // Main D15, with what HQ saw of a tier kept in its database: a tier first seen is the one its
    // environments were made from, and imports nothing; a later change imports into every
    // environment of the tier the services it lacks — a runtime created empty, for HQ deploys it,
    // a managed one as declared. After a restart the first pass is a pass like any other (D16).
    it.effect("imports what a changed tier adds into its environments, created empty", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          const deploysService = yield* Deploys;
          const sql = yield* SqlClient.SqlClient;
          const digest = Effect.map(
            sql<{ readonly digest: string }>`SELECT digest FROM hq_recipe_seen`,
            (rows) => rows.map((row) => row.digest),
          );
          tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web"), ...runtime(appId, "api")));
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("live"));
          yield* deploysService.catchUp;
          // First seen: api is reported, not imported.
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
          yield* deploysService.catchUp;
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
          assert.notDeepEqual(yield* digest, first);
          // Seen: no second import.
          yield* deploysService.catchUp;
          assert.lengthOf(world.imports, 1);
        }),
      ),
    );

    // Main D15: a changed declaration of a service the project has is reported, never applied, and
    // a service the tier no longer declares is reported, never deleted.
    it.effect("never applies a changed declaration, nor deletes a service the tier drops", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          const deploysService = yield* Deploys;
          world.services.push(fakeService("worker", { http: false }));
          tiers.set(
            `${appId}/stage`,
            tierOf(...runtime(appId, "web"), ...runtime(appId, "worker")),
          );
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until((rows) => rows.some((row) => row.state === "live"));
          yield* deploysService.catchUp;
          tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web", "    minContainers: 2")));
          yield* deploysService.catchUp;
          assert.deepStrictEqual(world.imports, []);
          assert.deepStrictEqual(
            world.services.map((service) => service.name),
            ["web", "worker"],
          );
        }),
      ),
    );

    // A delta not imported everywhere is asked again: what HQ saw stays the tier before it.
    it.effect("asks a delta again until every environment of the tier has it", () =>
      withDeploys(({ appId, world, tiers, commit, until }) =>
        Effect.gen(function* () {
          const deploysService = yield* Deploys;
          const sql = yield* SqlClient.SqlClient;
          tiers.set(`${appId}/stage`, tierOf(...runtime(appId, "web")));
          yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          yield* until(settled("live"));
          yield* deploysService.catchUp;
          const kept = world.tokens.get("key-stage")!;
          world.tokens.delete("key-stage");
          tiers.set(
            `${appId}/stage`,
            tierOf(...runtime(appId, "web"), "  - hostname: cache", "    type: valkey@7.2"),
          );
          yield* deploysService.catchUp;
          assert.deepStrictEqual(world.imports, []);
          world.tokens.set("key-stage", kept);
          yield* sql`UPDATE hq_deploy_token SET invalid_since = NULL`;
          yield* deploysService.catchUp;
          assert.lengthOf(world.imports, 1);
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

    // SPEC §3.2d, main C15/C16/B16: an approved release deploys every production environment, each
    // service at the commit the release lists, named `{tag} <7 hex>`; production follows the
    // newest approved release by version, and a rollback is the newest.
    it.effect(
      "deploys an approved release to production, and follows the newest by version, rollbacks too",
      () =>
        withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
          Effect.gen(function* () {
            yield* withProduction(appId, world);
            const releases = yield* Releases;
            const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
            tiers.set(`${appId}/production`, tierOf(...runtime(appId, "web")));
            const one = yield* commit("web", { "zerops.yaml": ZEROPS_YAML, "index.js": "1\n" });
            const atProduction = (sha: string) => (rows: Effect.Success<typeof deploys>) =>
              rows.some(
                (row) => row.project === "P_PROD" && row.sha === sha && row.state === "live",
              );
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
              [
                `v0.1.0 ${one.slice(0, 7)}`,
                `v0.2.0 ${two.slice(0, 7)}`,
                `v0.2.1 ${one.slice(0, 7)}`,
              ],
            );
          }),
        ),
    );

    // Main C16: a production service the release does not list is reported and not deployed; the
    // rest deploy. No approved release deploys nothing, and is no failure.
    it.effect("deploys what the release lists of production, and nothing before a release", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
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
          yield* (yield* Deploys).catchUp;
          assert.deepStrictEqual(
            (yield* sql`SELECT service FROM hq_deploy WHERE project_id = 'P_PROD'`).length,
            0,
          );
          yield* (yield* Releases).release("dev", appId, {
            tag: "v0.1.0",
            groupHead,
            entries: [{ service: "web", sha: web }],
          });
          yield* until((rows) =>
            rows.some((row) => row.project === "P_PROD" && row.state === "live"),
          );
          yield* (yield* Deploys).catchUp;
          assert.deepStrictEqual(
            (yield* deploys)
              .filter((row) => row.project === "P_PROD")
              .map(({ service, sha, state }) => [service, sha, state]),
            [["web", web, "live"]],
          );

          // A rollback carries a service production no longer builds: reported, the rest deploy.
          const next = yield* commit("web", { "index.js": "next\n" });
          yield* sql`
            INSERT INTO hq_release (app_id, tag, sha, entries, released_by, state, rollback_of)
            VALUES (${appId}::uuid, 'v0.1.1', ${groupHead},
              ${`[{"service":"web","sha":"${next}"},{"service":"gone","sha":"${web}"}]`}::jsonb,
              'dev', 'approved', 'v0.0.9')`;
          yield* (yield* Deploys).catchUp;
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

    // Main C15: a new release, a rollback too, asks production again even over a failed deploy of
    // the same commit — the build's own failure, which no pass retries by itself (B37).
    it.effect("deploys again a commit whose build failed once a new release lists it", () =>
      withDeploys(({ appId, world, tiers, commit, deploys, until }) =>
        Effect.gen(function* () {
          yield* withProduction(appId, world);
          const releases = yield* Releases;
          const sql = yield* SqlClient.SqlClient;
          const groupHead = yield* commit("group", { "README.md": "# Shop\n" });
          tiers.set(`${appId}/production`, tierOf(...runtime(appId, "web")));
          const web = yield* commit("web", { "zerops.yaml": ZEROPS_YAML });
          const entries = [{ service: "web", sha: web }];
          const atProduction = (state: string) => (rows: Effect.Success<typeof deploys>) =>
            rows.some((row) => row.project === "P_PROD" && row.sha === web && row.state === state);
          world.outcome = () => "BUILD_FAILED";
          yield* releases.release("dev", appId, { tag: "v0.1.0", groupHead, entries });
          yield* until(atProduction("failed"));
          world.outcome = () => "ACTIVE";
          yield* releases.release("dev", appId, { tag: "v0.1.1", groupHead, entries });
          yield* until(atProduction("live"));
          assert.deepStrictEqual(
            yield* sql`
              SELECT requested_by FROM hq_deploy WHERE project_id = 'P_PROD' AND sha = ${web}`,
            [{ requested_by: "dev" }],
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
