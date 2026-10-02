import { assert, describe, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
import { mateLiveLayer } from "./mateLive.ts";
import { type OrgView, Roles } from "./roles.ts";
import { Structure, structureLayer } from "./structure.ts";
import { type ZeropsMember, type ZeropsProject, ZeropsUnavailable } from "./zerops/api.ts";

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
 * NO_ACCESS; maker is NO_ACCESS who can create projects, Basic user on their new Mate P_OWN and
 * Read only on P_TEAM; basic is org Basic user who can create projects, with no grant of their own.
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
    project("P_OTHER"),
    // maker made this Mate: Zerops left them its OWNER.
    project("P_OWNED", [{ clientUserId: "C-maker", roleCode: "OWNER" }]),
  ],
};

/**
 * Structure over a fresh database and a Zerops whose view is `view`; a project exists while the
 * view has it, and `down` makes asking for one unanswerable.
 */
const withStructure = <A, E>(
  use: (
    view: Ref.Ref<Org>,
    down: Ref.Ref<boolean>,
  ) => Effect.Effect<A, E, Structure | SqlClient.SqlClient>,
) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const view = yield* Ref.make(VIEW);
    const down = yield* Ref.make(false);
    const roles = Layer.succeed(Roles, {
      view: Effect.map(Ref.get(view), (org) => ({ ...org, freshness: "cached" as const })),
      fresh: Effect.map(Ref.get(view), (org) => ({ ...org, freshness: "fresh" as const })),
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
      ),
    );
    return yield* Effect.andThen(untilActive, use(view, down)).pipe(Effect.provide(context));
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
                    mate: { ...mate, ...UNBORN },
                  },
                  { projectId: "P_STAGE", name: "name of P_STAGE", kind: "stage", mate: null },
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
                    mate: { name: "Bo", face: "face-1", ...UNBORN },
                  },
                ],
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
              { name: "Ada", face: "face-3", ...UNBORN },
            );
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
            standupRequestedBy: "owner",
            closedOff: true,
          });
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
            { name: "Ada 2", face: "face-3", ...UNBORN },
            { name: "Mine", face: "olive:clover", ...UNBORN },
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
                mate: { name: "Bo 2", face: "olive:clover", ...UNBORN },
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
            mate: { name: "Ada", face: "face-3", ...UNBORN },
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
