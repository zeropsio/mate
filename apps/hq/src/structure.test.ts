import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

import { activeCoreLayer, untilActive } from "../test/harness/activeCore.ts";
import { TempPostgres, tempPostgresLayer } from "../test/harness/tempPostgres.ts";
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
});

/**
 * owner, admin; dev is NO_ACCESS with a grant on P_MATE; reader is org READ_ONLY; nobody is
 * NO_ACCESS; maker is NO_ACCESS who can create projects, Basic user on their new Mate P_OWN and
 * Read only on P_TEAM; basic is org Basic user who can create projects, with no grant of their own.
 */
const VIEW: OrgView = {
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
  ],
};

/**
 * Structure over a fresh database and a Zerops whose view is `view`; a project exists while the
 * view has it, and `down` makes asking for one unanswerable.
 */
const withStructure = <A, E>(
  use: (view: Ref.Ref<OrgView>, down: Ref.Ref<boolean>) => Effect.Effect<A, E, Structure>,
) =>
  Effect.gen(function* () {
    const url = yield* (yield* TempPostgres).createDatabase;
    const view = yield* Ref.make(VIEW);
    const down = yield* Ref.make(false);
    const roles = Layer.succeed(Roles, {
      view: Ref.get(view),
      fresh: Ref.get(view),
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
            assert.include(refused.message, "their own new Mate");
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
            mate: { name: "Ada", face: "face-3" },
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
