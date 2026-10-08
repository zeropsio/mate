import * as PgClient from "@effect/sql-pg/PgClient";
import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { testKey } from "../test/harness/deployKeys.ts";
import { memoryStore } from "../test/harness/overviews.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { type KeySecret, deployKeysLayer, keySecretOf, openToken } from "./deployKeys.ts";
import { treeMigrations } from "./migrationFiles.ts";
import { migrate } from "./migrations.ts";
import { type OrgView, Roles, WriteConfirm } from "./roles.ts";
import {
  JOBS_SHOWN,
  PRESS_HOLD_MS,
  type MateRecord,
  Structure,
  type StructureRead,
  structureLayer,
} from "./structure.ts";
import { MateOverviews, makeMateOverviews } from "./mateOverviews.ts";
import { type FakeWorld, emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
import { rolloutsLayer } from "./rollouts.ts";
import {
  ZeropsApi,
  type ZeropsMember,
  type ZeropsOwnToken,
  type ZeropsProject,
  ZeropsUnavailable,
} from "./zerops/api.ts";

const member = (userId: string, roleCode: string, canCreateProjects = false): ZeropsMember => ({
  name: userId,
  kind: "person",
  roleCode,
  status: "ACTIVE",
  userId,
  clientUserId: `C-${userId}`,
  canCreateProjects,
});
const project = (id: string, userRoles: ZeropsProject["userRoles"] = []): ZeropsProject => ({
  id,
  orgId: "ORG",
  name: `name of ${id}`,
  status: "ACTIVE",
  tags: [],
  userRoles,
  publicZone: `${id}.prg1-zerops.zone`,
});

/**
 * owner, admin; dev is NO_ACCESS with a grant on P_MATE; reader is org READ_ONLY; nobody is
 * NO_ACCESS; maker is NO_ACCESS who can create projects, Basic user on their new Mate P_OWN and on
 * P_DEV, and Read only on P_TEAM; basic is org Basic user who can create projects, with no grant of their own.
 */
type Org = Omit<OrgView, "freshness">;

/** A Mate's birth before anything marked it. */
const UNBORN = {
  setupMarker: null,
  standupRequestedBy: null,
  closedOff: false,
  keyWider: false,
} as const;

const VIEW: Org = {
  orgId: "ORG",
  members: [
    member("owner", "OWNER"),
    member("admin", "ADMIN"),
    member("dev", "NO_ACCESS"),
    member("reader", "READ_ONLY"),
    member("nobody", "NO_ACCESS"),
    member("maker", "NO_ACCESS", true),
    member("basic", "BASIC_USER", true),
  ],
  projects: [
    project("HQ"),
    project("P_MATE", [{ clientUserId: "C-dev", roleCode: "BASIC_USER" }]),
    project("P_STAGE"),
    project("P_PROD"),
    project("P_PROD2"),
    project("P_OWN", [{ clientUserId: "C-maker", roleCode: "BASIC_USER" }]),
    project("P_TEAM", [{ clientUserId: "C-maker", roleCode: "READ_ONLY" }]),
    // maker develops it: an application holding it is maker's to add an environment to.
    project("P_DEV", [{ clientUserId: "C-maker", roleCode: "BASIC_USER" }]),
    project("P_OTHER"),
    // maker made this Mate: Zerops left them its OWNER.
    project("P_OWNED", [{ clientUserId: "C-maker", roleCode: "OWNER" }]),
    // maker's new projects, which race for one place.
    ...["P_RACE1", "P_RACE2", "P_RACE3", "P_RACE4", "P_RACE5", "P_RACE6"].map((id) =>
      project(id, [{ clientUserId: "C-maker", roleCode: "OWNER" }]),
    ),
  ],
};

/**
 * Structure over a fresh database and a Zerops whose view is `view`; a project exists while the
 * view has it, and `down` makes asking for one unanswerable. `zerops` answers what a credential
 * handed to HQ is. `before` writes the database over its own pool before the core migrates it.
 */
const withStructure = <A, E, B = never>(
  use: (
    view: Ref.Ref<Org>,
    down: Ref.Ref<boolean>,
    zerops: FakeWorld,
    /** How each read of the org was asked for, in order. */
    asked: Ref.Ref<ReadonlyArray<string>>,
  ) => Effect.Effect<A, E, Structure | SqlClient.SqlClient>,
  before?: Effect.Effect<void, B, SqlClient.SqlClient>,
  /** HQ's key; the test key by default. */
  keySecret: KeySecret = testKey(),
) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    if (before !== undefined) {
      yield* before.pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) })));
    }
    const view = yield* Ref.make(VIEW);
    const down = yield* Ref.make(false);
    const zerops = emptyWorld();
    const asked = yield* Ref.make<ReadonlyArray<string>>([]);
    const ask = (how: string) => Ref.update(asked, (before) => [...before, how]);
    const roles = Layer.succeed(Roles, {
      view: Effect.andThen(
        ask("view"),
        Effect.map(Ref.get(view), (org) => ({ ...org, freshness: "cached" as const })),
      ),
      // A write's first pass over the recent view, its confirmation over a fresh read (F22).
      forWrite: Effect.gen(function* () {
        const { fresh } = yield* WriteConfirm;
        yield* ask(fresh ? "write fresh" : "write recent");
        const org = yield* Ref.get(view);
        return { ...org, freshness: fresh ? ("fresh" as const) : ("recent" as const) };
      }),
      recent: Effect.andThen(
        ask("recent"),
        Effect.map(Ref.get(view), (org) => ({ ...org, freshness: "cached" as const })),
      ),
      exists: (projectId) =>
        Effect.flatMap(Ref.get(down), (isDown) =>
          isDown
            ? Effect.fail(new ZeropsUnavailable({ operation: "project", message: "down" }))
            : Effect.map(Ref.get(view), (current) =>
                current.projects.some((candidate) => candidate.id === projectId),
              ),
        ),
      answeredAt: Effect.succeed(undefined),
      views: Stream.never,
    });
    const context = yield* Layer.build(
      structureLayer({ hqProjectId: "HQ", credential: Option.some(Redacted.make("org-key")) }).pipe(
        Layer.provide(deployKeysLayer(keySecret)),
        Layer.provideMerge(rolloutsLayer),
        Layer.provideMerge(activeCoreLayer(url)),
        Layer.provide(roles),
        Layer.provide(Layer.effect(MateOverviews, makeMateOverviews(memoryStore().store))),
        Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(zerops))),
      ),
    );
    return yield* Effect.andThen(untilActive, use(view, down, zerops, asked)).pipe(
      Effect.provide(context),
    );
  });

/** The refusal's reason, or the success. */
const reasonOf = <A, E extends { readonly _tag: string }>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.match({
      onSuccess: () => "ok",
      onFailure: (error) => ("reason" in error ? String(error.reason) : error._tag),
    }),
  );

const encodeJson = Schema.encodeSync(Schema.fromJsonString(Schema.Unknown));

/** An environment as a reader sees it, its key not held and nothing deployed. */
const environmentRow = (
  projectId: string,
  tier: "stage" | "production",
  name: string,
  order: number,
) => ({
  projectId,
  tier,
  name,
  sources: tier === "stage" ? ["main"] : ["release"],
  order,
  keyHeld: false,
  keyInvalid: false,
  jobs: [],
  release: null,
  birth: { ended: false },
});

/**
 * Each project of the application named `appName` by id, and its environment's record — its name,
 * sources, order and whether its key is held — as owner reads it.
 */
const environmentsOf = (structure: Structure["Service"], appName: string) =>
  Effect.map(structure.read("owner"), (read) => {
    const app = read.apps.find((candidate) => candidate.name === appName);
    return Object.fromEntries(
      (app?.projects ?? []).map((project) => {
        const environment = (app === undefined ? [] : shown(app.environments)).find(
          (candidate) => candidate.projectId === project.projectId,
        );
        return [
          project.projectId,
          environment === undefined
            ? undefined
            : {
                name: environment.name,
                sources: environment.sources,
                order: environment.order,
                keyHeld: environment.keyHeld,
              },
        ];
      }),
    );
  });

/** An application's environments as a reader of its changes reads them: never refused here. */
const shown = (environments: StructureRead["apps"][number]["environments"]) => {
  if ("refused" in environments) throw new Error(`environments refused: ${environments.refused}`);
  return environments;
};

/** Applications as their records, without what they offer the reader (`offers.test.ts`). */
const recordsOf = (apps: StructureRead["apps"]) =>
  apps.map(({ can: _offers, environments, projects, ...app }) => ({
    ...app,
    projects: projects.map(({ can: _mate, ...project }) => project),
    environments: shown(environments).map(({ can: _offered, ...environment }) => environment),
  }));

/** The refusal's code, or the success. */
const outcome = <A, E extends { readonly _tag: string }>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.match({
      onSuccess: () => "ok",
      onFailure: (error) => ("code" in error ? String(error.code) : error._tag),
    }),
  );

describe("structure", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect.each(
      Array.from([true, false] as const, (marker) => ({
        title: `shares setup marker ${String(marker)} across authorized navigation recipients`,
        marker,
      })),
    )("$title", ({ marker }) =>
      withStructure((_view, _down, world) =>
        Effect.gen(function* () {
          world.projects = [...VIEW.projects];
          world.tokens.set("org-key", {
            id: "core",
            name: "Core",
            orgId: "ORG",
            roleCode: "READ_ONLY",
            canCreateProjects: false,
            canViewFinances: false,
            canEditFinances: false,
            projects: [],
            createdMs: 0,
            createdByUser: null,
          });
          if (marker) world.setupMarkers.add("zcp");
          const structure = yield* Structure;
          yield* structure.createMate("owner", {
            projectId: "P_OWN",
            face: "face",
            serviceId: "zcp",
          });
          const told = yield* Stream.runHead(Stream.drop(structure.changes, 1)).pipe(
            Effect.forkChild,
          );
          yield* Effect.yieldNow;
          yield* structure.navigation;
          yield* Fiber.join(told);
          const known = yield* structure.navigation;
          for (const who of ["owner", "admin", "reader", "maker"])
            assert.strictEqual(
              known.forPerson(who).ungrouped.find((row) => row.projectId === "P_OWN")?.mate
                .setupMarker,
              marker,
            );
          assert.deepStrictEqual(known.forPerson("nobody").ungrouped, []);
          assert.strictEqual(
            world.calls.filter((call) => call.startsWith("mateSetupMarker:")).length,
            1,
          );
          yield* structure.navigation;
          assert.strictEqual(
            world.calls.filter((call) => call.startsWith("mateSetupMarker:")).length,
            1,
          );
          yield* structure.markClosedOff("owner", "P_OWN");
          assert.strictEqual(
            (yield* structure.navigation).forPerson("owner").ungrouped[0]?.mate.closedOff,
            true,
          );
        }),
      ),
    );
    it.effect(
      "a held half-made environment offers finish independently of its occupied add slot",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            for (const [kind, projectId] of [
              ["stage", "P_OWNED"],
              ["production", "P_RACE1"],
              ["devstage", "P_RACE2"],
            ] as const) {
              const app = yield* structure.createApp("owner", kind);
              yield* structure.attachProject("owner", app.id, {
                projectId,
                kind,
                ...(kind === "devstage" ? { mate: { face: "face" } } : {}),
              });
              for (const who of ["owner", "admin", "maker"]) {
                const read = (yield* structure.read(who)).apps.find(
                  (value) => value.id === app.id,
                )!;
                assert.strictEqual(
                  read.can[kind === "production" ? "add_production" : "add_stage"].allow,
                  false,
                );
                const project = read.projects.find((value) => value.projectId === projectId)!;
                assert.strictEqual(project.can?.finish?.allow, who !== "maker", `${kind}: ${who}`);
              }
            }
          }),
        ),
    );
    it.effect(
      "a project's admin who is no writer attaches it as an environment, into an empty place only",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const shop = yield* structure.createApp("owner", "Shop");
            const team = yield* structure.createApp("owner", "Team");
            // maker develops Shop through P_DEV, its stage, and only sees Team through P_TEAM;
            // maker is P_OWNED's owner (SPEC §3.3a).
            yield* structure.attachProject("owner", shop.id, { projectId: "P_DEV", kind: "stage" });
            yield* structure.attachProject("owner", team.id, {
              projectId: "P_TEAM",
              kind: "stage",
            });
            assert.deepStrictEqual(
              yield* Effect.all([
                reasonOf(
                  structure.attachProject("maker", team.id, {
                    projectId: "P_OWNED",
                    kind: "production",
                  }),
                ),
                reasonOf(
                  structure.attachProject("maker", shop.id, {
                    projectId: "P_OWNED",
                    kind: "stage",
                  }),
                ),
                reasonOf(
                  structure.attachProject("dev", shop.id, { projectId: "P_MATE", kind: "stage" }),
                ),
                reasonOf(
                  structure.attachProject("maker", shop.id, {
                    projectId: "P_OWNED",
                    kind: "production",
                  }),
                ),
              ]),
              ["not_app_developer", "slot_taken", "not_project_admin", "ok"],
            );
          }),
        ),
    );

    it.effect(
      "offers each reader what the write decides: a release over the production they do not see",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const shop = yield* structure.createApp("owner", "Shop");
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_MATE",
              kind: "mate",
              mate: { face: "face-1" },
            });
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_PROD",
              kind: "production",
            });
            // dev develops Shop through its Mate and sees nothing of its production: the release
            // is refused for that production, never offered as "no production yet".
            const read = yield* structure.read("dev");
            const app = read.apps.find((candidate) => candidate.id === shop.id);
            assert.deepStrictEqual(
              app?.projects.map((project) => project.projectId),
              ["P_MATE"],
            );
            assert.deepStrictEqual(
              [app?.can.merge_change, app?.can.release, read.can.create_app],
              [
                { allow: true },
                { allow: false, reason: "not_releaser" },
                { allow: false, reason: "not_structure_writer" },
              ],
            );
            assert.deepStrictEqual(
              shown((yield* structure.read("owner")).apps[0]!.environments).map((environment) => [
                environment.projectId,
                environment.can,
              ]),
              [["P_PROD", { keep_deploy_token: { allow: true } }]],
            );
            // The org's writer is offered making an application, and makes one.
            assert.deepStrictEqual((yield* structure.read("owner")).can.create_app, {
              allow: true,
            });
            assert.strictEqual(
              yield* reasonOf(structure.createApp("dev", "Mine")),
              "not_structure_writer",
            );
          }),
        ),
    );

    it.effect("a refused Move reveals no hidden destination occupancy or existence", () =>
      withStructure((_view, down) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const empty = yield* structure.createApp("owner", "Empty");
          const occupied = yield* structure.createApp("owner", "Occupied");
          yield* structure.attachProject("owner", occupied.id, {
            projectId: "P_PROD",
            kind: "production",
          });
          yield* structure.createMate("owner", { projectId: "P_MATE", face: "face" });
          // Even an unavailable existence read must not replace an access refusal.
          yield* Ref.set(down, true);
          for (const [who, expected] of [
            ["dev", "not_structure_writer"],
            ["reader", "not_structure_writer"],
            ["nobody", "not_structure_writer"],
            ["stranger", "not_active_member"],
          ] as const) {
            for (const appId of [empty.id, occupied.id, "00000000-0000-0000-0000-000000000000"]) {
              assert.strictEqual(
                yield* reasonOf(
                  structure.moveProject(who, "P_MATE", { appId, kind: "production" }),
                ),
                expected,
                `${who}: ${appId}`,
              );
            }
          }
          assert.deepStrictEqual(
            (yield* structure.read("owner")).ungrouped.map((mate) => mate.projectId),
            ["P_MATE"],
          );
        }),
      ),
    );

    it.effect("HQ is never offered as a project to move", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          yield* structure.createApp("owner", "Destination");
          assert.deepStrictEqual(yield* structure.moveDestinations("owner", "HQ"), {
            moveTo: {},
            refused: {},
          });
          assert.strictEqual(
            yield* reasonOf(structure.moveProject("owner", "HQ", { appId: null, kind: "mate" })),
            "hq_project",
          );
        }),
      ),
    );

    it.effect(
      "offers moving a Mate into a production's place only where the move takes it: none held",
      () =>
        withStructure((view) =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const shop = yield* structure.createApp("owner", "Shop");
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_PROD",
              kind: "production",
            });
            yield* structure.createMate("owner", { projectId: "P_MATE", face: "face-1" });
            const offered = structure.moveDestinations("owner", "P_MATE");
            const intoProduction = reasonOf(
              structure.moveProject("owner", "P_MATE", { appId: shop.id, kind: "production" }),
            );
            // Shop's production holds the place: not offered, and refused.
            assert.deepStrictEqual(
              [(yield* offered).moveTo[shop.id], yield* intoProduction],
              [["mate", "devstage"], "production_taken"],
            );
            // Zerops no longer has it: it makes room, offered and taken.
            yield* Ref.update(view, (org) => ({
              ...org,
              projects: org.projects.filter((project) => project.id !== "P_PROD"),
            }));
            assert.deepStrictEqual(
              [(yield* offered).moveTo[shop.id], yield* intoProduction],
              [["mate", "devstage"], "ok"],
            );
          }),
        ),
    );

    it.effect("a devstage holds the stage's place; a project Zerops no longer has holds none", () =>
      withStructure((view) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const shop = yield* structure.createApp("owner", "Shop");
          // maker develops Shop through P_DEV, its production; P_MATE is its devstage.
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_DEV",
            kind: "production",
          });
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_MATE",
            kind: "devstage",
            mate: { face: "face-1" },
          });
          const attach = (projectId: string, kind: "stage" | "production") =>
            reasonOf(structure.attachProject("maker", shop.id, { projectId, kind }));
          assert.strictEqual(yield* attach("P_OWNED", "stage"), "slot_taken");
          assert.strictEqual(yield* attach("P_OWNED", "production"), "slot_taken");
          // Zerops no longer has the production: its place is free, and its row goes.
          yield* Ref.update(view, (org) => ({
            ...org,
            projects: org.projects.filter((project) => project.id !== "P_DEV"),
          }));
          // maker still develops Shop: P_OWN is its Mate now.
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_OWN",
            kind: "mate",
            mate: { face: "face-2" },
          });
          assert.strictEqual(yield* attach("P_OWNED", "production"), "ok");
        }),
      ),
    );

    it.effect("of attaches racing for one empty place, exactly one lands", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const shop = yield* structure.createApp("owner", "Shop");
          // maker develops Shop through P_DEV, its production, and owns the racing projects.
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_DEV",
            kind: "production",
          });
          const racers = ["P_RACE1", "P_RACE2", "P_RACE3", "P_RACE4", "P_RACE5", "P_RACE6"];
          // Every racer finds a connection open, so none starts late waiting for one.
          const sql = yield* SqlClient.SqlClient;
          yield* Effect.all(
            Array.from({ length: 10 }, () => sql`SELECT pg_sleep(0.05)`),
            { concurrency: "unbounded" },
          );
          const raced = yield* Effect.all(
            racers.map((projectId) =>
              reasonOf(structure.attachProject("maker", shop.id, { projectId, kind: "stage" })),
            ),
            { concurrency: "unbounded" },
          );
          assert.deepStrictEqual(raced.toSorted(), ["ok", ...Array(5).fill("slot_taken")]);
        }),
      ),
    );

    it.effect("a Mate record and an environment racing for one project: exactly one lands", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const shop = yield* structure.createApp("owner", "Shop");
          // maker develops Shop through P_DEV, its production, and owns P_RACE1, held nowhere.
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_DEV",
            kind: "production",
          });
          const sql = yield* SqlClient.SqlClient;
          // The Mate's record is held back at its write, once it has decided: a lock on hq_mate
          // that reads pass and an insert waits for.
          const locked = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          const holder = yield* Effect.forkChild(
            sql.withTransaction(
              Effect.gen(function* () {
                yield* sql`LOCK TABLE hq_mate IN SHARE MODE`;
                yield* Deferred.succeed(locked, undefined);
                yield* Deferred.await(release);
              }),
            ),
          );
          yield* Deferred.await(locked);
          const mate = yield* Effect.forkChild(
            reasonOf(structure.createMate("maker", { projectId: "P_RACE1", face: "f" })),
          );
          yield* sql<{ readonly waiting: number }>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE datname = current_database() AND wait_event_type = 'Lock'
              AND query LIKE '%INSERT INTO hq_mate%'`.pipe(
            Effect.filterOrFail((rows) => (rows[0]?.waiting ?? 0) > 0),
            Effect.retry(Schedule.spaced(Duration.millis(20))),
            Effect.timeout(Duration.seconds(5)),
          );
          // Meanwhile the environment goes as far as it may: through, or waiting for the Mate.
          const environment = yield* Effect.forkChild(
            reasonOf(
              structure.attachProject("maker", shop.id, { projectId: "P_RACE1", kind: "stage" }),
            ),
          );
          yield* Effect.sleep(Duration.millis(300));
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(holder);
          const raced = [yield* Fiber.join(mate), yield* Fiber.join(environment)];
          // A Mate first: no environment of it; an environment first: no Mate of it.
          assert.oneOf(raced.join(" "), ["ok kind_class_change", "held_as_environment ok"]);
        }),
      ),
    );

    it.effect(
      "an org owner or admin creates an application, nobody else; its name is its own",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const created = yield* structure.createApp("owner", "Shop");
            assert.strictEqual(created.name, "Shop");
            assert.deepStrictEqual(
              yield* Effect.all([
                outcome(structure.createApp("admin", "Blog")),
                outcome(structure.createApp("dev", "Dev's")),
                outcome(structure.createApp("reader", "Reader's")),
                outcome(structure.createApp("stranger", "Stranger's")),
                outcome(structure.createApp("owner", "Shop")),
                outcome(structure.createApp("owner", " ")),
              ]),
              ["ok", "forbidden", "forbidden", "forbidden", "conflict", "invalid"],
            );
          }),
        ),
    );

    it.effect(
      "attaches the org's projects: one application each, one production, a Mate record for a Mate",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const shop = yield* structure.createApp("owner", "Shop");
            const blog = yield* structure.createApp("owner", "Blog");
            const mate = { face: "face-3" };
            assert.deepStrictEqual(
              yield* Effect.all([
                outcome(
                  structure.attachProject("owner", shop.id, {
                    projectId: "P_MATE",
                    kind: "mate",
                    mate,
                  }),
                ),
                outcome(
                  structure.attachProject("admin", shop.id, {
                    projectId: "P_STAGE",
                    kind: "stage",
                  }),
                ),
                outcome(
                  structure.attachProject("owner", shop.id, {
                    projectId: "P_PROD",
                    kind: "production",
                  }),
                ),
                outcome(
                  structure.attachProject("owner", shop.id, {
                    projectId: "P_PROD2",
                    kind: "production",
                  }),
                ),
                outcome(
                  structure.attachProject("owner", blog.id, {
                    projectId: "P_MATE",
                    kind: "mate",
                    mate,
                  }),
                ),
                outcome(
                  structure.attachProject("dev", blog.id, { projectId: "P_PROD2", kind: "stage" }),
                ),
                outcome(
                  structure.attachProject("owner", blog.id, { projectId: "P_GONE", kind: "stage" }),
                ),
                outcome(
                  structure.attachProject("owner", blog.id, { projectId: "HQ", kind: "stage" }),
                ),
                outcome(
                  structure.attachProject("owner", blog.id, { projectId: "P_PROD2", kind: "mate" }),
                ),
                outcome(
                  structure.attachProject("owner", blog.id, {
                    projectId: "P_PROD2",
                    kind: "stage",
                    mate,
                  }),
                ),
                outcome(
                  structure.attachProject("owner", "00000000-0000-0000-0000-000000000000", {
                    projectId: "P_PROD2",
                    kind: "stage",
                  }),
                ),
              ]),
              [
                "ok",
                "ok",
                "ok",
                "conflict",
                "conflict",
                "forbidden",
                "project_not_found",
                "invalid",
                "invalid",
                "invalid",
                "app_not_found",
              ],
            );
          }),
        ),
    );

    it.effect(
      "a member who can create projects attaches their own new Mate to an application they see, nothing else",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const shop = yield* structure.createApp("owner", "Shop");
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_STAGE",
              kind: "stage",
            });
            const team = yield* structure.createApp("owner", "Team");
            yield* structure.attachProject("owner", team.id, {
              projectId: "P_TEAM",
              kind: "stage",
            });
            const mate = { face: "face-1" };
            const attach = (
              userId: string,
              appId: string,
              projectId: string,
              kind: "mate" | "stage",
            ) =>
              outcome(
                structure.attachProject(
                  userId,
                  appId,
                  kind === "mate" ? { projectId, kind, mate } : { projectId, kind },
                ),
              );
            assert.deepStrictEqual(
              yield* Effect.all([
                outcome(structure.createApp("maker", "Maker's")),
                attach("maker", team.id, "P_OWN", "stage"),
                // Their own grant, not the org role: an org Basic user is not every project's creator.
                attach("basic", team.id, "P_OTHER", "mate"),
                attach("maker", team.id, "P_STAGE", "mate"),
                attach("dev", team.id, "P_MATE", "mate"),
                // Only into an application they see.
                attach("maker", shop.id, "P_OWN", "mate"),
                attach("maker", team.id, "P_OWN", "mate"),
              ]),
              ["forbidden", "forbidden", "forbidden", "forbidden", "forbidden", "forbidden", "ok"],
            );
            const refused = yield* Effect.flip(
              structure.attachProject("basic", team.id, {
                projectId: "P_OTHER",
                kind: "mate",
                mate,
              }),
            );
            assert.strictEqual(
              refused._tag === "StructureRefused" ? refused.reason : refused._tag,
              "not_own_new_mate",
            );
          }),
        ),
    );

    it.effect(
      "a devstage project is a Mate by its record and its rules, and a stage beside its application's production",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const shop = yield* structure.createApp("owner", "Shop");
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_PROD",
              kind: "production",
            });
            const team = yield* structure.createApp("owner", "Team");
            yield* structure.attachProject("owner", team.id, {
              projectId: "P_TEAM",
              kind: "stage",
            });
            const mate = { face: "face-3" };
            assert.deepStrictEqual(
              yield* Effect.all([
                outcome(
                  structure.attachProject("owner", shop.id, {
                    projectId: "P_MATE",
                    kind: "devstage",
                  }),
                ),
                outcome(
                  structure.attachProject("owner", shop.id, {
                    projectId: "P_MATE",
                    kind: "devstage",
                    mate,
                  }),
                ),
                outcome(
                  structure.attachProject("owner", shop.id, {
                    projectId: "P_STAGE",
                    kind: "stage",
                  }),
                ),
                // A Mate's own rules, not a writer's: maker attaches, takes out and moves back
                // the Mate they own.
                outcome(
                  structure.attachProject("maker", team.id, {
                    projectId: "P_OWNED",
                    kind: "devstage",
                    mate: { face: "face-1" },
                  }),
                ),
                outcome(
                  structure.moveProject("maker", "P_OWNED", { appId: null, kind: "devstage" }),
                ),
                outcome(
                  structure.moveProject("maker", "P_OWNED", { appId: team.id, kind: "devstage" }),
                ),
                outcome(
                  structure.moveProject("owner", "P_STAGE", { appId: team.id, kind: "devstage" }),
                ),
              ]),
              ["invalid", "ok", "ok", "ok", "ok", "ok", "invalid"],
            );
            assert.deepStrictEqual(recordsOf((yield* structure.read("owner")).apps), [
              {
                id: shop.id,
                name: "Shop",
                projects: [
                  { projectId: "P_PROD", name: "name of P_PROD", kind: "production", mate: null },
                  {
                    projectId: "P_MATE",
                    name: "name of P_MATE",
                    kind: "devstage",
                    mate: { ...mate, madeBy: "owner", ...UNBORN },
                  },
                  { projectId: "P_STAGE", name: "name of P_STAGE", kind: "stage", mate: null },
                ],
                environments: [
                  environmentRow("P_PROD", "production", "name-of-p-prod", 1),
                  environmentRow("P_STAGE", "stage", "name-of-p-stage", 2),
                ],
                births: [],
                contents: { empty: false, deletingProjectIds: [] },
              },
              {
                id: team.id,
                name: "Team",
                projects: [
                  { projectId: "P_TEAM", name: "name of P_TEAM", kind: "stage", mate: null },
                  {
                    projectId: "P_OWNED",
                    name: "name of P_OWNED",
                    kind: "devstage",
                    mate: { face: "face-1", madeBy: "maker", ...UNBORN },
                  },
                ],
                environments: [environmentRow("P_TEAM", "stage", "name-of-p-team", 1)],
                births: [],
                contents: { empty: false, deletingProjectIds: [] },
              },
            ]);
          }),
        ),
    );

    it.effect(
      "a project Zerops no longer has stops counting: the next production takes its place",
      () =>
        withStructure((view, down) =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const shop = yield* structure.createApp("owner", "Shop");
            const attach = (projectId: string) =>
              outcome(structure.attachProject("owner", shop.id, { projectId, kind: "production" }));
            assert.deepStrictEqual(yield* Effect.all([attach("P_PROD"), attach("P_PROD2")]), [
              "ok",
              "conflict",
            ]);
            // P_PROD deleted in Zerops; while Zerops cannot say so, nothing moves.
            yield* Ref.update(view, (current) => ({
              ...current,
              projects: current.projects.filter((candidate) => candidate.id !== "P_PROD"),
            }));
            yield* Ref.set(down, true);
            assert.strictEqual(yield* attach("P_PROD2"), "ZeropsUnavailable");
            yield* Ref.set(down, false);
            assert.strictEqual(yield* attach("P_PROD2"), "ok");
            assert.deepStrictEqual(
              (yield* structure.read("owner")).apps.map((app) =>
                app.projects.map((p) => p.projectId),
              ),
              [["P_PROD2"]],
            );
          }),
        ),
    );

    it.effect(
      "an owner of one project does not turn its application's production into a Mate (S-1)",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const sql = yield* SqlClient.SqlClient;
            const shop = yield* structure.createApp("owner", "Shop");
            // maker owns P_OWNED in Zerops (its creator); the org's owner made it Shop's production.
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_OWNED",
              kind: "production",
            });
            assert.strictEqual(
              yield* outcome(
                structure.createMate("maker", { projectId: "P_OWNED", face: "face-1" }),
              ),
              "forbidden",
            );
            // A record there already (written before this rule) still does not make it a Mate.
            yield* sql`INSERT INTO hq_mate (project_id, face) VALUES ('P_OWNED', 'face-1')`;
            assert.strictEqual(
              yield* outcome(
                structure.moveProject("maker", "P_OWNED", { appId: shop.id, kind: "mate" }),
              ),
              "forbidden",
            );
            const [held] = yield* sql<{ readonly kind: string }>`
              SELECT kind FROM hq_app_project WHERE project_id = 'P_OWNED'`;
            assert.strictEqual(held?.kind, "production");
          }),
        ),
    );

    it.effect(
      "a move decided on a kind that a writer changes before it lands is refused, never applied (N-3)",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const sql = yield* SqlClient.SqlClient;
            const shop = yield* structure.createApp("owner", "Shop");
            const team = yield* structure.createApp("owner", "Team");
            yield* structure.attachProject("owner", team.id, {
              projectId: "P_TEAM",
              kind: "stage",
            });
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_OWNED",
              kind: "mate",
              mate: { face: "face-1" },
            });
            // A writer turns P_OWNED into Shop's production; their transaction is still open
            // while maker, its owner, moves it into Team as their Mate.
            const updated = yield* Deferred.make<void>();
            const release = yield* Deferred.make<void>();
            const writer = yield* Effect.forkChild(
              sql.withTransaction(
                Effect.gen(function* () {
                  yield* sql`UPDATE hq_app_project SET kind = 'production' WHERE project_id = 'P_OWNED'`;
                  yield* Deferred.succeed(updated, undefined);
                  yield* Deferred.await(release);
                }),
              ),
            );
            yield* Deferred.await(updated);
            const move = yield* Effect.forkChild(
              outcome(structure.moveProject("maker", "P_OWNED", { appId: team.id, kind: "mate" })),
            );
            yield* Effect.sleep("300 millis");
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(writer);
            assert.notStrictEqual(yield* Fiber.join(move), "ok");
            const [row] = yield* sql<{ readonly kind: string }>`
              SELECT kind FROM hq_app_project WHERE project_id = 'P_OWNED'`;
            assert.strictEqual(row?.kind, "production");
          }),
        ),
    );

    it.effect(
      "attaching a Mate that is set up already keeps its record: its face is its admin's (N-4)",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const team = yield* structure.createApp("owner", "Team");
            yield* structure.attachProject("owner", team.id, {
              projectId: "P_TEAM",
              kind: "stage",
            });
            yield* structure.createMate("owner", { projectId: "P_OWN", face: "face-3" });
            // maker may attach their own new Mate, but is only its Basic user: no new face.
            yield* structure.attachProject("maker", team.id, {
              projectId: "P_OWN",
              kind: "mate",
              mate: { face: "face-1" },
            });
            const read = yield* structure.read("owner");
            assert.deepStrictEqual(
              read.apps[0]?.projects.find((project) => project.projectId === "P_OWN")?.mate,
              { face: "face-3", madeBy: "owner", ...UNBORN },
            );
          }),
        ),
    );

    // One Mate per project (audit D2): a client that sets up a Mate on a project holding its zcp
    // service names it, and the record keeps it; a Mate born before its container names none.
    it.effect("records the zcp service a Mate's client names, at its set-up and its attach", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const team = yield* structure.createApp("owner", "Team");
          yield* structure.createMate("owner", {
            projectId: "P_OWN",
            face: "face-3",
            serviceId: "S_OWN",
          });
          yield* structure.attachProject("owner", team.id, {
            projectId: "P_TEAM",
            kind: "mate",
            mate: { face: "face-1", serviceId: "S_TEAM" },
          });
          yield* structure.attachProject("owner", team.id, {
            projectId: "P_DEV",
            kind: "mate",
            mate: { face: "face-2" },
          });
          const sql = yield* SqlClient.SqlClient;
          const rows = yield* sql<{ readonly project_id: string; readonly service_id: string }>`
            SELECT project_id, service_id FROM hq_mate ORDER BY project_id`;
          assert.deepStrictEqual(
            rows.map((row) => [row.project_id, row.service_id]),
            [
              ["P_DEV", null],
              ["P_OWN", "S_OWN"],
              ["P_TEAM", "S_TEAM"],
            ],
          );
        }),
      ),
    );

    // A Mate HQ recorded before births were was set up whole, as clients did then: 0007 records it
    // closed off, or the client's close-off gate would hold it for good. A Mate recorded after
    // reads as not closed off until its press marks it.
    it.effect(
      "reads a Mate recorded before 0007 as closed off, and one recorded after as not",
      () =>
        withStructure(
          () =>
            Effect.gen(function* () {
              const structure = yield* Structure;
              yield* structure.createMate("owner", { projectId: "P_OWN", face: "face-1" });
              const mateOf = (projectId: string) =>
                Effect.map(
                  structure.read("owner"),
                  (read) => read.ungrouped.find((entry) => entry.projectId === projectId)?.mate,
                );
              assert.deepStrictEqual(yield* mateOf("P_MATE"), {
                face: "face-3",
                madeBy: null,
                standupRequestedBy: null,
                closedOff: true,
                setupMarker: null,
                keyWider: false,
              });
              assert.deepStrictEqual(yield* mateOf("P_OWN"), {
                face: "face-1",
                madeBy: "owner",
                ...UNBORN,
              });

              yield* structure.markClosedOff("owner", "P_OWN");
              assert.strictEqual((yield* mateOf("P_OWN"))?.closedOff, true);
            }),
          Effect.gen(function* () {
            const applied = yield* migrate(treeMigrations().filter(({ name }) => name < "0007"));
            assert.strictEqual(applied.at(-1), "0006_devstage.sql");
            const sql = yield* SqlClient.SqlClient;
            yield* sql`INSERT INTO hq_mate (project_id, name, face) VALUES ('P_MATE', 'Ada', 'face-3')`;
          }),
        ),
    );

    // The press asks for the stand-up with the Mate's record and records the close-off as it is
    // born (`markClosedOff`); whoever reads the project reads both with the record, and the
    // structure is told at once.
    it.effect("reads a Mate's birth with its record, and says so as it is marked", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          yield* structure.createMate("owner", {
            projectId: "P_MATE",
            face: "face-3",
            standUp: true,
          });
          const mateOf = (userId: string) =>
            Effect.map(structure.read(userId), (read) => read.ungrouped[0]?.mate);
          assert.deepStrictEqual(yield* mateOf("reader"), {
            face: "face-3",
            madeBy: "owner",
            standupRequestedBy: "owner",
            closedOff: false,
            setupMarker: null,
            keyWider: false,
          });

          const told = yield* Stream.runHead(Stream.drop(structure.changes, 1)).pipe(
            Effect.forkChild,
          );
          yield* Effect.yieldNow;
          yield* structure.markClosedOff("owner", "P_MATE");
          assert.isTrue(Option.isSome(yield* Fiber.join(told)));

          assert.deepStrictEqual(yield* mateOf("reader"), {
            face: "face-3",
            madeBy: "owner",
            standupRequestedBy: "owner",
            closedOff: true,
            setupMarker: null,
            keyWider: false,
          });
        }),
      ),
    );

    // ADR 0003's fallout: a Mate whose key reads other projects says so with its record, so its
    // menu offers Finish setup — and its readers are told when HQ's word on its key moves.
    it.effect(
      "says a Mate whose key reads other projects, and tells its readers as that moves",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            yield* structure.createMate("owner", { projectId: "P_MATE", face: "face-3" });
            const keyWider = Effect.map(
              structure.read("reader"),
              (read) => read.ungrouped[0]?.mate.keyWider,
            );
            assert.isFalse(yield* keyWider);

            const told = yield* Stream.runHead(Stream.drop(structure.changes, 1)).pipe(
              Effect.forkChild,
            );
            yield* Effect.yieldNow;
            const sql = yield* SqlClient.SqlClient;
            yield* sql`UPDATE hq_mate SET key_wider_token_id = 'tok-wide' WHERE project_id = 'P_MATE'`;
            yield* structure.mateTouched("P_MATE");
            assert.isTrue(Option.isSome(yield* Fiber.join(told)));
            assert.isTrue(yield* keyWider);
          }),
        ),
    );

    // D3: Zerops holds a Mate's name, HQ none — what a reader and the Mate itself are told is its
    // project's name as HQ's view of the org has it.
    it.effect("a Mate goes by its project's name in Zerops, renamed there as it is", () =>
      withStructure((view) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          yield* structure.createMate("owner", { projectId: "P_MATE", face: "face-3" });
          const named = Effect.all([
            Effect.map(structure.read("reader"), (read) => read.ungrouped[0]?.name),
            Effect.map(structure.mateState("P_MATE"), (state) =>
              Option.map(state, (mate) => mate.name),
            ),
          ]);
          assert.deepStrictEqual(yield* named, ["name of P_MATE", Option.some("name of P_MATE")]);

          yield* Ref.update(view, (org) => ({
            ...org,
            projects: org.projects.map((project) =>
              project.id === "P_MATE" ? { ...project, name: "Ada" } : project,
            ),
          }));
          assert.deepStrictEqual(yield* named, ["Ada", Option.some("Ada")]);
        }),
      ),
    );

    // The person whose sign-in a Mate waits for: whoever set its record up, by their session —
    // never a field a client sends. Attaching a Mate set up already keeps its maker.
    // Audit R1 (D6): an environment the person's client created for HQ to deploy says so as it is
    // attached, and HQ records it: its services get their subdomain on their first deploy. One
    // attached as it was — a project the person made otherwise — records nothing.
    it.effect("records the subdomain intent of an environment attached as created for HQ", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          const shop = yield* structure.createApp("owner", "Shop");
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_DEV",
            kind: "stage",
            created: true,
          });
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_OWNED",
            kind: "production",
          });
          assert.deepStrictEqual(yield* sql`SELECT project_id, service FROM hq_subdomain_intent`, [
            { project_id: "P_DEV", service: null },
          ]);
        }),
      ),
    );

    it.effect("records who made a Mate: whoever creates or attaches it, and only them", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const madeByOf = (projectId: string) =>
            Effect.map(
              structure.read("owner"),
              (read) =>
                [
                  ...read.ungrouped.map((entry) => ({
                    projectId: entry.projectId,
                    mate: entry.mate,
                  })),
                  ...read.apps.flatMap((app) => app.projects),
                ].find((entry) => entry.projectId === projectId)?.mate?.madeBy,
            );
          yield* structure.createMate("owner", {
            projectId: "P_MATE",
            face: "face-3",
            madeBy: "dev",
          } as MateRecord);
          assert.strictEqual(yield* madeByOf("P_MATE"), "owner");

          const team = yield* structure.createApp("owner", "Team");
          yield* structure.attachProject("owner", team.id, { projectId: "P_TEAM", kind: "stage" });
          yield* structure.attachProject("maker", team.id, {
            projectId: "P_OWN",
            kind: "mate",
            mate: { face: "face-1" },
          });
          assert.strictEqual(yield* madeByOf("P_OWN"), "maker");

          // Attached by somebody else, a Mate set up already keeps the person who made it.
          yield* structure.attachProject("admin", team.id, {
            projectId: "P_MATE",
            kind: "mate",
            mate: { face: "face-3" },
          });
          assert.strictEqual(yield* madeByOf("P_MATE"), "owner");
        }),
      ),
    );

    it.effect(
      "records a Mate's birth intent in its application before its project, and its attach closes it",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const team = yield* structure.createApp("owner", "Team");
            yield* structure.attachProject("owner", team.id, {
              projectId: "P_TEAM",
              kind: "stage",
            });
            const birthsOf = Effect.map(
              structure.read("owner"),
              (read) => read.apps.find((app) => app.id === team.id)?.births,
            );
            // maker sees Team through its stage, and records their new Mate before its project.
            const intent = yield* structure.recordBirth("maker", {
              appId: team.id,
              face: "rose:seal",
            });
            assert.deepStrictEqual(yield* birthsOf, [{ id: intent.id, face: "rose:seal" }]);
            // Nobody who does not see the application records one in it.
            assert.strictEqual(
              yield* reasonOf(structure.recordBirth("nobody", { appId: team.id, face: "" })),
              "app_not_seen",
            );
            // Its attach, by whoever finishes it, closes it.
            yield* structure.attachProject("owner", team.id, {
              projectId: "P_OWN",
              kind: "mate",
              mate: { face: "rose:seal" },
              birth: intent.id,
            });
            assert.deepStrictEqual(yield* birthsOf, []);
          }),
        ),
    );

    // B5: a Mate's press in one browser, read in another — held while its press renews it, taken
    // over once it ran out, and following the container import it asked for.
    it.effect("holds a Mate's press for the browser running it, and lets it go at its end", () =>
      withStructure((_view, _down, _zerops, asked) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          const MATE = { kind: "mate" } as const;
          const pressOf = (userId: string) =>
            Effect.map(structure.read(userId), (read) => read.presses["P_OWN"]);
          const held = yield* structure.holdPress("maker", "P_OWN", { ...MATE, owner: "press-a" });
          assert.isTrue(held.heldForMs > PRESS_HOLD_MS - 5_000 && held.heldForMs <= PRESS_HOLD_MS);
          assert.strictEqual(held.kind, "mate");
          // Another browser's press is refused while the first one's hold runs.
          assert.strictEqual(
            yield* reasonOf(structure.holdPress("maker", "P_OWN", { ...MATE, owner: "press-b" })),
            "press_held",
          );
          // Renewed by its own press, with the import Zerops answered, kept through a renewal.
          yield* structure.holdPress("maker", "P_OWN", {
            ...MATE,
            owner: "press-a",
            importProcessId: "imp-1",
          });
          yield* structure.holdPress("maker", "P_OWN", { ...MATE, owner: "press-a" });
          assert.strictEqual((yield* pressOf("owner"))?.importProcessId, "imp-1");
          // Nobody who does not read the project holds it, or reads it — a refusal confirmed over
          // a fresh read, as a project Zerops made seconds ago may be missing from the recent one.
          yield* Ref.set(asked, []);
          assert.strictEqual(
            yield* reasonOf(structure.holdPress("nobody", "P_OWN", { ...MATE, owner: "press-c" })),
            "not_project_reader",
          );
          assert.deepStrictEqual(yield* Ref.get(asked), ["write recent", "write fresh"]);
          assert.isUndefined(yield* pressOf("nobody"));
          // A hold that ran out — its tab closed — reads none left, and another press takes it over.
          yield* sql`UPDATE hq_press SET until = now() - interval '1 second'`;
          const ranOut = yield* pressOf("owner");
          assert.deepStrictEqual([ranOut?.heldForMs, ranOut?.importProcessId], [0, "imp-1"]);
          yield* structure.holdPress("maker", "P_OWN", { ...MATE, owner: "press-b" });
          assert.isUndefined((yield* pressOf("owner"))?.importProcessId);
          // Only the press holding it ends it; one that finished leaves no record.
          yield* structure.endPress("maker", "P_OWN", { owner: "press-a", finished: true });
          assert.isDefined(yield* pressOf("owner"));
          yield* structure.endPress("maker", "P_OWN", { owner: "press-b", finished: true });
          assert.isUndefined(yield* pressOf("owner"));
        }),
      ),
    );

    // A renewal in flight when its press ends lands after the end: it extends only a live hold of
    // its own press, so it never revives a press that stopped or re-creates one that finished.
    it.effect("never lets a renewal outlive its press's end", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const MATE = { kind: "mate" } as const;
          const pressOf = Effect.map(structure.read("owner"), (read) => read.presses["P_OWN"]);
          const renew = (owner: string) =>
            reasonOf(structure.holdPress("maker", "P_OWN", { ...MATE, owner, renew: true }));
          // Nothing to renew before the first hold, which alone creates.
          assert.strictEqual(yield* renew("press-a"), "press_not_held");
          assert.isUndefined(yield* pressOf);
          yield* structure.holdPress("maker", "P_OWN", { ...MATE, owner: "press-a" });
          // Its own live hold renews, with the import Zerops answered; another press's does not.
          yield* structure.holdPress("maker", "P_OWN", {
            ...MATE,
            owner: "press-a",
            importProcessId: "imp-1",
            renew: true,
          });
          assert.strictEqual((yield* pressOf)?.importProcessId, "imp-1");
          assert.strictEqual(yield* renew("press-b"), "press_not_held");
          // Stopped: a renewal after it leaves its hold ended.
          yield* structure.endPress("maker", "P_OWN", { owner: "press-a", finished: false });
          assert.strictEqual(yield* renew("press-a"), "press_not_held");
          assert.strictEqual((yield* pressOf)?.heldForMs, 0);
          // Finished: a renewal after it leaves no record.
          yield* structure.holdPress("maker", "P_OWN", { ...MATE, owner: "press-c" });
          yield* structure.endPress("maker", "P_OWN", { owner: "press-c", finished: true });
          assert.strictEqual(yield* renew("press-c"), "press_not_held");
          assert.isUndefined(yield* pressOf);
        }),
      ),
    );

    // B5: a stage's press imports first and registers last; one cut short between them leaves a
    // project HQ holds nowhere, whose press record says what it is and where it goes.
    it.effect("keeps a stopped stage press's record, its hold ended, until its project goes", () =>
      withStructure((view) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const team = yield* structure.createApp("owner", "Team");
          const pressOf = Effect.map(structure.read("owner"), (read) => read.presses["P_STAGE"]);
          yield* structure.holdPress("owner", "P_STAGE", {
            owner: "press-s",
            kind: "stage",
            appId: team.id,
          });
          assert.deepStrictEqual(
            [(yield* pressOf)?.kind, (yield* pressOf)?.appId],
            ["stage", team.id],
          );
          // An application HQ does not hold is refused.
          assert.strictEqual(
            yield* reasonOf(
              structure.holdPress("owner", "P_STAGE", {
                owner: "press-s",
                kind: "stage",
                appId: "00000000-0000-0000-0000-000000000000",
              }),
            ),
            "app_not_found",
          );
          // Stopped: its hold ends now, its record stays.
          yield* structure.endPress("owner", "P_STAGE", { owner: "press-s", finished: false });
          assert.deepStrictEqual(
            [(yield* pressOf)?.heldForMs, (yield* pressOf)?.kind],
            [0, "stage"],
          );
          // Its setup finished elsewhere — registered as its stage — its record is over.
          yield* structure.attachProject("owner", team.id, { projectId: "P_STAGE", kind: "stage" });
          assert.isUndefined(yield* pressOf);
          yield* structure.holdPress("owner", "P_STAGE", {
            owner: "press-t",
            kind: "stage",
            appId: team.id,
          });
          // Its project gone from Zerops: its record goes with it.
          yield* Ref.update(view, (org) => ({
            ...org,
            projects: org.projects.filter((project) => project.id !== "P_STAGE"),
          }));
          yield* structure.reconcile;
          assert.isUndefined(
            (yield* Effect.map(structure.read("owner"), (read) => read.presses))["P_STAGE"],
          );
        }),
      ),
    );

    it.effect("reads the tool projects HQ holds", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          yield* sql`INSERT INTO hq_tool (project_id, kind) VALUES ('P_TEAM', 'gitea')`;
          assert.deepStrictEqual((yield* structure.read("owner")).tools, [
            { projectId: "P_TEAM", kind: "gitea" },
          ]);
        }),
      ),
    );

    it.effect("binds a birth to its project by id in HQ, without project tags", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const app = yield* structure.createApp("owner", "App");
          const birth = yield* structure.recordBirth("owner", { appId: app.id, face: "rose:seal" });
          yield* structure.bindBirth("owner", birth.id, "P_OWN");
          yield* structure.bindBirth("owner", birth.id, "P_OWN");
          const read = yield* structure.read("owner");
          assert.deepStrictEqual(read.apps.find((a) => a.id === app.id)?.births, [
            { id: birth.id, face: "rose:seal", projectId: "P_OWN" },
          ]);
          assert.strictEqual(
            yield* reasonOf(structure.bindBirth("nobody", birth.id, "P_TEAM")),
            "birth_not_found",
          );
          yield* structure.attachProject("owner", app.id, {
            projectId: "P_OWN",
            kind: "mate",
            mate: { face: "rose:seal" },
            birth: birth.id,
          });
          assert.strictEqual(
            (yield* structure.read("owner")).apps[0]?.projects[0]?.mate?.birthId,
            birth.id,
          );
        }),
      ),
    );

    it.effect("a Mate attached under its birth intent was made by whoever started its birth", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const team = yield* structure.createApp("owner", "Team");
          yield* structure.attachProject("owner", team.id, { projectId: "P_TEAM", kind: "stage" });
          const intent = yield* structure.recordBirth("maker", {
            appId: team.id,
            face: "rose:seal",
          });
          // Cut off before its attach, finished by somebody else: its sign-in is still maker's.
          yield* structure.attachProject("owner", team.id, {
            projectId: "P_OWN",
            kind: "mate",
            mate: { face: "rose:seal" },
            birth: intent.id,
          });
          const read = yield* structure.read("owner");
          const gus = read.apps
            .find((app) => app.id === team.id)
            ?.projects.find((project) => project.projectId === "P_OWN");
          assert.strictEqual(gus?.mate?.madeBy, "maker");
        }),
      ),
    );

    it.effect(
      "a new birth intent takes the same person's open ones older than a week with it",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const sql = yield* SqlClient.SqlClient;
            const team = yield* structure.createApp("owner", "Team");
            yield* structure.attachProject("owner", team.id, {
              projectId: "P_TEAM",
              kind: "stage",
            });
            const record = (userId: string) =>
              structure.recordBirth(userId, { appId: team.id, face: "" });
            const stale = yield* record("maker");
            const theirs = yield* record("owner");
            const recent = yield* record("maker");
            yield* sql`
            UPDATE hq_birth_intent SET created_at = now() - interval '8 days'
            WHERE id::text IN (${stale.id}, ${theirs.id})`;
            yield* sql`
            UPDATE hq_birth_intent SET created_at = now() - interval '6 days'
            WHERE id::text = ${recent.id}`;

            const fresh = yield* record("maker");
            const births = (yield* structure.read("owner")).apps.find(
              (app) => app.id === team.id,
            )?.births;
            // Maker's week-old intent goes; a younger one of theirs, and another person's, stay.
            assert.deepStrictEqual(
              births?.map((birth) => birth.id),
              [theirs.id, recent.id, fresh.id],
            );
          }),
        ),
    );

    it.effect("changes a Mate's face: whoever is owner or admin on its project", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const shop = yield* structure.createApp("owner", "Shop");
          const attachMate = (projectId: string) =>
            structure.attachProject("owner", shop.id, {
              projectId,
              kind: "mate",
              mate: { face: "face-3" },
            });
          yield* attachMate("P_MATE");
          yield* attachMate("P_OWNED");
          yield* structure.attachProject("owner", shop.id, { projectId: "P_STAGE", kind: "stage" });
          assert.deepStrictEqual(
            yield* Effect.all([
              outcome(structure.patchMate("owner", "P_MATE", { face: "rose:seal" })),
              outcome(structure.patchMate("maker", "P_OWNED", { face: "olive:clover" })),
              outcome(structure.patchMate("dev", "P_MATE", { face: "sky:flower" })),
              outcome(structure.patchMate("reader", "P_MATE", { face: "sky:flower" })),
              outcome(structure.patchMate("owner", "P_STAGE", { face: "sky:flower" })),
              outcome(structure.patchMate("owner", "P_GONE", { face: "sky:flower" })),
              outcome(structure.patchMate("owner", "P_MATE", { face: "x".repeat(65) })),
            ]),
            [
              "ok",
              "ok",
              "forbidden",
              "forbidden",
              "mate_not_found",
              // Asked of Zerops before HQ's records: a project it no longer has is gone.
              "project_not_found",
              "invalid",
            ],
          );
          const mates = (yield* structure.read("owner")).apps[0]?.projects.map((p) => p.mate);
          assert.deepStrictEqual(mates, [
            { face: "rose:seal", madeBy: "owner", ...UNBORN },
            { face: "olive:clover", madeBy: "owner", ...UNBORN },
            null,
          ]);
        }),
      ),
    );

    it.effect(
      "reconciles with Zerops: rows of projects it no longer has go, nothing moves while it cannot say",
      () =>
        withStructure((view, down) =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const sql = yield* SqlClient.SqlClient;
            const shop = yield* structure.createApp("owner", "Shop");
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_MATE",
              kind: "mate",
              mate: { face: "face-3" },
            });
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_STAGE",
              kind: "stage",
            });
            const rows = Effect.map(
              sql<{
                readonly project_id: string;
              }>`SELECT project_id FROM hq_app_project ORDER BY seq`,
              (found) => found.map((row) => row.project_id),
            );
            assert.strictEqual(yield* structure.reconcile, 0);

            yield* Ref.update(view, (current) => ({
              ...current,
              projects: current.projects.filter(
                (candidate) => candidate.id !== "P_MATE" && candidate.id !== "P_STAGE",
              ),
            }));
            yield* Ref.set(down, true);
            assert.strictEqual(yield* outcome(structure.reconcile), "ZeropsUnavailable");
            assert.deepStrictEqual(yield* rows, ["P_MATE", "P_STAGE"]);
            yield* Ref.set(down, false);
            assert.strictEqual(yield* structure.reconcile, 2);
            assert.deepStrictEqual(yield* rows, []);
            assert.strictEqual((yield* sql`SELECT 1 FROM hq_mate`).length, 0);
          }),
        ),
    );

    // The lead, 2026-10-03: the reconcile every minute forced a fresh read of KRLS's member and
    // project lists. It reads the org as recent — the view at most 30 s old another read left —
    // and a fresh read stays a write's.
    it.effect("reconciles over the org as recently read, never forcing a fresh read", () =>
      withStructure((_view, _down, _zerops, asked) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          yield* Ref.set(asked, []);
          yield* structure.reconcile;
          assert.deepStrictEqual(yield* Ref.get(asked), ["recent"]);
        }),
      ),
    );

    // An application's environments live in HQ (SPEC §3.2b): recorded with the attach, named as
    // main named them (D10), following their tier's sources, in the order they were declared.
    it.effect(
      "records an environment with its attach, named from its project, in the order declared",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const shop = yield* structure.createApp("owner", "Shop");
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_STAGE",
              kind: "stage",
            });
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_MATE",
              kind: "mate",
              mate: { face: "face-1" },
            });
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_PROD",
              kind: "production",
            });
            assert.deepStrictEqual(yield* environmentsOf(structure, "Shop"), {
              P_STAGE: { name: "name-of-p-stage", sources: ["main"], order: 1, keyHeld: false },
              P_MATE: undefined,
              P_PROD: { name: "name-of-p-prod", sources: ["release"], order: 2, keyHeld: false },
            });
          }),
        ),
    );

    // Main's write refusals (D11): a name given is checked; one derived is numbered on a collision.
    it.effect("names an environment as its attach asks, refused as main refused one", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const shop = yield* structure.createApp("owner", "Shop");
          const attach = (projectId: string, name?: string, kind: "stage" | "mate" = "stage") =>
            reasonOf(
              structure.attachProject("owner", shop.id, {
                projectId,
                kind,
                ...(name === undefined ? {} : { environment: { name } }),
                ...(kind === "mate" ? { mate: { face: "face-1" } } : {}),
              }),
            );
          assert.deepStrictEqual(
            [
              yield* attach("P_STAGE", "name-of-p-team"),
              yield* attach("P_TEAM", ""),
              yield* attach("P_TEAM", "Live"),
              yield* attach("P_TEAM", `l${"o".repeat(63)}`),
              yield* attach("P_TEAM", "name-of-p-team"),
              yield* attach("P_MATE", "dev", "mate"),
              yield* attach("P_TEAM"),
            ],
            [
              "ok",
              "environment_name_missing",
              "environment_name_invalid",
              "environment_name_long",
              "environment_name_taken",
              "environment_with_kind",
              "ok",
            ],
          );
          assert.deepStrictEqual(yield* environmentsOf(structure, "Shop"), {
            P_STAGE: { name: "name-of-p-team", sources: ["main"], order: 1, keyHeld: false },
            P_TEAM: { name: "name-of-p-team-2", sources: ["main"], order: 2, keyHeld: false },
          });
        }),
      ),
    );

    // Main D13: an environment whose project Zerops no longer has is taken over in place by the
    // project attached in its place — its name, its sources and its place in the order kept.
    it.effect("takes over the environment of a project Zerops no longer has, in place", () =>
      withStructure((view) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const shop = yield* structure.createApp("owner", "Shop");
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_PROD",
            kind: "production",
            environment: { name: "live" },
          });
          yield* structure.attachProject("owner", shop.id, { projectId: "P_STAGE", kind: "stage" });
          yield* Ref.update(view, (org) => ({
            ...org,
            projects: org.projects.filter((project) => project.id !== "P_PROD"),
          }));
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_PROD2",
            kind: "production",
          });
          assert.deepStrictEqual(yield* environmentsOf(structure, "Shop"), {
            P_STAGE: { name: "name-of-p-stage", sources: ["main"], order: 2, keyHeld: false },
            P_PROD2: { name: "live", sources: ["release"], order: 1, keyHeld: false },
          });
        }),
      ),
    );

    // An environment goes with its project: at reconcile once Zerops no longer has it, and when
    // it leaves its application; a move into another application or tier records it there anew.
    it.effect.each(
      Array.from(["stage", "production", "devstage"] as const, (kind) => ({
        title: `moving a Mate as ${kind} keeps its identity and source repository history`,
        kind,
      })),
    )("$title", ({ kind }) =>
      withStructure((view) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          const source = yield* structure.createApp("owner", "Source");
          const destination = yield* structure.createApp("owner", "Destination");
          yield* structure.attachProject("owner", source.id, {
            projectId: "P_MATE",
            kind: "mate",
            mate: { face: "face-3", standUp: true },
          });
          yield* structure.recordSigners("P_MATE", { claude: "dev" });
          yield* structure.markClosedOff("owner", "P_MATE");
          const before = (yield* structure.read("owner")).apps.find((app) => app.id === source.id)!
            .projects[0]!.mate;
          yield* sql`INSERT INTO hq_repo (app_id, name, created_by)
              VALUES (${source.id}::uuid, 'appdev', 'owner')`;
          yield* sql`INSERT INTO hq_change (app_id, repo, number, mate_project_id, title, state, head)
              VALUES (${source.id}::uuid, 'appdev', 1, 'P_MATE', 'Open work', 'open', ${"a".repeat(40)}),
                     (${source.id}::uuid, 'appdev', 2, 'P_MATE', 'Merged work', 'merged', ${"b".repeat(40)})`;
          const history = sql`SELECT app_id::text, repo, number, mate_project_id, state, head
              FROM hq_change ORDER BY number`;
          const beforeHistory = yield* history;
          yield* structure.moveProject("owner", "P_MATE", { appId: destination.id, kind });
          const read = yield* structure.read("owner");
          assert.deepStrictEqual(
            read.apps
              .find((app) => app.id === destination.id)!
              .projects.map((project) => ({
                projectId: project.projectId,
                kind: project.kind,
                mate: project.mate,
              })),
            [{ projectId: "P_MATE", kind, mate: before }],
          );
          assert.deepStrictEqual(read.apps.find((app) => app.id === source.id)!.projects, []);
          assert.deepStrictEqual(yield* history, beforeHistory);
          assert.strictEqual(
            yield* reasonOf(structure.deleteApp("owner", source.id)),
            "app_not_empty",
          );
          // Destruction removes placement, never another repository's retained changes.
          yield* Ref.update(view, (org) => ({
            ...org,
            projects: org.projects.filter((project) => project.id !== "P_MATE"),
          }));
          yield* structure.reconcile;
          assert.deepStrictEqual(yield* history, beforeHistory);
          assert.strictEqual(
            yield* reasonOf(structure.deleteApp("owner", source.id)),
            "app_not_empty",
          );
        }),
      ),
    );

    it.effect("drops an environment with its project, and records it anew where it moves", () =>
      withStructure((view) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          const shop = yield* structure.createApp("owner", "Shop");
          const team = yield* structure.createApp("owner", "Team");
          yield* structure.attachProject("owner", shop.id, { projectId: "P_STAGE", kind: "stage" });
          yield* structure.attachProject("owner", shop.id, { projectId: "P_TEAM", kind: "stage" });
          yield* structure.attachProject("owner", team.id, {
            projectId: "P_OTHER",
            kind: "stage",
            environment: { name: "name-of-p-stage" },
          });
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_PROD",
            kind: "production",
          });

          yield* structure.moveProject("owner", "P_STAGE", { appId: team.id, kind: "production" });
          yield* structure.moveProject("owner", "P_PROD", { appId: null, kind: "production" });
          assert.deepStrictEqual(yield* environmentsOf(structure, "Team"), {
            P_OTHER: { name: "name-of-p-stage", sources: ["main"], order: 1, keyHeld: false },
            P_STAGE: { name: "name-of-p-stage-2", sources: ["release"], order: 2, keyHeld: false },
          });

          yield* Ref.update(view, (org) => ({
            ...org,
            projects: org.projects.filter((project) => project.id !== "P_TEAM"),
          }));
          assert.strictEqual(yield* structure.reconcile, 1);
          const left = yield* sql<{ readonly project_id: string }>`
            SELECT project_id FROM hq_environment ORDER BY project_id`;
          assert.deepStrictEqual(
            left.map((row) => row.project_id),
            ["P_OTHER", "P_STAGE"],
          );
        }),
      ),
    );

    // A stage or production attached before HQ held environments is one: named after its tier,
    // numbered within its application in the order it was attached.
    it.effect("records an environment of every stage and production attached before 0010", () =>
      withStructure(
        (_view) =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            assert.deepStrictEqual(yield* environmentsOf(structure, "Shop"), {
              P_STAGE: { name: "stage", sources: ["main"], order: 1, keyHeld: false },
              P_PROD: { name: "production", sources: ["release"], order: 2, keyHeld: false },
              P_TEAM: { name: "stage-2", sources: ["main"], order: 3, keyHeld: false },
              P_MATE: undefined,
            });
          }),
        Effect.gen(function* () {
          const applied = yield* migrate(treeMigrations().filter(({ name }) => name < "0010"));
          assert.strictEqual(applied.at(-1), "0009_change_judged.sql");
          const sql = yield* SqlClient.SqlClient;
          yield* sql`
            INSERT INTO hq_app (id, name, created_by)
            VALUES ('00000000-0000-0000-0000-00000000000a', 'Shop', 'owner')`;
          yield* sql`
            INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
            VALUES ('P_STAGE', '00000000-0000-0000-0000-00000000000a', 'stage', 'owner'),
                   ('P_PROD', '00000000-0000-0000-0000-00000000000a', 'production', 'owner'),
                   ('P_TEAM', '00000000-0000-0000-0000-00000000000a', 'stage', 'owner'),
                   ('P_MATE', '00000000-0000-0000-0000-00000000000a', 'mate', 'owner')`;
        }),
      ),
    );

    // An environment's deploy token (SPEC §3.2b, main E02/E05): handed over by whoever may attach
    // its project, checked to reach exactly that project as a Basic user, and never answered back —
    // a reader learns that one is held.
    it.effect(
      "keeps an environment's deploy token that reaches exactly its project, and says only that it holds one",
      () =>
        withStructure((_view, _down, zerops) =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const sql = yield* SqlClient.SqlClient;
            const shop = yield* structure.createApp("owner", "Shop");
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_OWNED",
              kind: "stage",
              environment: { name: "stage" },
            });
            const token = (
              name: string,
              over: Partial<Omit<ZeropsOwnToken, "readAtMs">> = {},
            ): Omit<ZeropsOwnToken, "readAtMs"> => ({
              id: name,
              name,
              orgId: "ORG",
              roleCode: "NO_ACCESS",
              canCreateProjects: false,
              canViewFinances: false,
              canEditFinances: false,
              projects: [{ projectId: "P_OWNED", roleCode: "BASIC_USER" }],
              createdMs: 0,
              createdByUser: "maker",
              ...over,
            });
            for (const [value, record] of [
              ["key-stage", token("deploy-stage")],
              [
                "key-wide",
                token("wide", {
                  projects: [
                    { projectId: "P_OWNED", roleCode: "BASIC_USER" },
                    { projectId: "P_PROD", roleCode: "BASIC_USER" },
                  ],
                }),
              ],
              [
                "key-other",
                token("other", { projects: [{ projectId: "P_PROD", roleCode: "BASIC_USER" }] }),
              ],
              [
                "key-admin",
                token("admin", { projects: [{ projectId: "P_OWNED", roleCode: "ADMIN" }] }),
              ],
              ["key-org", token("org", { roleCode: "READ_ONLY" })],
              ["key-maker", token("maker", { canCreateProjects: true })],
              ["key-elsewhere", token("elsewhere", { orgId: "OTHER" })],
            ] as const) {
              zerops.tokens.set(value, record);
            }
            const keep = (userId: string, name: string, value: string) =>
              reasonOf(structure.keepDeployToken(userId, shop.id, name, Redacted.make(value)));
            const keyHeld = Effect.map(
              environmentsOf(structure, "Shop"),
              (environments) => environments["P_OWNED"]?.keyHeld,
            );
            assert.strictEqual(yield* keyHeld, false);
            // Whether an environment of a name exists is told only to whoever sees the application.
            assert.deepStrictEqual(
              [
                yield* keep("nobody", "production", "key-stage"),
                yield* keep("nobody", "stage", "key-stage"),
              ],
              ["app_not_seen", "app_not_seen"],
            );
            assert.deepStrictEqual(
              [
                yield* keep("owner", "production", "key-stage"),
                // reader sees Shop (org Read only), with no Full access on its stage's project.
                yield* keep("reader", "stage", "key-stage"),
                yield* keep("owner", "stage", "key-bogus"),
                yield* keep("owner", "stage", "key-wide"),
                yield* keep("owner", "stage", "key-other"),
                yield* keep("owner", "stage", "key-admin"),
                yield* keep("owner", "stage", "key-org"),
                yield* keep("owner", "stage", "key-maker"),
                yield* keep("owner", "stage", "key-elsewhere"),
              ],
              [
                "environment_not_found",
                "not_project_admin",
                "deploy_token_refused",
                "deploy_token_scope",
                "deploy_token_scope",
                "deploy_token_scope",
                "deploy_token_scope",
                "deploy_token_scope",
                "deploy_token_scope",
              ],
            );
            assert.strictEqual(yield* keyHeld, false);
            // maker owns P_OWNED: Full access there is enough.
            assert.strictEqual(yield* keep("maker", "stage", "key-stage"), "ok");
            assert.strictEqual(yield* keyHeld, true);
            // A key HQ's check before a deploy found no longer usable shows until a new one is kept.
            const keyInvalid = Effect.map(
              structure.read("owner"),
              (read) => shown(read.apps[0]!.environments)[0]?.keyInvalid,
            );
            assert.strictEqual(yield* keyInvalid, false);
            yield* sql`UPDATE hq_deploy_token SET invalid_since = now()`;
            assert.strictEqual(yield* keyInvalid, true);
            assert.strictEqual(yield* keep("maker", "stage", "key-stage"), "ok");
            assert.strictEqual(yield* keyInvalid, false);
            // Kept sealed: bytes that hold no value, opening under HQ's key on its own row alone.
            const [kept] = yield* sql<{ readonly key_id: string; readonly sealed: Uint8Array }>`
              SELECT key_id, sealed FROM hq_deploy_token WHERE project_id = 'P_OWNED'`;
            assert.notInclude(Buffer.from(kept?.sealed ?? []).toString("latin1"), "key-stage");
            const opened = openToken(testKey(), "P_OWNED", {
              keyId: kept?.key_id ?? "",
              sealed: kept?.sealed ?? new Uint8Array(),
            });
            assert.strictEqual(opened && Redacted.value(opened), "key-stage");
            assert.notInclude(encodeJson(yield* structure.read("owner")), "key-stage");
            // The deploy-jobs design: the environment attached, and each key kept, asked for the
            // environment's deploys in the write that recorded it; a key refused asked for none.
            assert.deepStrictEqual(
              yield* sql`SELECT cause, project_id, by FROM hq_rollout ORDER BY id`,
              [
                { cause: "env_added", project_id: "P_OWNED", by: "owner" },
                { cause: "key_kept", project_id: "P_OWNED", by: "maker" },
                { cause: "key_kept", project_id: "P_OWNED", by: "maker" },
              ],
            );
          }),
        ),
    );

    // HQ keeps a deploy token only sealed (`deployKeys.ts`): without its key it keeps none, before
    // it asks Zerops anything of the token.
    it.effect.each<[string, string | undefined]>([
      ["no key", undefined],
      ["a key that is no key", "not-a-key"],
    ])("keeps no deploy token while HQ has %s", ([, raw]) =>
      withStructure(
        (_view, _down, zerops) =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const shop = yield* structure.createApp("owner", "Shop");
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_OWNED",
              kind: "stage",
              environment: { name: "stage" },
            });
            const asked = zerops.calls.length;
            const kept = yield* structure
              .keepDeployToken("owner", shop.id, "stage", Redacted.make("key-stage"))
              .pipe(Effect.flip);
            assert.deepStrictEqual(
              kept._tag === "StructureRefused" ? [kept.code, kept.reason] : kept._tag,
              ["conflict", "no_key_secret"],
            );
            assert.deepStrictEqual(zerops.calls.slice(asked), []);
            assert.strictEqual(
              (yield* environmentsOf(structure, "Shop"))["P_OWNED"]?.keyHeld,
              false,
            );
          }),
        undefined,
        keySecretOf(raw === undefined ? Option.none() : Option.some(Redacted.make(raw))),
      ),
    );

    // An application's environments and their deploys (SPEC §3.2b, main B26–B36) go to whoever
    // reads its changes, as main's commit statuses and environments.yaml went to whoever read its
    // repositories — its environment's project unseen or not. One who sees the application through
    // a Read only grant alone reads none of them (Fable round 9). Per service, the newest deploy and
    // the one live.
    it.effect("reads an application's environments and deploys to whoever reads its changes", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          const shop = yield* structure.createApp("owner", "Shop");
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_MATE",
            kind: "mate",
            mate: { face: "face-1" },
          });
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_STAGE",
            kind: "stage",
            environment: { name: "stage" },
          });
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_TEAM",
            kind: "mate",
            mate: { face: "face-2" },
          });
          const [one, two, three] = ["1".repeat(40), "2".repeat(40), "3".repeat(40)] as const;
          // The stage's jobs, in the rollout its attach asked for.
          const [rollout] = yield* sql<{ readonly id: string }>`
            SELECT id::text AS id FROM hq_rollout WHERE project_id = 'P_STAGE'`;
          yield* sql`
            INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state,
              reason, app_version_id, process_id, requested_by, created_at, updated_at, ended_at)
            VALUES
              (${rollout!.id}::bigint, 'deploy', 'P_STAGE', 'web', 'web', ${one}, 'live', NULL,
                'V1', 'J1', NULL, now() - interval '3 minutes', now() - interval '2 minutes',
                now() - interval '2 minutes'),
              (${rollout!.id}::bigint, 'deploy', 'P_STAGE', 'web', 'web', ${two}, 'failed',
                'failed: Build failed', 'V2', 'J2', 'dev', now() - interval '1 minute', now(),
                now()),
              (${rollout!.id}::bigint, 'deploy', 'P_STAGE', 'api', 'api', ${three}, 'queued', NULL,
                NULL, NULL, NULL, now(), now(), NULL)`;
          const read = (userId: string) =>
            Effect.map(structure.read(userId), (structureRead) =>
              structureRead.apps.map((app) => ({
                projects: app.projects.map((project) => project.projectId),
                environments:
                  "refused" in app.environments
                    ? app.environments
                    : app.environments.map(({ projectId, jobs }) => ({
                        projectId,
                        jobs: jobs.map((job) => [
                          job.service,
                          job.sha,
                          job.state,
                          job.cause,
                          job.reason,
                          job.processId,
                          job.requestedBy,
                          typeof job.at,
                          job.endedAt === null ? null : typeof job.endedAt,
                        ]),
                      })),
              })),
            );
          const seen = [
            {
              projects: ["P_MATE"],
              environments: [
                {
                  projectId: "P_STAGE",
                  // Newest first.
                  jobs: [
                    ["api", three, "queued", "env_added", null, null, null, "string", null],
                    [
                      "web",
                      two,
                      "failed",
                      "env_added",
                      "failed: Build failed",
                      "J2",
                      "dev",
                      "string",
                      "string",
                    ],
                    ["web", one, "live", "env_added", null, "J1", null, "string", "string"],
                  ],
                },
              ],
            },
          ];
          // dev develops Shop through P_MATE (Basic user there), and does not read its stage's
          // project; maker sees Shop only through a Read only grant on P_TEAM.
          assert.deepStrictEqual(yield* read("dev"), seen);
          // Refused, and said so: never an empty list that reads as "no environments".
          assert.deepStrictEqual(yield* read("maker"), [
            { projects: ["P_TEAM"], environments: { refused: "changes_not_seen" } },
          ]);
          assert.deepStrictEqual(yield* read("nobody"), []);
        }),
      ),
    );

    // The deploy-jobs design: the view carries an environment's newest jobs, bounded, and each
    // service's newest live one past the bound — what runs there is never cut off by what came
    // after — each naming what asked for it.
    it.effect("carries an environment's newest jobs, and each service's live one past them", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          const shop = yield* structure.createApp("owner", "Shop");
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_MATE",
            kind: "mate",
            mate: { face: "face-1" },
          });
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_STAGE",
            kind: "stage",
            environment: { name: "stage" },
          });
          const [live, head] = ["1".repeat(40), "2".repeat(40)] as const;
          const [merge] = yield* sql<{ readonly id: string }>`
            INSERT INTO hq_rollout (app_id, cause, repo, sha, planned_at)
            VALUES (${shop.id}::uuid, 'merge', 'api', ${head}, now())
            RETURNING id::text AS id`;
          yield* sql`
            INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state,
              ended_at)
            VALUES (${merge!.id}::bigint, 'deploy', 'P_STAGE', 'web', 'web', ${live}, 'live',
              now())`;
          yield* sql`
            INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state,
              reason, ended_at)
            SELECT ${merge!.id}::bigint, 'deploy', 'P_STAGE', 'api', 'api', ${head}, 'refused',
              'Zerops did not answer', now()
            FROM generate_series(1, ${JOBS_SHOWN})`;
          const [stage] = (yield* structure.read("dev")).apps.flatMap((app) =>
            shown(app.environments),
          );
          const jobs = stage?.jobs ?? [];
          assert.strictEqual(jobs.length, JOBS_SHOWN + 1);
          assert.deepStrictEqual(
            [jobs[0], jobs.at(-1)].map((job) => [job?.service, job?.state, job?.cause, job?.ref]),
            [
              ["api", "refused", "merge", head],
              ["web", "live", "merge", head],
            ],
          );
          assert.deepStrictEqual(
            jobs.map((job) => Number(job.id)),
            jobs.map((job) => Number(job.id)).toSorted((left, right) => right - left),
          );
        }),
      ),
    );

    // A production attached after a release carries none of it, however old; a production with no
    // floor (made before it existed) carries the newest approved release as it always did.
    it.effect("carries no release made before the production was attached", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          const shop = yield* structure.createApp("owner", "Shop");
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_MATE",
            kind: "mate",
            mate: { face: "face-1" },
          });
          const sha = "4".repeat(40);
          const releaseAt = (tag: string, ago: string) => sql`
            INSERT INTO hq_release (app_id, tag, sha, entries, released_by, state, released_at)
            VALUES (${shop.id}::uuid, ${tag}, ${sha}, '[]'::jsonb, 'owner', 'approved',
              now() - ${ago}::interval)`;
          const production = Effect.map(structure.read("dev"), (read) =>
            read.apps
              .flatMap((app) => shown(app.environments))
              .flatMap(({ tier, release }) =>
                tier === "production" ? [release?.tag ?? null] : [],
              ),
          );
          yield* releaseAt("v0.1.0", "1 hour");
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_PROD",
            kind: "production",
            environment: { name: "production" },
          });
          assert.deepStrictEqual(yield* production, [null]);
          yield* releaseAt("v0.1.1", "0 seconds");
          assert.deepStrictEqual(yield* production, ["v0.1.1"]);
          // One that existed before the floor did follows the older release too.
          yield* sql`UPDATE hq_environment SET release_floor = NULL WHERE project_id = 'P_PROD'`;
          yield* sql`DELETE FROM hq_release WHERE tag = 'v0.1.1'`;
          assert.deepStrictEqual(yield* production, ["v0.1.0"]);
        }),
      ),
    );

    // Release end (H2): each production carries where its newest release's rollout stands —
    // planned, ended once every job it asked for there ended and every job of a commit it left out
    // as under way ended too — however many jobs came after; a stage carries none.
    it.effect("carries where a production's newest release stands, however many jobs it has", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          const shop = yield* structure.createApp("owner", "Shop");
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_MATE",
            kind: "mate",
            mate: { face: "face-1" },
          });
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_STAGE",
            kind: "stage",
            environment: { name: "stage" },
          });
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_PROD",
            kind: "production",
            environment: { name: "production" },
          });
          const sha = "4".repeat(40);
          /** HQ's record of release `tag`, made before rollouts were or recorded from git. */
          const recorded = (tag: string) => sql`
            INSERT INTO hq_release (app_id, tag, sha, entries, released_by, state)
            VALUES (${shop.id}::uuid, ${tag}, ${sha}, '[]'::jsonb, 'owner', 'approved')`;
          /** Release `tag`, recorded with the rollout that deploys it. */
          const release = (tag: string, planned: boolean) =>
            Effect.andThen(
              recorded(tag),
              Effect.map(
                sql<{ readonly id: string }>`
                  INSERT INTO hq_rollout (app_id, cause, tag, planned_at)
                  VALUES (${shop.id}::uuid, 'release', ${tag},
                    ${sql.literal(planned ? "now()" : "NULL")})
                  RETURNING id::text AS id`,
                (rows) => rows[0]!.id,
              ),
            );
          const jobs = (rolloutId: string, state: string, count: number) =>
            sql<{ readonly id: string }>`
              INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state,
                ended_at)
              SELECT ${rolloutId}::bigint, 'deploy', 'P_PROD', 'api', 'api', ${sha}, ${state},
                ${sql.literal(state === "queued" || state === "building" ? "NULL" : "now()")}
              FROM generate_series(1, ${count})
              RETURNING id::text AS id`;
          const end = (jobId: string) => sql`
            UPDATE hq_deploy_job SET state = 'live', ended_at = now(), updated_at = now()
            WHERE id = ${jobId}::bigint`;
          const standing = Effect.map(structure.read("dev"), (read) =>
            read.apps
              .flatMap((app) => shown(app.environments))
              .map(({ projectId, release: rollout }) => [
                projectId,
                rollout === null
                  ? null
                  : [
                      rollout.tag,
                      rollout.planned,
                      rollout.ended,
                      rollout.endedAt === null ? null : typeof rollout.endedAt,
                      rollout.landed,
                      rollout.leftOut.map((left) => [left.service, left.job]),
                    ],
              ]),
          );

          // Asked for and not planned yet: on its way.
          const first = yield* release("v0.1.0", false);
          assert.deepStrictEqual(yield* standing, [
            ["P_STAGE", null],
            ["P_PROD", ["v0.1.0", false, false, null, false, []]],
          ]);
          // Planned into more jobs than the view lists: its last job, newest, still waits.
          yield* sql`UPDATE hq_rollout SET planned_at = now() WHERE id = ${first}::bigint`;
          yield* jobs(first, "refused", JOBS_SHOWN + 5);
          const [last] = yield* jobs(first, "queued", 1);
          assert.deepStrictEqual((yield* standing)[1], [
            "P_PROD",
            ["v0.1.0", true, false, null, false, []],
          ]);
          yield* end(last!.id);
          // Ended, and not landed: some of its jobs were refused.
          assert.deepStrictEqual((yield* standing)[1], [
            "P_PROD",
            ["v0.1.0", true, true, "string", false, []],
          ]);

          // A newer release that left a service out, its commit building under a merge's job: it
          // runs until that job ends, however its own jobs ended.
          const [merge] = yield* sql<{ readonly id: string }>`
            INSERT INTO hq_rollout (app_id, cause, repo, sha, planned_at)
            VALUES (${shop.id}::uuid, 'merge', 'web', ${sha}, now())
            RETURNING id::text AS id`;
          const [building] = yield* jobs(merge!.id, "building", 1);
          const second = yield* release("v0.2.0", true);
          yield* jobs(second, "live", 1);
          yield* sql`
            UPDATE hq_rollout SET left_out = jsonb_build_array(
              jsonb_build_object('project_id', 'P_PROD', 'service', 'web', 'sha', ${sha}::text,
                'job', ${building!.id}::text, 'reason', 'under way'),
              jsonb_build_object('project_id', 'P_OTHER', 'service', 'web', 'sha', ${sha}::text,
                'job', NULL, 'reason', 'elsewhere'))
            WHERE id = ${second}::bigint`;
          assert.deepStrictEqual((yield* standing)[1], [
            "P_PROD",
            ["v0.2.0", true, false, null, false, [["web", building!.id]]],
          ]);
          yield* end(building!.id);
          // Every job it asked for, and the one it waited on, live: landed.
          assert.deepStrictEqual((yield* standing)[1], [
            "P_PROD",
            ["v0.2.0", true, true, "string", true, [["web", building!.id]]],
          ]);

          // One planned into no job there — every service already runs it — landed as planned.
          yield* release("v0.3.0", true);
          assert.deepStrictEqual((yield* standing)[1], [
            "P_PROD",
            ["v0.3.0", true, true, "string", true, []],
          ]);

          // Review #2 (web, client): a release HQ records with no rollout of its own — made before
          // rollouts were, or recorded from git — deploys nothing more: ended, as it was made, and
          // never on its way. The newest by version is what production follows.
          yield* recorded("v0.10.0");
          assert.deepStrictEqual((yield* standing)[1], [
            "P_PROD",
            ["v0.10.0", true, true, "string", false, []],
          ]);
          const [legacy] = shown((yield* structure.read("dev")).apps[0]!.environments).flatMap(
            ({ release: rollout }) => (rollout === null ? [] : [rollout]),
          );
          assert.strictEqual(legacy?.id, null);
          // Review (delta #4): a tag recorded from git may carry any number of digits — one past
          // what an integer holds is still ordered, newest by version, and nobody's read fails.
          yield* recorded("v1.99999999999.0");
          assert.deepStrictEqual((yield* standing)[1], [
            "P_PROD",
            ["v1.99999999999.0", true, true, "string", false, []],
          ]);
        }),
      ),
    );

    // An environment's birth (H2): the rollout its attach asked for, and its jobs there — and any
    // job of a commit it left out as under way — ended or not, whatever came after; none for an
    // environment HQ did not bring up.
    it.effect(
      "carries whether an environment's birth ended, from the rollout its attach asked",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const sql = yield* SqlClient.SqlClient;
            const shop = yield* structure.createApp("owner", "Shop");
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_MATE",
              kind: "mate",
              mate: { face: "face-1" },
            });
            yield* structure.attachProject("owner", shop.id, {
              projectId: "P_STAGE",
              kind: "stage",
              environment: { name: "stage" },
            });
            const sha = "5".repeat(40);
            const [birth] = yield* sql<{ readonly id: string }>`
            SELECT id::text AS id FROM hq_rollout
            WHERE project_id = 'P_STAGE' AND cause = 'env_added'`;
            const job = (rolloutId: string, state: string) =>
              Effect.map(
                sql<{ readonly id: string }>`
                INSERT INTO hq_deploy_job (rollout_id, kind, project_id, service, repo, sha, state,
                  ended_at)
                VALUES (${rolloutId}::bigint, 'deploy', 'P_STAGE', 'web', 'web', ${sha}, ${state},
                  ${sql.literal(state === "queued" || state === "building" ? "NULL" : "now()")})
                RETURNING id::text AS id`,
                (rows) => rows[0]!.id,
              );
            const end = (jobId: string) => sql`
            UPDATE hq_deploy_job SET state = 'live', ended_at = now(), updated_at = now()
            WHERE id = ${jobId}::bigint`;
            const born = Effect.map(structure.read("dev"), (read) =>
              read.apps
                .flatMap((app) => shown(app.environments))
                .map((environment) => environment.birth),
            );

            // Asked for and not planned yet: still being born.
            assert.deepStrictEqual(yield* born, [{ ended: false }]);
            // Planned into its first deploy, which builds; then live.
            yield* sql`UPDATE hq_rollout SET planned_at = now() WHERE id = ${birth!.id}::bigint`;
            const first = yield* job(birth!.id, "building");
            assert.deepStrictEqual(yield* born, [{ ended: false }]);
            yield* end(first);
            assert.deepStrictEqual(yield* born, [{ ended: true }]);
            // Jobs after it are not its birth's.
            const [merge] = yield* sql<{ readonly id: string }>`
            INSERT INTO hq_rollout (app_id, cause, repo, sha, planned_at)
            VALUES (${shop.id}::uuid, 'merge', 'web', ${sha}, now())
            RETURNING id::text AS id`;
            const later = yield* job(merge!.id, "building");
            assert.deepStrictEqual(yield* born, [{ ended: true }]);
            // A birth that left its service out for that job under way runs until the job ends.
            yield* sql`
            UPDATE hq_rollout SET left_out = jsonb_build_array(jsonb_build_object(
              'project_id', 'P_STAGE', 'service', 'web', 'sha', ${sha}::text,
              'job', ${later}::text, 'reason', 'under way'))
            WHERE id = ${birth!.id}::bigint`;
            assert.deepStrictEqual(yield* born, [{ ended: false }]);
            yield* end(later);
            assert.deepStrictEqual(yield* born, [{ ended: true }]);
            // An environment HQ did not bring up has no birth.
            yield* sql`DELETE FROM hq_rollout WHERE id = ${birth!.id}::bigint`;
            assert.deepStrictEqual(yield* born, [null]);
          }),
        ),
    );

    it.effect("a project gone from Zerops loses its Mate credential and its challenges", () =>
      withStructure((view) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          // Mates that proved their project, in no application.
          yield* sql`
            INSERT INTO hq_mate_credential (credential_hash, project_id)
            VALUES ('hash-other', 'P_OTHER'), ('hash-mate', 'P_MATE')`;
          yield* sql`
            INSERT INTO hq_mate_challenge (nonce_hash, project_id, expires_at)
            VALUES ('nonce-other', 'P_OTHER', now() + interval '2 minutes'),
                   ('nonce-mate', 'P_MATE', now() + interval '2 minutes')`;
          const held = Effect.all([
            Effect.map(
              sql<{ readonly project_id: string }>`
                SELECT project_id FROM hq_mate_credential WHERE revoked_at IS NULL
                ORDER BY project_id`,
              (rows) => rows.map((row) => row.project_id),
            ),
            Effect.map(
              sql<{ readonly project_id: string }>`
                SELECT project_id FROM hq_mate_challenge ORDER BY project_id`,
              (rows) => rows.map((row) => row.project_id),
            ),
          ]);
          assert.strictEqual(yield* structure.reconcile, 0);

          yield* Ref.update(view, (current) => ({
            ...current,
            projects: current.projects.filter((candidate) => candidate.id !== "P_OTHER"),
          }));
          assert.strictEqual(yield* structure.reconcile, 1);
          assert.deepStrictEqual(yield* held, [["P_MATE"], ["P_MATE"]]);
        }),
      ),
    );

    it.effect(
      "finishes a deleted project explicitly, releasing rows and changing the structure",
      () =>
        withStructure((view) =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const sql = yield* SqlClient.SqlClient;
            const app = yield* structure.createApp("owner", "Explicit deletion");
            yield* structure.attachProject("owner", app.id, {
              projectId: "P_OWNED",
              kind: "mate",
              mate: { face: "" },
            });
            const completion = yield* structure.prepareProjectDeletion("maker", "P_OWNED");
            const before = yield* Stream.runHead(structure.changes);
            assert.strictEqual(
              yield* reasonOf(structure.completeProjectDeletion("maker", "P_OWNED", completion)),
              "project_still_exists",
            );
            yield* Ref.update(view, (current) => ({
              ...current,
              projects: current.projects.filter((p) => p.id !== "P_OWNED"),
            }));
            assert.strictEqual(
              yield* reasonOf(structure.completeProjectDeletion("nobody", "P_OWNED", completion)),
              "not_project_admin",
            );
            assert.strictEqual(
              yield* reasonOf(structure.completeProjectDeletion("maker", "P_MATE", completion)),
              "not_project_admin",
            );
            yield* structure.completeProjectDeletion("maker", "P_OWNED", completion);
            assert.deepStrictEqual(
              yield* sql`SELECT 1 FROM hq_mate WHERE project_id = 'P_OWNED'`,
              [],
            );
            assert.deepStrictEqual(
              yield* sql`SELECT 1 FROM hq_app_project WHERE project_id = 'P_OWNED'`,
              [],
            );
            assert.deepStrictEqual((yield* structure.read("owner")).apps[0]?.contents, {
              empty: true,
              deletingProjectIds: [],
            });
            assert.notStrictEqual(
              Option.getOrUndefined(yield* Stream.runHead(structure.changes)),
              Option.getOrUndefined(before),
            );
            // A lost HTTP answer is safe to finish again by hand.
            yield* structure.completeProjectDeletion("maker", "P_OWNED", completion);
          }),
        ),
    );

    it.effect("refuses deletion authorization to a project reader", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          assert.strictEqual(
            yield* reasonOf(structure.prepareProjectDeletion("reader", "P_MATE")),
            "not_project_admin",
          );
        }),
      ),
    );

    it.effect("reports unfinished deletion until HQ releases the deleted Mate's rows", () =>
      withStructure((view) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          const app = yield* structure.createApp("owner", "Zed's app");
          const contents = Effect.map(structure.read("owner"), (read) => read.apps[0]?.contents);
          assert.deepStrictEqual(yield* contents, { empty: true, deletingProjectIds: [] });
          yield* structure.attachProject("owner", app.id, {
            projectId: "P_MATE",
            kind: "mate",
            mate: { face: "face-1" },
          });
          yield* Ref.update(view, (current) => ({
            ...current,
            projects: current.projects.map((p) =>
              p.id === "P_MATE" ? { ...p, status: "DELETING" } : p,
            ),
          }));
          assert.deepStrictEqual(yield* contents, { empty: false, deletingProjectIds: ["P_MATE"] });
          yield* Ref.update(view, (current) => ({
            ...current,
            projects: current.projects.filter((p) => p.id !== "P_MATE"),
          }));
          assert.deepStrictEqual((yield* structure.read("owner")).apps[0]?.projects, []);
          assert.deepStrictEqual(yield* contents, { empty: false, deletingProjectIds: ["P_MATE"] });
          assert.strictEqual(
            (yield* sql`SELECT 1 FROM hq_mate WHERE project_id = 'P_MATE'`).length,
            1,
          );
          assert.strictEqual(
            yield* reasonOf(structure.deleteApp("owner", app.id)),
            "app_not_empty",
          );
          assert.strictEqual(yield* structure.reconcile, 1);
          assert.deepStrictEqual(yield* contents, { empty: true, deletingProjectIds: [] });
          assert.strictEqual(yield* reasonOf(structure.deleteApp("owner", app.id)), "ok");
        }),
      ),
    );

    // E2E 2026-10-03 (F5): a New project that stopped before its Mate left an application with its
    // recipe repository and nothing else, for good. Whoever writes the structure deletes it; its
    // name is free again.
    it.effect("an org owner or admin deletes an application that holds nothing", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const sql = yield* SqlClient.SqlClient;
          const shop = yield* structure.createApp("owner", "Shop");
          // What its New project left: its recipe repository, what HQ saw of it, its git log.
          yield* sql`
            INSERT INTO hq_repo (app_id, name, created_by) VALUES (${shop.id}::uuid, 'group', 'core')`;
          yield* sql`
            INSERT INTO hq_recipe_seen (app_id, tier, digest, blocks)
            VALUES (${shop.id}::uuid, 'stage', 'd', '[]'::jsonb)`;
          yield* sql`
            INSERT INTO hq_git_event (kind, app_id, repo) VALUES ('main_moved', ${shop.id}::uuid, 'group')`;
          assert.deepStrictEqual(
            yield* Effect.all([
              outcome(structure.deleteApp("dev", shop.id)),
              outcome(structure.deleteApp("admin", "00000000-0000-0000-0000-000000000000")),
              outcome(structure.deleteApp("admin", shop.id)),
            ]),
            ["forbidden", "app_not_found", "ok"],
          );
          assert.deepStrictEqual((yield* structure.read("owner")).apps, []);
          const left = yield* sql<{ readonly n: number }>`
            SELECT (SELECT count(*) FROM hq_repo)::int + (SELECT count(*) FROM hq_recipe_seen)::int
                 + (SELECT count(*) FROM hq_git_event)::int AS n`;
          assert.strictEqual(left[0]?.n, 0);
          assert.strictEqual(yield* outcome(structure.createApp("owner", "Shop")), "ok");
        }),
      ),
    );

    it.effect(
      "refuses to delete an application holding a Mate, an environment, a change, a release or code",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const sql = yield* SqlClient.SqlClient;
            const holding = (
              name: string,
              fill: (appId: string) => Effect.Effect<unknown, { readonly _tag: string }, never>,
            ) =>
              Effect.gen(function* () {
                const app = yield* structure.createApp("owner", name);
                yield* fill(app.id);
                const read = yield* structure.read("owner");
                assert.deepStrictEqual(read.apps.find((held) => held.id === app.id)?.contents, {
                  empty: false,
                  deletingProjectIds: [],
                });
                return yield* reasonOf(structure.deleteApp("owner", app.id));
              });
            const repo = (appId: string, name: string) =>
              sql`INSERT INTO hq_repo (app_id, name, created_by) VALUES (${appId}::uuid, ${name}, 'core')`;
            assert.deepStrictEqual(
              yield* Effect.all([
                holding("Mate", (appId) =>
                  structure.attachProject("owner", appId, {
                    projectId: "P_MATE",
                    kind: "mate",
                    mate: { face: "face-1" },
                  }),
                ),
                holding("Stage", (appId) =>
                  structure.attachProject("owner", appId, { projectId: "P_STAGE", kind: "stage" }),
                ),
                holding("Change", (appId) =>
                  Effect.andThen(
                    repo(appId, "group"),
                    sql`
                      INSERT INTO hq_change (app_id, repo, number, mate_project_id, title)
                      VALUES (${appId}::uuid, 'group', 1, 'P_OTHER', 'A recipe')`,
                  ),
                ),
                holding(
                  "Release",
                  (appId) => sql`
                    INSERT INTO hq_release (app_id, tag, sha, entries, released_by, state)
                    VALUES (${appId}::uuid, 'v1.0.0', ${"a".repeat(40)}, '[]'::jsonb, 'owner',
                            'approved')`,
                ),
                holding("Code", (appId) => repo(appId, "appdev")),
              ]),
              Array.from({ length: 5 }, () => "app_not_empty"),
            );
            assert.strictEqual((yield* structure.read("owner")).apps.length, 5);
          }),
        ),
    );

    it.effect("an attach and a delete racing for one empty application: exactly one lands", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          for (let round = 0; round < 4; round += 1) {
            const app = yield* structure.createApp("owner", `Race ${String(round)}`);
            const [attached, deleted] = yield* Effect.all(
              [
                reasonOf(
                  structure.attachProject("owner", app.id, {
                    projectId: "P_STAGE",
                    kind: "stage",
                  }),
                ),
                reasonOf(structure.deleteApp("owner", app.id)),
              ],
              { concurrency: "unbounded" },
            );
            assert.isTrue(
              (attached === "ok" && deleted === "app_not_empty") ||
                (attached === "app_not_found" && deleted === "ok"),
              `${attached} / ${deleted}`,
            );
            if (attached === "ok") {
              yield* structure.moveProject("owner", "P_STAGE", { appId: null, kind: "stage" });
            }
          }
        }),
      ),
    );

    // F22 (2026-10-03): a write waited on a fresh read while KRLS's org-wide reads stalled, and fell
    // with its client. It is decided over the recent view; a refusal of its facts is confirmed over
    // a fresh read, and stands.
    it.effect(
      "decides a write over the recent view, and confirms its refusal over a fresh read",
      () =>
        withStructure((_view, _down, _zerops, asked) =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            yield* Ref.set(asked, []);
            yield* structure.createApp("admin", "Shop");
            assert.deepStrictEqual(yield* Ref.get(asked), ["write recent"]);
            yield* Ref.set(asked, []);
            assert.strictEqual(yield* outcome(structure.createApp("dev", "Blog")), "forbidden");
            assert.deepStrictEqual(yield* Ref.get(asked), ["write recent", "write fresh"]);
            // A refusal the facts did not decide is not asked again.
            yield* Ref.set(asked, []);
            assert.strictEqual(yield* outcome(structure.createApp("admin", "Shop")), "conflict");
            assert.deepStrictEqual(yield* Ref.get(asked), ["write recent"]);
          }),
        ),
    );

    it.effect("an org owner or admin renames an application; a taken name is a conflict", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const shop = yield* structure.createApp("owner", "Shop");
          yield* structure.createApp("owner", "Blog");
          assert.deepStrictEqual(
            yield* Effect.all([
              outcome(structure.renameApp("dev", shop.id, "Dev's")),
              outcome(structure.renameApp("admin", shop.id, "Blog")),
              outcome(structure.renameApp("admin", shop.id, " ")),
              outcome(structure.renameApp("admin", "00000000-0000-0000-0000-000000000000", "X")),
              outcome(structure.renameApp("admin", shop.id, " Store ")),
            ]),
            ["forbidden", "conflict", "invalid", "app_not_found", "ok"],
          );
          assert.deepStrictEqual(
            (yield* structure.read("owner")).apps.map((app) => app.name),
            ["Store", "Blog"],
          );
        }),
      ),
    );

    it.effect(
      "a Mate stands on its own: set up outside any application, listed ungrouped to whoever sees it",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const bo = { projectId: "P_OWNED", face: "olive:clover" };
            assert.deepStrictEqual(
              yield* Effect.all([
                outcome(structure.createMate("dev", { ...bo, projectId: "P_MATE" })),
                outcome(structure.createMate("owner", { ...bo, projectId: "P_GONE" })),
                outcome(structure.createMate("owner", { ...bo, projectId: "HQ" })),
                outcome(structure.createMate("owner", { ...bo, face: "" })),
                outcome(structure.createMate("maker", bo)),
                outcome(structure.createMate("owner", bo)),
                outcome(structure.patchMate("maker", "P_OWNED", { face: "rose:seal" })),
              ]),
              ["forbidden", "project_not_found", "invalid", "invalid", "ok", "conflict", "ok"],
            );
            const ungrouped = (userId: string) =>
              Effect.map(structure.read(userId), (read) =>
                read.ungrouped.map(({ can: _offers, ...entry }) => entry),
              );
            const listed = [
              {
                projectId: "P_OWNED",
                name: "name of P_OWNED",
                mate: { face: "rose:seal", madeBy: "maker", ...UNBORN },
              },
            ];
            assert.deepStrictEqual(yield* ungrouped("maker"), listed);
            assert.deepStrictEqual(yield* ungrouped("owner"), listed);
            assert.deepStrictEqual(yield* ungrouped("dev"), []);
          }),
        ),
    );

    it.effect(
      "moves projects: a Mate by its project's owner or admin into an application they see, an environment by an org owner or admin",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const shop = yield* structure.createApp("owner", "Shop");
            const team = yield* structure.createApp("owner", "Team");
            const blog = yield* structure.createApp("owner", "Blog");
            // maker sees Team through P_TEAM (Read only there), not Shop.
            yield* structure.attachProject("owner", team.id, {
              projectId: "P_TEAM",
              kind: "stage",
            });
            yield* structure.createMate("maker", { projectId: "P_OWNED", face: "olive:clover" });
            const move = (
              userId: string,
              projectId: string,
              appId: string | null,
              kind: "mate" | "stage" | "production",
            ) => outcome(structure.moveProject(userId, projectId, { appId, kind }));
            const steps = [
              move("maker", "P_OWNED", team.id, "mate"),
              move("maker", "P_OWNED", shop.id, "mate"),
              move("dev", "P_OWNED", team.id, "mate"),
              move("maker", "P_OWNED", null, "mate"),
              move("maker", "P_OWNED", null, "mate"),
              move("owner", "P_OWNED", team.id, "mate"),
              move("owner", "P_OWNED", blog.id, "mate"),
              move("owner", "P_STAGE", shop.id, "stage"),
              move("maker", "P_STAGE", team.id, "stage"),
              move("owner", "P_PROD", shop.id, "production"),
              move("owner", "P_PROD2", shop.id, "production"),
              move("owner", "P_MATE", shop.id, "mate"),
              move("owner", "P_STAGE", "00000000-0000-0000-0000-000000000000", "stage"),
              move("owner", "P_GONE", shop.id, "stage"),
              move("owner", "P_STAGE", null, "stage"),
            ];
            const outcomes: Array<string> = [];
            for (const step of steps) outcomes.push(yield* step);
            assert.deepStrictEqual(outcomes, [
              "ok",
              "forbidden",
              "forbidden",
              "ok",
              "ok",
              "ok",
              "ok",
              "ok",
              "forbidden",
              "ok",
              "conflict",
              "invalid",
              "app_not_found",
              "project_not_found",
              "ok",
            ]);
            const read = yield* structure.read("owner");
            assert.deepStrictEqual(
              read.apps.map(
                (app) =>
                  `${app.name}: ${app.projects.map((p) => `${p.projectId} ${p.kind}`).join(",")}`,
              ),
              ["Shop: P_PROD production", "Team: P_TEAM stage", "Blog: P_OWNED mate"],
            );
            assert.deepStrictEqual(read.ungrouped, []);
          }),
        ),
    );

    it.effect("reads only what the caller sees in Zerops, and nothing Zerops no longer has", () =>
      withStructure((view) =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const shop = yield* structure.createApp("owner", "Shop");
          const blog = yield* structure.createApp("owner", "Blog");
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_MATE",
            kind: "mate",
            mate: { face: "face-3" },
          });
          yield* structure.attachProject("owner", shop.id, { projectId: "P_STAGE", kind: "stage" });
          const seen = (userId: string) =>
            Effect.map(structure.read(userId), (read) =>
              read.apps.map(
                (app) => `${app.name}: ${app.projects.map((p) => p.projectId).join(",")}`,
              ),
            );

          assert.deepStrictEqual(yield* seen("owner"), ["Shop: P_MATE,P_STAGE", "Blog: "]);
          assert.deepStrictEqual(yield* seen("reader"), ["Shop: P_MATE,P_STAGE", "Blog: "]);
          assert.deepStrictEqual(yield* seen("dev"), ["Shop: P_MATE"]);
          assert.deepStrictEqual(yield* seen("nobody"), []);
          assert.deepStrictEqual(yield* seen("stranger"), []);
          assert.deepStrictEqual(recordsOf((yield* structure.read("owner")).apps)[0]?.projects[0], {
            projectId: "P_MATE",
            name: "name of P_MATE",
            kind: "mate",
            mate: { face: "face-3", madeBy: "owner", ...UNBORN },
          });

          yield* Ref.update(view, (current) => ({
            ...current,
            projects: current.projects.filter((candidate) => candidate.id !== "P_STAGE"),
          }));
          assert.deepStrictEqual(yield* seen("owner"), ["Shop: P_MATE", "Blog: "]);
          assert.strictEqual(blog.name, "Blog");
        }),
      ),
    );
  });
});

describe("original lifecycle receipts", () => {
  it.layer(tempPostgresLayer, { excludeTestServices: true })((it) => {
    it.effect.each(["present", "absent", "refused", "outage"] as const)(
      "key cleanup is retained only from source-proven absence: %s",
      (caseName) =>
        withStructure((view, _down, world) =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const sql = yield* SqlClient.SqlClient;
            const core = {
              id: "core",
              name: "Core",
              orgId: "ORG",
              roleCode: "READ_ONLY",
              canCreateProjects: false,
              canViewFinances: false,
              canEditFinances: false,
              projects: [],
              createdMs: 0,
              createdByUser: null,
            };
            world.tokens.set("org-key", core);
            if (caseName !== "absent")
              world.tokens.set("key-value", {
                ...core,
                id: "exact-key",
                orgId: caseName === "refused" ? "elsewhere" : "ORG",
              });
            yield* structure.createMate("owner", { projectId: "P_MATE", face: "face" });
            yield* sql`INSERT INTO hq_mate_credential (credential_hash, project_id, key_token_id) VALUES ('fake-hash', 'P_MATE', 'exact-key')`;
            const target = { orgId: "ORG", hqProjectId: "HQ", projectId: "P_MATE" };
            const prepared = yield* structure.lifecycleWrite("owner", "prepare", {
              kind: "prepare-mate-deletion",
              ...target,
            });
            const completion = prepared.result!.completion;
            yield* Ref.update(view, (current) => ({
              ...current,
              projects: current.projects.filter((row) => row.id !== "P_MATE"),
            }));
            yield* structure.lifecycleWrite("owner", "prepare:complete", {
              kind: "complete-mate-deletion",
              ...target,
              preparedRequestId: "prepare",
              completion,
            });
            world.down = caseName === "outage";
            const retired = {
              kind: "complete-key-retirement" as const,
              ...target,
              preparedRequestId: "prepare",
              completionRequestId: "prepare:complete",
            };
            if (caseName === "absent") {
              const receipt = yield* structure.lifecycleWrite("owner", "prepare:retired", retired);
              assert.deepStrictEqual(
                yield* structure.lifecycleReceipt("owner", "prepare:retired"),
                receipt,
              );
              yield* Ref.update(view, (current) => ({
                ...current,
                members: current.members.filter((member) => member.userId !== "owner"),
              }));
              assert.strictEqual(
                yield* reasonOf(structure.lifecycleWrite("owner", "prepare:retired", retired)),
                "not_active_member",
              );
            } else {
              assert.strictEqual(
                yield* outcome(structure.lifecycleWrite("owner", "prepare:retired", retired)),
                caseName === "present"
                  ? "conflict"
                  : caseName === "outage"
                    ? "ZeropsUnavailable"
                    : "insufficientPermissions",
              );
              assert.strictEqual(
                yield* structure.lifecycleReceipt("owner", "prepare:retired"),
                null,
              );
            }
          }),
        ),
    );
    it.effect.each(["accepted", "source changed", "class changed"] as const)(
      "Move keeps the original review: %s",
      (caseName) =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const source = yield* structure.createApp("owner", "Source");
            const destination = yield* structure.createApp("owner", "Destination");
            yield* structure.attachProject("owner", source.id, {
              projectId: "P_MATE",
              kind: "mate",
              mate: { face: "face" },
            });
            const intent = {
              kind: "move-project" as const,
              orgId: "ORG",
              hqProjectId: "HQ",
              projectId: "P_MATE",
              from: {
                appId: caseName === "source changed" ? null : source.id,
                kind: "mate" as const,
              },
              to: {
                appId: destination.id,
                kind: caseName === "class changed" ? ("production" as const) : ("mate" as const),
              },
              rename: { from: "name of P_MATE", name: "Destination - Mate" },
            };
            if (caseName !== "accepted") {
              assert.strictEqual(
                yield* reasonOf(structure.lifecycleWrite("owner", "move-original", intent)),
                caseName === "source changed" ? "held_changed" : "class_move_receipt_required",
              );
              assert.strictEqual(yield* structure.lifecycleReceipt("owner", "move-original"), null);
              return;
            }
            const receipt = yield* structure.lifecycleWrite("owner", "move-original", intent);
            assert.deepStrictEqual(
              yield* structure.lifecycleWrite("owner", "move-original", intent),
              receipt,
            );
            assert.deepStrictEqual(
              yield* structure.lifecycleReceipt("owner", "move-original"),
              receipt,
            );
            assert.strictEqual(yield* structure.lifecycleReceipt("reader", "move-original"), null);
            assert.deepStrictEqual((yield* structure.read("owner")).lifecycle, [receipt]);
            assert.strictEqual(
              yield* reasonOf(
                structure.lifecycleWrite("owner", "move-original", {
                  ...intent,
                  rename: { ...intent.rename, name: "Other" },
                }),
              ),
              "held_changed",
            );
          }),
        ),
    );
    it.effect(
      "deletion retains its exact key and sealed completion after the project's roles disappear",
      () =>
        withStructure((view) =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const sql = yield* SqlClient.SqlClient;
            yield* structure.createMate("owner", { projectId: "P_MATE", face: "face" });
            yield* sql`INSERT INTO hq_mate_credential (credential_hash, project_id, key_token_id) VALUES ('fake-hash', 'P_MATE', 'exact-key')`;
            const target = { orgId: "ORG", hqProjectId: "HQ", projectId: "P_MATE" };
            const prepared = yield* structure.lifecycleWrite("owner", "prepare-original", {
              kind: "prepare-mate-deletion",
              ...target,
            });
            assert.strictEqual(prepared.result?.keyTokenId, "exact-key");
            const completion = prepared.result?.completion;
            assert.isDefined(completion);
            if (completion === undefined) return;
            yield* Ref.update(view, (current) => ({
              ...current,
              projects: current.projects.filter((row) => row.id !== "P_MATE"),
            }));
            const complete = {
              kind: "complete-mate-deletion" as const,
              ...target,
              preparedRequestId: "prepare-original",
              completion,
            };
            assert.strictEqual(
              yield* reasonOf(structure.lifecycleWrite("reader", "wrong-owner", complete)),
              "not_project_admin",
            );
            const completed = yield* structure.lifecycleWrite(
              "owner",
              "complete-original",
              complete,
            );
            assert.deepStrictEqual(
              yield* structure.lifecycleWrite("owner", "complete-original", complete),
              completed,
            );
            assert.deepStrictEqual(
              yield* structure.lifecycleReceipt("owner", "prepare-original"),
              prepared,
            );
            const retired = {
              kind: "complete-key-retirement" as const,
              ...target,
              preparedRequestId: "prepare-original",
              completionRequestId: "complete-original",
            };
            assert.strictEqual(
              yield* reasonOf(structure.lifecycleWrite("reader", "wrong-retirement", retired)),
              "not_project_admin",
            );
          }),
        ),
    );
  });
});
