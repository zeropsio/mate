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
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { mateLiveLayer } from "./mateLive.ts";
import { treeMigrations } from "./migrationFiles.ts";
import { migrate } from "./migrations.ts";
import { type OrgView, Roles } from "./roles.ts";
import { type MateRecord, Structure, structureLayer } from "./structure.ts";
import { type FakeWorld, emptyWorld, fakeZeropsApi } from "../test/harness/zeropsFake.ts";
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
const UNBORN = { standupRequestedBy: null, closedOff: false } as const;

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
  ) => Effect.Effect<A, E, Structure | SqlClient.SqlClient>,
  before?: Effect.Effect<void, B, SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    if (before !== undefined) {
      yield* before.pipe(Effect.provide(PgClient.layer({ url: Redacted.make(url) })));
    }
    const view = yield* Ref.make(VIEW);
    const down = yield* Ref.make(false);
    const zerops = emptyWorld();
    const roles = Layer.succeed(Roles, {
      view: Effect.map(Ref.get(view), (org) => ({ ...org, freshness: "cached" as const })),
      fresh: Effect.map(Ref.get(view), (org) => ({ ...org, freshness: "fresh" as const })),
      recent: Effect.map(Ref.get(view), (org) => ({ ...org, freshness: "cached" as const })),
      exists: (projectId) =>
        Effect.flatMap(Ref.get(down), (isDown) =>
          isDown
            ? Effect.fail(new ZeropsUnavailable({ operation: "project", message: "down" }))
            : Effect.map(Ref.get(view), (current) =>
                current.projects.some((candidate) => candidate.id === projectId),
              ),
        ),
    });
    const context = yield* Layer.build(
      structureLayer({ hqProjectId: "HQ" }).pipe(
        Layer.provideMerge(activeCoreLayer(url)),
        Layer.provide(roles),
        Layer.provide(mateLiveLayer),
        Layer.provide(Layer.succeed(ZeropsApi, fakeZeropsApi(zerops))),
      ),
    );
    return yield* Effect.andThen(untilActive, use(view, down, zerops)).pipe(
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
  deploys: [],
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
        const environment = app?.environments.find(
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
            mate: { name: "Ada", face: "face-1" },
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
            mate: { name: "Bo", face: "face-2" },
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
            reasonOf(
              structure.createMate("maker", { projectId: "P_RACE1", name: "Ada", face: "f" }),
            ),
          );
          yield* sql<{ readonly waiting: number }>`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE wait_event_type = 'Lock' AND query LIKE '%INSERT INTO hq_mate%'`.pipe(
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
            const mate = { name: "Ada", face: "face-3" };
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
            const mate = { name: "Bo", face: "face-1" };
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
            const mate = { name: "Ada", face: "face-3" };
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
                    mate: { name: "Bo", face: "face-1" },
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
            assert.deepStrictEqual((yield* structure.read("owner")).apps, [
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
                    mate: { name: "Bo", face: "face-1", madeBy: "maker", ...UNBORN },
                  },
                ],
                environments: [environmentRow("P_TEAM", "stage", "name-of-p-team", 1)],
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
                structure.createMate("maker", { projectId: "P_OWNED", name: "Bo", face: "face-1" }),
              ),
              "forbidden",
            );
            // A record there already (written before this rule) still does not make it a Mate.
            yield* sql`INSERT INTO hq_mate (project_id, name, face) VALUES ('P_OWNED', 'Bo', 'face-1')`;
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
              mate: { name: "Bo", face: "face-1" },
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
      "attaching a Mate that is set up already keeps its record: renaming is its admin's (N-4)",
      () =>
        withStructure(() =>
          Effect.gen(function* () {
            const structure = yield* Structure;
            const team = yield* structure.createApp("owner", "Team");
            yield* structure.attachProject("owner", team.id, {
              projectId: "P_TEAM",
              kind: "stage",
            });
            yield* structure.createMate("owner", {
              projectId: "P_OWN",
              name: "Ada",
              face: "face-3",
            });
            // maker may attach their own new Mate, but is only its Basic user: no renaming.
            yield* structure.attachProject("maker", team.id, {
              projectId: "P_OWN",
              kind: "mate",
              mate: { name: "Bo", face: "face-1" },
            });
            const read = yield* structure.read("owner");
            assert.deepStrictEqual(
              read.apps[0]?.projects.find((project) => project.projectId === "P_OWN")?.mate,
              { name: "Ada", face: "face-3", madeBy: "owner", ...UNBORN },
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
              yield* structure.createMate("owner", {
                projectId: "P_OWN",
                name: "Bo",
                face: "face-1",
              });
              const mateOf = (projectId: string) =>
                Effect.map(
                  structure.read("owner"),
                  (read) => read.ungrouped.find((entry) => entry.projectId === projectId)?.mate,
                );
              assert.deepStrictEqual(yield* mateOf("P_MATE"), {
                name: "Ada",
                face: "face-3",
                madeBy: null,
                standupRequestedBy: null,
                closedOff: true,
              });
              assert.deepStrictEqual(yield* mateOf("P_OWN"), {
                name: "Bo",
                face: "face-1",
                madeBy: "owner",
                ...UNBORN,
              });

              yield* structure.markBirth("owner", "P_OWN", "closed_off");
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

    // The press records its ask and the close-off as the Mate is born (`markBirth`); whoever reads
    // the project reads them with the record, and the structure is told at once.
    it.effect("reads a Mate's birth with its record, and says so as it is marked", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          yield* structure.createMate("owner", {
            projectId: "P_MATE",
            name: "Ada",
            face: "face-3",
          });
          const mateOf = (userId: string) =>
            Effect.map(structure.read(userId), (read) => read.ungrouped[0]?.mate);
          assert.deepStrictEqual(yield* mateOf("reader"), {
            name: "Ada",
            face: "face-3",
            madeBy: "owner",
            standupRequestedBy: null,
            closedOff: false,
          });

          const told = yield* Stream.runHead(Stream.drop(structure.changes, 1)).pipe(
            Effect.forkChild,
          );
          yield* Effect.yieldNow;
          yield* structure.markBirth("owner", "P_MATE", "standup");
          assert.isTrue(Option.isSome(yield* Fiber.join(told)));
          yield* structure.markBirth("owner", "P_MATE", "closed_off");

          assert.deepStrictEqual(yield* mateOf("reader"), {
            name: "Ada",
            face: "face-3",
            madeBy: "owner",
            standupRequestedBy: "owner",
            closedOff: true,
          });
        }),
      ),
    );

    // The person whose sign-in a Mate waits for: whoever set its record up, by their session —
    // never a field a client sends. Attaching a Mate set up already keeps its maker.
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
            name: "Ada",
            face: "face-3",
            madeBy: "dev",
          } as MateRecord);
          assert.strictEqual(yield* madeByOf("P_MATE"), "owner");

          const team = yield* structure.createApp("owner", "Team");
          yield* structure.attachProject("owner", team.id, { projectId: "P_TEAM", kind: "stage" });
          yield* structure.attachProject("maker", team.id, {
            projectId: "P_OWN",
            kind: "mate",
            mate: { name: "Bo", face: "face-1" },
          });
          assert.strictEqual(yield* madeByOf("P_OWN"), "maker");

          // Attached by somebody else, a Mate set up already keeps the person who made it.
          yield* structure.attachProject("admin", team.id, {
            projectId: "P_MATE",
            kind: "mate",
            mate: { name: "Ada", face: "face-3" },
          });
          assert.strictEqual(yield* madeByOf("P_MATE"), "owner");
        }),
      ),
    );

    it.effect("renames a Mate and changes its face: whoever is owner or admin on its project", () =>
      withStructure(() =>
        Effect.gen(function* () {
          const structure = yield* Structure;
          const shop = yield* structure.createApp("owner", "Shop");
          const attachMate = (projectId: string, name: string) =>
            structure.attachProject("owner", shop.id, {
              projectId,
              kind: "mate",
              mate: { name, face: "face-3" },
            });
          yield* attachMate("P_MATE", "Ada");
          yield* attachMate("P_OWNED", "Bo");
          yield* structure.attachProject("owner", shop.id, { projectId: "P_STAGE", kind: "stage" });
          assert.deepStrictEqual(
            yield* Effect.all([
              outcome(structure.patchMate("owner", "P_MATE", { name: " Ada 2 " })),
              outcome(
                structure.patchMate("maker", "P_OWNED", { name: "Mine", face: "olive:clover" }),
              ),
              outcome(structure.patchMate("dev", "P_MATE", { face: "sky:flower" })),
              outcome(structure.patchMate("reader", "P_MATE", { name: "Reader's" })),
              outcome(structure.patchMate("owner", "P_STAGE", { name: "Stage" })),
              outcome(structure.patchMate("owner", "P_GONE", { name: "Gone" })),
              outcome(structure.patchMate("owner", "P_MATE", {})),
              outcome(structure.patchMate("owner", "P_MATE", { name: " " })),
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
              "invalid",
            ],
          );
          const mates = (yield* structure.read("owner")).apps[0]?.projects.map((p) => p.mate);
          assert.deepStrictEqual(mates, [
            { name: "Ada 2", face: "face-3", madeBy: "owner", ...UNBORN },
            { name: "Mine", face: "olive:clover", madeBy: "owner", ...UNBORN },
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
              mate: { name: "Ada", face: "face-3" },
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
              mate: { name: "Ada", face: "face-1" },
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
                ...(kind === "mate" ? { mate: { name: "Ada", face: "face-1" } } : {}),
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
              (read) => read.apps[0]?.environments[0]?.keyInvalid,
            );
            assert.strictEqual(yield* keyInvalid, false);
            yield* sql`UPDATE hq_deploy_token SET invalid_since = now()`;
            assert.strictEqual(yield* keyInvalid, true);
            assert.strictEqual(yield* keep("maker", "stage", "key-stage"), "ok");
            assert.strictEqual(yield* keyInvalid, false);
            const [kept] = yield* sql<{ readonly token: string }>`
              SELECT token FROM hq_deploy_token WHERE project_id = 'P_OWNED'`;
            assert.strictEqual(kept?.token, "key-stage");
            assert.notInclude(encodeJson(yield* structure.read("owner")), "key-stage");
          }),
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
            mate: { name: "Ada", face: "face-1" },
          });
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_STAGE",
            kind: "stage",
            environment: { name: "stage" },
          });
          yield* structure.attachProject("owner", shop.id, {
            projectId: "P_TEAM",
            kind: "mate",
            mate: { name: "Bo", face: "face-2" },
          });
          const [one, two, three] = ["1".repeat(40), "2".repeat(40), "3".repeat(40)] as const;
          yield* sql`
            INSERT INTO hq_deploy (project_id, service, sha, repo, state, failure, message,
              app_version_id, process_id, requested_by, created_at, updated_at)
            VALUES
              ('P_STAGE', 'web', ${one}, 'web', 'live', NULL, NULL, 'V1', 'J1', NULL,
                now() - interval '3 minutes', now() - interval '2 minutes'),
              ('P_STAGE', 'web', ${two}, 'web', 'failed', 'job', 'failed: Build failed', 'V2',
                'J2', 'dev', now() - interval '1 minute', now()),
              ('P_STAGE', 'api', ${three}, 'api', 'pending', NULL, NULL, NULL, NULL, NULL, now(),
                now())`;
          const read = (userId: string) =>
            Effect.map(structure.read(userId), (structureRead) =>
              structureRead.apps.map((app) => ({
                projects: app.projects.map((project) => project.projectId),
                environments: app.environments.map(({ projectId, deploys }) => ({
                  projectId,
                  deploys: deploys.map(({ service, latest, live }) => ({
                    service,
                    latest: [
                      latest.sha,
                      latest.state,
                      latest.failure,
                      latest.message,
                      latest.processId,
                      latest.requestedBy,
                    ],
                    live: live === null ? null : [live.sha, live.appVersionId, typeof live.at],
                  })),
                })),
              })),
            );
          const seen = [
            {
              projects: ["P_MATE"],
              environments: [
                {
                  projectId: "P_STAGE",
                  deploys: [
                    {
                      service: "api",
                      latest: [three, "pending", null, null, null, null],
                      live: null,
                    },
                    {
                      service: "web",
                      latest: [two, "failed", "job", "failed: Build failed", "J2", "dev"],
                      live: [one, "V1", "string"],
                    },
                  ],
                },
              ],
            },
          ];
          // dev develops Shop through P_MATE (Basic user there), and does not read its stage's
          // project; maker sees Shop only through a Read only grant on P_TEAM.
          assert.deepStrictEqual(yield* read("dev"), seen);
          assert.deepStrictEqual(yield* read("maker"), [
            { projects: ["P_TEAM"], environments: [] },
          ]);
          assert.deepStrictEqual(yield* read("nobody"), []);
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
                    mate: { name: "Ada", face: "face-1" },
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
            const bo = { projectId: "P_OWNED", name: "Bo", face: "olive:clover" };
            assert.deepStrictEqual(
              yield* Effect.all([
                outcome(structure.createMate("dev", { ...bo, projectId: "P_MATE" })),
                outcome(structure.createMate("owner", { ...bo, projectId: "P_GONE" })),
                outcome(structure.createMate("owner", { ...bo, projectId: "HQ" })),
                outcome(structure.createMate("owner", { ...bo, name: " " })),
                outcome(structure.createMate("maker", bo)),
                outcome(structure.createMate("owner", bo)),
                outcome(structure.patchMate("maker", "P_OWNED", { name: "Bo 2" })),
              ]),
              ["forbidden", "project_not_found", "invalid", "invalid", "ok", "conflict", "ok"],
            );
            const ungrouped = (userId: string) =>
              Effect.map(structure.read(userId), (read) => read.ungrouped);
            const listed = [
              {
                projectId: "P_OWNED",
                name: "name of P_OWNED",
                mate: { name: "Bo 2", face: "olive:clover", madeBy: "maker", ...UNBORN },
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
            yield* structure.createMate("maker", {
              projectId: "P_OWNED",
              name: "Bo",
              face: "olive:clover",
            });
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
            mate: { name: "Ada", face: "face-3" },
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
          assert.deepStrictEqual((yield* structure.read("owner")).apps[0]?.projects[0], {
            projectId: "P_MATE",
            name: "name of P_MATE",
            kind: "mate",
            mate: { name: "Ada", face: "face-3", madeBy: "owner", ...UNBORN },
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
