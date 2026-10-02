/**
 * The structure of applications (ADR 0002): applications, the Zerops projects each holds with
 * their kind (`mate`, `stage`, `production`), and the Mate record of a `mate` project. HQ is its
 * only writer; every write is fenced by the leader and checks the writer against Zerops read fresh.
 *
 * Who may: an active org owner or admin writes, as main's `canWriteRegistry` (parity B #41, #73,
 * #77); a member who can create projects also attaches their own new Mate (`canAttachMate`). A reader sees an application while their org role is Read only or above, or while they see
 * one of its projects; a project while their effective role on it is above `NO_ACCESS` and Zerops
 * still has it.
 *
 * @module structure
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { Leader, type NotLeader } from "./leader.ts";
import { Roles, canAttachMate, canWriteStructure, sees, seesApp } from "./roles.ts";
import type { ZeropsError } from "./zerops/api.ts";

export class StructureRefused extends Schema.TaggedError<StructureRefused>()("StructureRefused", {
  code: Schema.Literals(["forbidden", "app_not_found", "project_not_found", "invalid", "conflict"]),
  message: Schema.String,
}) {}

export interface AttachInput {
  readonly projectId: string;
  readonly kind: "mate" | "stage" | "production";
  readonly mate?: { readonly name: string; readonly face: string };
}

export interface StructureRead {
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
    readonly attachProject: (
      userId: string,
      appId: string,
      input: AttachInput,
    ) => Effect.Effect<void, WriteError>;
    readonly read: (userId: string) => Effect.Effect<StructureRead, SqlError | ZeropsError>;
  }
>()("@t3tools/hq/structure") {}

const refuse = (code: StructureRefused["code"], message: string) =>
  Effect.fail(new StructureRefused({ code, message }));

const fitsName = (name: string) => name.length >= 1 && name.length <= 100;

const WRITERS_ONLY = "Only an org owner or admin changes the structure.";
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
}): Layer.Layer<Structure, never, Leader | Roles | SqlClient.SqlClient> =>
  Layer.effect(
    Structure,
    Effect.gen(function* () {
      const leader = yield* Leader;
      const roles = yield* Roles;
      const sql = yield* SqlClient.SqlClient;

      return Structure.of({
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
            // `INSERT … RETURNING` answers the row it inserted, or fails.
            return rows[0]!;
          }),

        attachProject: (userId, appId, input) =>
          Effect.gen(function* () {
            if ((input.kind === "mate") !== (input.mate !== undefined)) {
              return yield* refuse(
                "invalid",
                "A Mate record goes with kind mate, and only with it.",
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
            const may =
              input.kind === "mate"
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
                input.kind === "mate" ? MATE_ATTACHERS_ONLY : WRITERS_ONLY,
              );
            }
            if (!view.projects.some((project) => project.id === input.projectId)) {
              return yield* refuse("project_not_found", "No such project in this organization.");
            }
            yield* conflictOnUnique(
              leader.write(
                Effect.gen(function* () {
                  const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
                  if (apps.length === 0)
                    return yield* refuse("app_not_found", "No such application.");
                  yield* sql`
                    INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
                    VALUES (${input.projectId}, ${appId}::uuid, ${input.kind}, ${userId})`;
                  if (input.mate !== undefined) {
                    yield* sql`
                      INSERT INTO hq_mate (project_id, name, face)
                      VALUES (${input.projectId}, ${input.mate.name}, ${input.mate.face})`;
                  }
                }),
              ),
              "The project is in an application already, or the application has its production.",
            );
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
            const names = new Map(view.projects.map((project) => [project.id, project.name]));
            const visible = rows.filter((row) => sees(view, userId, row.project_id));
            return {
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
