/**
 * The structure of applications (ADR 0002): applications, the Zerops projects each holds with
 * their kind (`mate`, `devstage`, `stage`, `production`), and the Mate record of a Mate's project.
 * A `devstage` project is a Mate that also serves as its application's stage (main's "Dev /
 * Stage"): a Mate by its record and its rules, a stage by the one-production rule. HQ is its
 * only writer; every write is fenced by the leader and checks the writer against Zerops read fresh.
 *
 * Who may: an active org owner or admin writes, as main's `canWriteRegistry` (parity B #41, #73,
 * #77); a member who can create projects also attaches their own new Mate (`canAttachMate`). A reader sees an application while their org role is Read only or above, or while they see
 * one of its projects; a project while their effective role on it is above `NO_ACCESS` and Zerops
 * still has it.
 *
 * @module structure
 */
import type { RoleProjectKind } from "@t3tools/shared/zeropsRoles";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { Leader, type NotLeader } from "./leader.ts";
import { Roles, canAttachMate, canEditMate, canWriteStructure, sees, seesApp } from "./roles.ts";
import type { ZeropsError } from "./zerops/api.ts";

export class StructureRefused extends Schema.TaggedError<StructureRefused>()("StructureRefused", {
  code: Schema.Literals([
    "forbidden",
    "app_not_found",
    "project_not_found",
    "mate_not_found",
    "invalid",
    "conflict",
  ]),
  message: Schema.String,
}) {}

export interface AttachInput {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  readonly mate?: { readonly name: string; readonly face: string };
}

export interface MateRecord {
  readonly projectId: string;
  readonly name: string;
  readonly face: string;
}

export interface StructureRead {
  /** The Mates in no application: their project's name in Zerops and their record. */
  readonly ungrouped: ReadonlyArray<{
    readonly projectId: string;
    readonly name: string;
    readonly mate: { readonly name: string; readonly face: string };
  }>;
  readonly apps: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly projects: ReadonlyArray<{
      readonly projectId: string;
      readonly name: string;
      readonly kind: string;
      readonly mate: { readonly name: string; readonly face: string } | null;
    }>;
  }>;
}

type WriteError = StructureRefused | NotLeader | SqlError | ZeropsError;

export class Structure extends Context.Service<
  Structure,
  {
    readonly createApp: (
      userId: string,
      name: string,
    ) => Effect.Effect<{ readonly id: string; readonly name: string }, WriteError>;
    readonly renameApp: (
      userId: string,
      appId: string,
      name: string,
    ) => Effect.Effect<{ readonly id: string; readonly name: string }, WriteError>;
    readonly attachProject: (
      userId: string,
      appId: string,
      input: AttachInput,
    ) => Effect.Effect<void, WriteError>;
    /**
     * Moves a project into an application as `kind`, or out of any (`appId: null`, `kind` aside):
     * a Mate by an owner or admin of its project, into an application they see; an environment
     * by an org owner or admin. A Mate out of any application is listed `ungrouped`.
     */
    readonly moveProject: (
      userId: string,
      projectId: string,
      target: { readonly appId: string | null; readonly kind: AttachInput["kind"] },
    ) => Effect.Effect<
      {
        readonly projectId: string;
        readonly appId: string | null;
        readonly kind: AttachInput["kind"] | null;
      },
      WriteError
    >;
    /** Sets a Mate up: its record, in no application until it is moved into one. */
    readonly createMate: (
      userId: string,
      mate: MateRecord,
    ) => Effect.Effect<MateRecord, WriteError>;
    /** Renames a Mate, changes its face, or both. */
    readonly patchMate: (
      userId: string,
      projectId: string,
      patch: { readonly name?: string; readonly face?: string },
    ) => Effect.Effect<MateRecord, WriteError>;
    readonly read: (userId: string) => Effect.Effect<StructureRead, SqlError | ZeropsError>;
    /**
     * Follows Zerops: what HQ holds of projects it no longer has (missing from the org's list, and
     * refused by id) goes, Mate credentials included; answers how many projects. Nothing moves
     * while Zerops cannot say.
     */
    readonly reconcile: Effect.Effect<number, NotLeader | SqlError | ZeropsError>;
    /** Ticks after every change of the structure, starting with the current tick. */
    readonly changes: Stream.Stream<number>;
  }
>()("@t3tools/hq/structure") {}

const refuse = (code: StructureRefused["code"], message: string) =>
  Effect.fail(new StructureRefused({ code, message }));

const fitsName = (name: string) => name.length >= 1 && name.length <= 100;

/** A kind whose project is a Mate: it carries a Mate record and follows a Mate's rules. */
const isMate = (kind: string) => kind === "mate" || kind === "devstage";

const WRITERS_ONLY = "Only an org owner or admin changes the structure.";
const MATE_MOVERS_ONLY =
  "Only an owner or admin of the Mate's project moves it, and only into an application they see.";
const MATE_EDITORS_ONLY =
  "Only an owner or admin of the Mate's project sets it up, renames it or changes its face.";
const MATE_ATTACHERS_ONLY =
  "Only an org owner or admin attaches a Mate, or a member who can create projects attaches their own new Mate to an application they see.";

const isUniqueViolation = (error: { readonly _tag: string }) =>
  error._tag === "SqlError" && (error as SqlError).reason._tag === "UniqueViolation";

/** A unique constraint the write ran into is a conflict with what is already there. */
const conflictOnUnique = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
  message: string,
) =>
  effect.pipe(
    Effect.catchIf(
      (error: E) => isUniqueViolation(error),
      () => refuse("conflict", message),
    ),
  );

export const structureLayer = (options: {
  readonly hqProjectId: string;
  /** How often the leader reconciles with Zerops (SPEC §4); 60 s. */
  readonly reconcileEvery?: Duration.Duration;
}): Layer.Layer<Structure, never, Leader | Roles | SqlClient.SqlClient> =>
  Layer.effect(
    Structure,
    Effect.gen(function* () {
      const leader = yield* Leader;
      const roles = yield* Roles;
      const sql = yield* SqlClient.SqlClient;
      const version = yield* SubscriptionRef.make(0);
      const changed = SubscriptionRef.update(version, (tick) => tick + 1);

      /** The projects of `projectIds` Zerops refuses by id; any other failure is no answer. */
      const goneOf = (projectIds: ReadonlyArray<string>) =>
        Effect.map(
          Effect.forEach(projectIds, (projectId) =>
            Effect.map(roles.exists(projectId), (exists) => (exists ? [] : [projectId])),
          ),
          (found) => found.flat(),
        );
      /**
       * In a fenced write: what HQ holds of the projects `gone` goes — their rows, their Mate
       * records first, their Mates' challenges, and their Mate credentials are revoked
       * (`mateCredentials.ts`).
       */
      const dropRows = (gone: ReadonlyArray<string>) =>
        gone.length === 0
          ? Effect.void
          : Effect.all([
              sql`DELETE FROM hq_mate WHERE ${sql.in("project_id", gone)}`,
              sql`DELETE FROM hq_app_project WHERE ${sql.in("project_id", gone)}`,
              sql`DELETE FROM hq_mate_challenge WHERE ${sql.in("project_id", gone)}`,
              sql`
                UPDATE hq_mate_credential SET revoked_at = now()
                WHERE ${sql.in("project_id", gone)} AND revoked_at IS NULL`,
            ]);

      const reconcile = Effect.gen(function* () {
        const listed = new Set((yield* roles.fresh).projects.map((project) => project.id));
        const rows = yield* sql<{ readonly project_id: string }>`
          SELECT project_id FROM hq_app_project
          UNION SELECT project_id FROM hq_mate
          UNION SELECT project_id FROM hq_mate_challenge
          UNION SELECT project_id FROM hq_mate_credential WHERE revoked_at IS NULL`;
        const gone = yield* goneOf(
          rows.map((row) => row.project_id).filter((projectId) => !listed.has(projectId)),
        );
        if (gone.length === 0) return 0;
        yield* leader.write(dropRows(gone));
        yield* changed;
        return gone.length;
      });
      if (options.reconcileEvery !== undefined) {
        const every = options.reconcileEvery;
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.andThen(
              Effect.sleep(every),
              Effect.gen(function* () {
                if ((yield* leader.status).state !== "active") return;
                yield* reconcile.pipe(
                  Effect.catch((error) => Effect.logWarning("structure reconcile failed", error)),
                );
              }),
            ),
          ),
        );
      }

      return Structure.of({
        reconcile,
        changes: SubscriptionRef.changes(version),
        createApp: (userId, rawName) =>
          Effect.gen(function* () {
            const name = rawName.trim();
            if (!fitsName(name)) return yield* refuse("invalid", "A name has 1 to 100 characters.");
            if (!canWriteStructure(yield* roles.fresh, userId)) {
              return yield* refuse("forbidden", WRITERS_ONLY);
            }
            const rows = yield* conflictOnUnique(
              leader.write(sql<{ readonly id: string; readonly name: string }>`
                INSERT INTO hq_app (name, created_by) VALUES (${name}, ${userId})
                RETURNING id::text AS id, name`),
              `An application named ${name} exists.`,
            );
            yield* changed;
            // `INSERT … RETURNING` answers the row it inserted, or fails.
            return rows[0]!;
          }),

        renameApp: (userId, appId, rawName) =>
          Effect.gen(function* () {
            const name = rawName.trim();
            if (!fitsName(name)) return yield* refuse("invalid", "A name has 1 to 100 characters.");
            if (!canWriteStructure(yield* roles.fresh, userId)) {
              return yield* refuse("forbidden", WRITERS_ONLY);
            }
            const rows = yield* conflictOnUnique(
              leader.write(sql<{ readonly id: string; readonly name: string }>`
                UPDATE hq_app SET name = ${name} WHERE id::text = ${appId}
                RETURNING id::text AS id, name`),
              `An application named ${name} exists.`,
            );
            if (rows[0] === undefined)
              return yield* refuse("app_not_found", "No such application.");
            yield* changed;
            return rows[0];
          }),

        attachProject: (userId, appId, input) =>
          Effect.gen(function* () {
            if (isMate(input.kind) !== (input.mate !== undefined)) {
              return yield* refuse(
                "invalid",
                "A Mate record goes with a Mate's kind (mate, devstage), and only with it.",
              );
            }
            if (input.mate !== undefined && !fitsName(input.mate.name)) {
              return yield* refuse("invalid", "A Mate's name has 1 to 100 characters.");
            }
            if (input.projectId === options.hqProjectId) {
              return yield* refuse("invalid", "HQ's own project belongs to no application.");
            }
            const view = yield* roles.fresh;
            const appProjects = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project WHERE app_id::text = ${appId}`;
            const may = isMate(input.kind)
              ? canAttachMate(
                  view,
                  userId,
                  input.projectId,
                  appProjects.map((row) => row.project_id),
                )
              : canWriteStructure(view, userId);
            if (!may) {
              return yield* refuse(
                "forbidden",
                isMate(input.kind) ? MATE_ATTACHERS_ONLY : WRITERS_ONLY,
              );
            }
            if (!view.projects.some((project) => project.id === input.projectId)) {
              return yield* refuse("project_not_found", "No such project in this organization.");
            }
            // What this write would conflict with — the project in any application, the
            // application's production. A row whose project Zerops no longer has (asked by its id)
            // stops counting and goes with this write; one Zerops cannot answer for refuses it.
            const holders = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project
              WHERE project_id = ${input.projectId}
                 OR (${input.kind} = 'production' AND kind = 'production' AND app_id::text = ${appId})`;
            const gone = yield* goneOf(holders.map((row) => row.project_id));
            yield* conflictOnUnique(
              leader.write(
                Effect.gen(function* () {
                  const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
                  if (apps.length === 0)
                    return yield* refuse("app_not_found", "No such application.");
                  yield* dropRows(gone);
                  yield* sql`
                    INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
                    VALUES (${input.projectId}, ${appId}::uuid, ${input.kind}, ${userId})`;
                  if (input.mate !== undefined) {
                    yield* sql`
                      INSERT INTO hq_mate (project_id, name, face)
                      VALUES (${input.projectId}, ${input.mate.name}, ${input.mate.face})
                      ON CONFLICT (project_id) DO UPDATE SET name = EXCLUDED.name, face = EXCLUDED.face`;
                  }
                }),
              ),
              "The project is in an application already, or the application has its production.",
            );
            yield* changed;
          }),

        moveProject: (userId, projectId, { appId, kind }) =>
          Effect.gen(function* () {
            if (projectId === options.hqProjectId) {
              return yield* refuse("invalid", "HQ's own project belongs to no application.");
            }
            const view = yield* roles.fresh;
            if (!view.projects.some((project) => project.id === projectId)) {
              return yield* refuse("project_not_found", "No such project in this organization.");
            }
            const [current] = yield* sql<{ readonly kind: string }>`
              SELECT kind FROM hq_app_project WHERE project_id = ${projectId}`;
            if (appId === null) {
              if (current === undefined) return { projectId, appId, kind: null };
              const may = isMate(current.kind)
                ? canEditMate(view, userId, projectId)
                : canWriteStructure(view, userId);
              if (!may) {
                return yield* refuse(
                  "forbidden",
                  isMate(current.kind) ? MATE_MOVERS_ONLY : WRITERS_ONLY,
                );
              }
              yield* leader.write(sql`DELETE FROM hq_app_project WHERE project_id = ${projectId}`);
              yield* changed;
              return { projectId, appId, kind: null };
            }
            if (isMate(kind)) {
              const mates = yield* sql`SELECT 1 FROM hq_mate WHERE project_id = ${projectId}`;
              if (mates.length === 0) {
                return yield* refuse("invalid", "A Mate is set up before it joins an application.");
              }
              const target = yield* sql<{ readonly project_id: string }>`
                SELECT project_id FROM hq_app_project WHERE app_id::text = ${appId}`;
              const may =
                canEditMate(view, userId, projectId) &&
                seesApp(
                  view,
                  userId,
                  target.map((row) => row.project_id),
                );
              if (!may) return yield* refuse("forbidden", MATE_MOVERS_ONLY);
            } else if (!canWriteStructure(view, userId)) {
              return yield* refuse("forbidden", WRITERS_ONLY);
            }
            // The application's production, if gone from Zerops, makes room as on attach.
            const holders = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project
              WHERE ${kind} = 'production' AND kind = 'production'
                AND app_id::text = ${appId} AND project_id <> ${projectId}`;
            const gone = yield* goneOf(holders.map((row) => row.project_id));
            yield* conflictOnUnique(
              leader.write(
                Effect.gen(function* () {
                  const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
                  if (apps.length === 0) {
                    return yield* refuse("app_not_found", "No such application.");
                  }
                  yield* dropRows(gone);
                  yield* sql`
                    INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
                    VALUES (${projectId}, ${appId}::uuid, ${kind}, ${userId})
                    ON CONFLICT (project_id)
                    DO UPDATE SET app_id = EXCLUDED.app_id, kind = EXCLUDED.kind`;
                }),
              ),
              "The application has its production.",
            );
            yield* changed;
            return { projectId, appId, kind };
          }),

        createMate: (userId, mate) =>
          Effect.gen(function* () {
            const name = mate.name.trim();
            if (!fitsName(name) || mate.face.length < 1 || mate.face.length > 64) {
              return yield* refuse("invalid", "A name has 1 to 100 characters, a face 1 to 64.");
            }
            if (mate.projectId === options.hqProjectId) {
              return yield* refuse("invalid", "HQ's own project is no Mate.");
            }
            const view = yield* roles.fresh;
            if (!view.projects.some((project) => project.id === mate.projectId)) {
              return yield* refuse("project_not_found", "No such project in this organization.");
            }
            if (!canEditMate(view, userId, mate.projectId)) {
              return yield* refuse("forbidden", MATE_EDITORS_ONLY);
            }
            yield* conflictOnUnique(
              leader.write(sql`
                INSERT INTO hq_mate (project_id, name, face)
                VALUES (${mate.projectId}, ${name}, ${mate.face})`),
              "The project's Mate is set up already.",
            );
            yield* changed;
            return { projectId: mate.projectId, name, face: mate.face };
          }),

        patchMate: (userId, projectId, patch) =>
          Effect.gen(function* () {
            const name = patch.name?.trim();
            if (name === undefined && patch.face === undefined) {
              return yield* refuse("invalid", "Say what changes: a name, a face, or both.");
            }
            if ((name !== undefined && !fitsName(name)) || (patch.face?.length ?? 1) > 64) {
              return yield* refuse("invalid", "A name has 1 to 100 characters, a face up to 64.");
            }
            const mates = yield* sql`SELECT 1 FROM hq_mate WHERE project_id = ${projectId}`;
            if (mates.length === 0) return yield* refuse("mate_not_found", "No such Mate.");
            if (!canEditMate(yield* roles.fresh, userId, projectId)) {
              return yield* refuse("forbidden", MATE_EDITORS_ONLY);
            }
            const rows = yield* leader.write(sql<{ readonly name: string; readonly face: string }>`
              UPDATE hq_mate
              SET name = COALESCE(${name ?? null}, name), face = COALESCE(${patch.face ?? null}, face)
              WHERE project_id = ${projectId}
              RETURNING name, face`);
            // The row was there a moment ago; a write that lost it has nothing to say.
            if (rows[0] === undefined) return yield* refuse("mate_not_found", "No such Mate.");
            yield* changed;
            return { projectId, ...rows[0] };
          }),

        read: (userId) =>
          Effect.gen(function* () {
            const view = yield* roles.view;
            const apps = yield* sql<{ readonly id: string; readonly name: string }>`
              SELECT id::text AS id, name FROM hq_app ORDER BY seq`;
            const rows = yield* sql<{
              readonly project_id: string;
              readonly app_id: string;
              readonly kind: string;
              readonly mate_name: string | null;
              readonly mate_face: string | null;
            }>`
              SELECT p.project_id, p.app_id::text AS app_id, p.kind,
                     m.name AS mate_name, m.face AS mate_face
              FROM hq_app_project p LEFT JOIN hq_mate m USING (project_id)
              ORDER BY p.seq`;
            const alone = yield* sql<{
              readonly project_id: string;
              readonly name: string;
              readonly face: string;
            }>`
              SELECT m.project_id, m.name, m.face FROM hq_mate m
              WHERE NOT EXISTS (SELECT 1 FROM hq_app_project p WHERE p.project_id = m.project_id)
              ORDER BY m.seq`;
            const names = new Map(view.projects.map((project) => [project.id, project.name]));
            const visible = rows.filter((row) => sees(view, userId, row.project_id));
            return {
              ungrouped: alone
                .filter((row) => sees(view, userId, row.project_id))
                .map((row) => ({
                  projectId: row.project_id,
                  name: names.get(row.project_id) ?? "",
                  mate: { name: row.name, face: row.face },
                })),
              apps: apps
                .map((app) => ({
                  id: app.id,
                  name: app.name,
                  projects: visible
                    .filter((row) => row.app_id === app.id)
                    .map((row) => ({
                      projectId: row.project_id,
                      name: names.get(row.project_id) ?? "",
                      kind: row.kind,
                      mate:
                        row.mate_name === null
                          ? null
                          : { name: row.mate_name, face: row.mate_face ?? "" },
                    })),
                }))
                .filter((app) =>
                  seesApp(
                    view,
                    userId,
                    app.projects.map((project) => project.projectId),
                  ),
                ),
            };
          }),
      });
    }),
  );
