/**
 * The structure of applications (ADR 0002): applications, the Zerops projects each holds with
 * their kind (`mate`, `devstage`, `stage`, `production`), the Mate record of a Mate's project, and
 * the environment record of a stage's or a production's (`environments.ts`).
 * A `devstage` project is a Mate that also serves as its application's stage (main's "Dev /
 * Stage"): a Mate by its record and its rules, a stage by the one-production rule. HQ is its
 * only writer; every write is fenced by the leader and checks the writer against Zerops, as every
 * write is decided (`roles.ts` `confirmingRefusal`).
 *
 * Who may is `can` (`@t3tools/shared/zeropsPermissions`), asked with the project's kind as HQ holds
 * it now and, for a write, the org at most 30 s old, its refusal confirmed fresh. A refusal answers
 * a code and a reason code, and is
 * logged with who asked what.
 *
 * @module structure
 */
import {
  type FactsFor,
  type Reason,
  REASONS,
  type Targets,
  type Verb,
  can,
} from "@t3tools/shared/zeropsPermissions";
import type { MateChanges } from "@t3tools/shared/hqChanges";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import type { MateState } from "@t3tools/shared/mateLink";
import { type RoleProjectKind, isMateKind } from "@t3tools/shared/zeropsRoles";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Redacted from "effect/Redacted";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import {
  type EnvironmentTier,
  TIER_SOURCES,
  deriveEnvironmentName,
  environmentNameProblem,
} from "./environments.ts";
import { reachesOnly } from "./deployTokens.ts";
import { heldOf, lockProject } from "./held.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { MateOverviews } from "./mateOverviews.ts";
import { Roles, confirmingRefusal } from "./roles.ts";
import { ZeropsApi, type ZeropsError } from "./zerops/api.ts";

export class StructureRefused extends Schema.TaggedError<StructureRefused>()("StructureRefused", {
  code: Schema.Literals([
    "forbidden",
    "app_not_found",
    "project_not_found",
    "mate_not_found",
    "environment_not_found",
    "invalid",
    "conflict",
  ]),
  /** Why: a permission's reason (`zeropsPermissions.ts`) or one of the structure's own. */
  reason: Schema.Literals([
    ...REASONS,
    "name_length",
    "hq_project",
    "mate_record_with_kind",
    "mate_record_missing",
    "mate_record_exists",
    "nothing_to_change",
    "app_name_taken",
    "app_not_found",
    "app_not_empty",
    "mate_not_found",
    "placed_or_production_taken",
    "production_taken",
    "held_changed",
    "environment_with_kind",
    "environment_name_missing",
    "environment_name_long",
    "environment_name_invalid",
    "environment_name_taken",
    "environment_not_found",
    "deploy_token_refused",
    "deploy_token_scope",
  ]),
}) {}

export interface AttachInput {
  readonly projectId: string;
  readonly kind: RoleProjectKind;
  readonly mate?: { readonly name: string; readonly face: string };
  /** A stage's or a production's environment, named as given; else named from its project. */
  readonly environment?: { readonly name: string };
}

/** A deploy of a service of an environment, as its record holds it (`deploys.ts`). */
export interface DeployView {
  readonly sha: string;
  readonly state: "pending" | "deploying" | "live" | "failed";
  /** Whose failure: the build's own (`job`, final) or HQ's (`refused`, asked again); none else. */
  readonly failure: "job" | "refused" | null;
  readonly message: string | null;
  /** The platform's version and job it is read by: its log. */
  readonly appVersionId: string | null;
  readonly processId: string | null;
  /** Who last asked for it again ("Run again"); none while only HQ asked. */
  readonly requestedBy: string | null;
  /** When it last changed, ISO 8601. */
  readonly at: string;
}

/** A stage's or a production's environment as a reader of its application sees it. */
export interface EnvironmentView {
  readonly projectId: string;
  readonly tier: "stage" | "production";
  readonly name: string;
  /** The branches it follows: a stage `main`, a production `release`. */
  readonly sources: ReadonlyArray<string>;
  /** Its place among the application's environments, in the order they were declared: from 1. */
  readonly order: number;
  /** Whether HQ holds its deploy token (main E05); the token itself is never answered. */
  readonly keyHeld: boolean;
  /**
   * Whether the token held no longer answers, or reaches more than its project, as HQ's check
   * before a deploy found it (`deploys.ts`): an admin must mint a new one.
   */
  readonly keyInvalid: boolean;
  /** Per service, by its hostname: its newest deploy, and the newest that went live. */
  readonly deploys: ReadonlyArray<{
    readonly service: string;
    readonly latest: DeployView;
    readonly live: DeployView | null;
  }>;
}

/** A Mate's state as the structure holds it: its record and its birth; its changes are `changes.ts`'. */
export type MateRecordState = Omit<MateState, keyof MateChanges>;

export interface MateRecord {
  readonly projectId: string;
  readonly name: string;
  readonly face: string;
}

/**
 * A Mate as a reader sees it: its record and its birth. What it does goes beside the structure, to
 * whoever may observe it (`stream.ts`, `mateOverviews.ts`).
 */
export interface MateView {
  readonly name: string;
  readonly face: string;
  /**
   * Who made it: whoever set its record up, by their session (`createMate`, `attachProject`) —
   * the person whose sign-in it waits for. Nobody for a Mate recorded before HQ kept it.
   */
  readonly madeBy: string | null;
  /** Who asked for its stand-up (`markBirth`), or nobody yet. */
  readonly standupRequestedBy: string | null;
  /** Whether its project is closed off, so its runtimes may be imported. */
  readonly closedOff: boolean;
}

export interface StructureRead {
  /** The Mates in no application: their project's name in Zerops and their record. */
  readonly ungrouped: ReadonlyArray<{
    readonly projectId: string;
    readonly name: string;
    readonly mate: MateView;
  }>;
  readonly apps: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly projects: ReadonlyArray<{
      readonly projectId: string;
      readonly name: string;
      readonly kind: string;
      readonly mate: MateView | null;
    }>;
    /**
     * Its stage and production, in the order they were declared, with their deploys: to whoever
     * reads its changes (`read_change`), as main's commit statuses and `environments.yaml` went to
     * whoever read its repositories; none to one who only sees the application.
     */
    readonly environments: ReadonlyArray<EnvironmentView>;
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
    /**
     * An application deleted, with what HQ keeps of its recipe repository — only one that holds
     * nothing: no project, no change, no release, no repository but its recipe's (`app_not_empty`).
     * Its repositories on disk are the caller's to remove, after it.
     */
    readonly deleteApp: (userId: string, appId: string) => Effect.Effect<void, WriteError>;
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
    /**
     * Records a Mate's birth, as the client that set it up does: that the caller asks for its
     * stand-up, or that its project is closed off (its runtimes may be imported). By whoever may
     * edit the Mate's record.
     */
    readonly markBirth: (
      userId: string,
      projectId: string,
      mark: "standup" | "closed_off",
    ) => Effect.Effect<MateRecordState, WriteError>;
    /**
     * Keeps the deploy token of the application's environment `name` (SPEC §3.2b): handed over
     * by whoever may attach its project (`keep_deploy_token`), and kept only once Zerops says it
     * reaches exactly that project, as a Basic user in HQ's org (main E02) — never answered back.
     */
    readonly keepDeployToken: (
      userId: string,
      appId: string,
      name: string,
      token: Redacted.Redacted,
    ) => Effect.Effect<void, WriteError>;
    /** A Mate's record and birth, when HQ has its record. */
    readonly mateState: (
      projectId: string,
    ) => Effect.Effect<Option.Option<MateRecordState>, SqlError>;
    /** The projects whose Mate state changes, as they change. */
    readonly mateChanges: Stream.Stream<string>;
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

const refuse = (code: StructureRefused["code"], reason: StructureRefused["reason"]) =>
  Effect.fail(new StructureRefused({ code, reason }));

const fitsName = (name: string) => name.length >= 1 && name.length <= 100;

/** The environment a project of `kind` is: a stage's or a production's, else none. */
const tierOf = (kind: string): EnvironmentTier | undefined =>
  kind === "stage" || kind === "production" ? kind : undefined;

/** An environment's sources as the JSON its insert spreads into a text array. */
const encodeSources = Schema.encodeSync(Schema.fromJsonString(Schema.Array(Schema.String)));

/** An environment's row, as a takeover keeps it (main D13). */
interface EnvironmentRow {
  readonly project_id: string;
  readonly tier: string;
  readonly name: string;
  readonly sources: ReadonlyArray<string>;
  readonly declared_seq: string;
}

/** `can`'s answer, enforced: a refusal is logged with who asked what, and answered by its reason. */
const allowed = <V extends Verb>(
  userId: string,
  verb: V,
  target: Targets[V],
  facts: FactsFor<V>,
) => {
  const decision = can({ kind: "person", userId }, verb, target, facts);
  if (decision.allow) return Effect.void;
  const reason: Reason = decision.reason;
  return Effect.andThen(
    Effect.logInfo("structure refused", {
      userId,
      verb,
      target,
      reason,
      freshness: facts.freshness,
    }),
    refuse(reason === "project_gone" ? "project_not_found" : "forbidden", reason),
  );
};

const isUniqueViolation = (error: { readonly _tag: string }) =>
  error._tag === "SqlError" && (error as SqlError).reason._tag === "UniqueViolation";

/** A unique constraint the write ran into is a conflict with what is already there. */
const conflictOnUnique = <A, E extends { readonly _tag: string }, R>(
  effect: Effect.Effect<A, E, R>,
  reason: StructureRefused["reason"],
) =>
  effect.pipe(
    Effect.catchIf(
      (error: E) => isUniqueViolation(error),
      () => refuse("conflict", reason),
    ),
  );

export const structureLayer = (options: {
  readonly hqProjectId: string;
  /** How often the leader reconciles with Zerops (SPEC §4); 60 s. */
  readonly reconcileEvery?: Duration.Duration;
}): Layer.Layer<
  Structure,
  never,
  Leader | MateOverviews | Roles | SqlClient.SqlClient | ZeropsApi
> =>
  Layer.effect(
    Structure,
    Effect.gen(function* () {
      const leader = yield* Leader;
      const roles = yield* Roles;
      const overviews = yield* MateOverviews;
      const zerops = yield* ZeropsApi;
      const sql = yield* SqlClient.SqlClient;
      const version = yield* SubscriptionRef.make(0);
      const changed = SubscriptionRef.update(version, (tick) => tick + 1);
      const mateChanged = yield* PubSub.unbounded<string>();
      const stateOf = (projectId: string) =>
        Effect.map(
          sql<{
            readonly name: string;
            readonly face: string;
            readonly standup_requested_by: string | null;
            readonly closed_off: boolean;
          }>`
            SELECT name, face, standup_requested_by, closed_off_at IS NOT NULL AS closed_off
            FROM hq_mate WHERE project_id = ${projectId}`,
          (rows) =>
            Option.map(Option.fromNullishOr(rows[0]), (row): MateRecordState => ({
              projectId,
              name: row.name,
              face: row.face,
              standupRequestedBy: row.standup_requested_by,
              closedOff: row.closed_off,
            })),
        );

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

      /** The environments of `projectIds`, read before their projects' rows go. */
      const environmentRows = (projectIds: ReadonlyArray<string>) =>
        projectIds.length === 0
          ? Effect.succeed([])
          : sql<EnvironmentRow>`
              SELECT project_id, tier, name, sources, declared_seq::text AS declared_seq
              FROM hq_environment WHERE ${sql.in("project_id", projectIds)}
              ORDER BY declared_seq`;
      /**
       * In a fenced write, the application locked: the environment of a project now placed in it as
       * `tier`. It takes over `replaced` — an environment of the tier whose project Zerops no longer
       * has (main D13) — with its name, its sources and its place in the order; else it is named as
       * asked, or from its project's name in Zerops (main D10), and declared last.
       */
      const recordEnvironment = (environment: {
        readonly projectId: string;
        readonly appId: string;
        readonly tier: EnvironmentTier;
        readonly userId: string;
        readonly name: string | undefined;
        readonly projectName: string;
        readonly replaced: EnvironmentRow | undefined;
      }) =>
        Effect.gen(function* () {
          const taken = (yield* sql<{ readonly name: string }>`
            SELECT name FROM hq_environment WHERE app_id::text = ${environment.appId}`).map(
            (row) => row.name,
          );
          const name =
            environment.name ??
            environment.replaced?.name ??
            deriveEnvironmentName(environment.projectName, environment.tier, taken);
          if (name === undefined || taken.includes(name)) {
            return yield* refuse("conflict", "environment_name_taken");
          }
          const sources = encodeSources(
            environment.replaced?.sources ?? TIER_SOURCES[environment.tier],
          );
          const declared = environment.replaced?.declared_seq ?? null;
          yield* sql`
            INSERT INTO hq_environment (project_id, app_id, tier, name, sources, declared_seq,
              created_by)
            VALUES (${environment.projectId}, ${environment.appId}::uuid, ${environment.tier},
              ${name}, ARRAY(SELECT jsonb_array_elements_text(${sources}::jsonb)),
              COALESCE(${declared}::bigint, nextval(pg_get_serial_sequence('hq_environment',
                'declared_seq'))),
              ${environment.userId})`;
        });

      // Over the org as recently read, never forcing a fresh read (the lead, 2026-10-03: forcing
      // one every minute read KRLS's member and project lists for nothing).
      const reconcile = Effect.gen(function* () {
        const listed = new Set((yield* roles.recent).projects.map((project) => project.id));
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
        yield* overviews.forget(gone);
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

      /** A write's method, decided over the org as `confirmingRefusal` decides one (F22). */
      const confirmed =
        <Args extends ReadonlyArray<unknown>, A, E, R>(
          method: (...args: Args) => Effect.Effect<A, E, R>,
        ) =>
        (...args: Args) =>
          confirmingRefusal(method(...args));

      return Structure.of({
        reconcile,
        changes: SubscriptionRef.changes(version),
        mateChanges: Stream.fromPubSub(mateChanged),
        mateState: stateOf,
        keepDeployToken: confirmed((userId, appId, name, token) =>
          Effect.gen(function* () {
            const view = yield* roles.forWrite;
            // Whether the application has an environment of that name is told only to whoever sees
            // the application.
            const appProjects = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project WHERE app_id::text = ${appId}`;
            yield* allowed(
              userId,
              "read_app",
              { projectIds: appProjects.map((row) => row.project_id) },
              view,
            );
            const named = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_environment
              WHERE app_id::text = ${appId} AND name = ${name}`;
            const projectId = named[0]?.project_id;
            if (projectId === undefined) {
              return yield* refuse("environment_not_found", "environment_not_found");
            }
            yield* allowed(userId, "keep_deploy_token", { projectId }, view);
            const own = yield* zerops
              .ownToken(token)
              .pipe(
                Effect.catchTag("ZeropsRefused", () => refuse("invalid", "deploy_token_refused")),
              );
            if (!reachesOnly(own, view.orgId, projectId)) {
              return yield* refuse("invalid", "deploy_token_scope");
            }
            const kept = yield* leader.write(
              Effect.gen(function* () {
                yield* lockProject(sql, projectId);
                // The token is this statement's parameter: it must never reach statement logging
                // or a span's attributes.
                return yield* sql`
                  INSERT INTO hq_deploy_token (project_id, token, kept_by)
                  SELECT project_id, ${Redacted.value(token)}, ${userId} FROM hq_environment
                  WHERE project_id = ${projectId} AND app_id::text = ${appId} AND name = ${name}
                  ON CONFLICT (project_id)
                  DO UPDATE SET token = EXCLUDED.token, kept_by = EXCLUDED.kept_by, kept_at = now(),
                    invalid_since = NULL
                  RETURNING 1`;
              }),
            );
            if (kept.length === 0) {
              return yield* refuse("environment_not_found", "environment_not_found");
            }
            yield* changed;
          }),
        ),
        markBirth: confirmed((userId, projectId, mark) =>
          Effect.gen(function* () {
            const view = yield* roles.forWrite;
            const marked = yield* leader.write(
              Effect.gen(function* () {
                const held = yield* heldOf(sql, projectId);
                yield* allowed(userId, "edit_mate_record", { projectId, held }, view);
                return yield* mark === "standup"
                  ? sql`
                      UPDATE hq_mate SET standup_requested_by = ${userId}
                      WHERE project_id = ${projectId} RETURNING 1`
                  : sql`
                      UPDATE hq_mate SET closed_off_at = COALESCE(closed_off_at, now())
                      WHERE project_id = ${projectId} RETURNING 1`;
              }),
            );
            if (marked.length === 0) return yield* refuse("mate_not_found", "mate_not_found");
            yield* changed;
            yield* PubSub.publish(mateChanged, projectId);
            const state = yield* stateOf(projectId);
            if (Option.isNone(state)) return yield* refuse("mate_not_found", "mate_not_found");
            return state.value;
          }),
        ),
        createApp: confirmed((userId, rawName) =>
          Effect.gen(function* () {
            const name = rawName.trim();
            if (!fitsName(name)) return yield* refuse("invalid", "name_length");
            yield* allowed(userId, "create_app", null, yield* roles.forWrite);
            const rows = yield* conflictOnUnique(
              leader.write(sql<{ readonly id: string; readonly name: string }>`
                INSERT INTO hq_app (name, created_by) VALUES (${name}, ${userId})
                RETURNING id::text AS id, name`),
              "app_name_taken",
            );
            yield* changed;
            // `INSERT … RETURNING` answers the row it inserted, or fails.
            return rows[0]!;
          }),
        ),

        renameApp: confirmed((userId, appId, rawName) =>
          Effect.gen(function* () {
            const name = rawName.trim();
            if (!fitsName(name)) return yield* refuse("invalid", "name_length");
            yield* allowed(userId, "rename_app", null, yield* roles.forWrite);
            const rows = yield* conflictOnUnique(
              leader.write(sql<{ readonly id: string; readonly name: string }>`
                UPDATE hq_app SET name = ${name} WHERE id::text = ${appId}
                RETURNING id::text AS id, name`),
              "app_name_taken",
            );
            if (rows[0] === undefined) return yield* refuse("app_not_found", "app_not_found");
            yield* changed;
            // Its Mates' states name it.
            const mates = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project
              WHERE app_id::text = ${appId} AND kind IN ('mate', 'devstage')`;
            yield* PubSub.publishAll(
              mateChanged,
              mates.map((row) => row.project_id),
            );
            return rows[0];
          }),
        ),

        deleteApp: confirmed((userId, appId) =>
          Effect.gen(function* () {
            yield* allowed(userId, "delete_app", null, yield* roles.forWrite);
            yield* leader.write(
              Effect.gen(function* () {
                // Locked against an attach, which takes the row's weaker lock: whichever comes
                // second sees what the first left — a project, or no application.
                const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId} FOR UPDATE`;
                if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
                const held = yield* sql<{ readonly held: boolean }>`
                  SELECT EXISTS (SELECT 1 FROM hq_app_project WHERE app_id::text = ${appId})
                      OR EXISTS (SELECT 1 FROM hq_change WHERE app_id::text = ${appId})
                      OR EXISTS (SELECT 1 FROM hq_release WHERE app_id::text = ${appId})
                      OR EXISTS (SELECT 1 FROM hq_repo
                                 WHERE app_id::text = ${appId} AND name <> ${RECIPE_REPO})
                    AS held`;
                if (held[0]?.held !== false) return yield* refuse("conflict", "app_not_empty");
                yield* sql`DELETE FROM hq_recipe_seen WHERE app_id::text = ${appId}`;
                yield* sql`DELETE FROM hq_git_event WHERE app_id::text = ${appId}`;
                yield* sql`DELETE FROM hq_repo WHERE app_id::text = ${appId}`;
                yield* sql`DELETE FROM hq_app WHERE id::text = ${appId}`;
              }),
            );
            yield* changed;
          }),
        ),

        attachProject: confirmed((userId, appId, input) =>
          Effect.gen(function* () {
            if (isMateKind(input.kind) !== (input.mate !== undefined)) {
              return yield* refuse("invalid", "mate_record_with_kind");
            }
            if (input.mate !== undefined && !fitsName(input.mate.name)) {
              return yield* refuse("invalid", "name_length");
            }
            const tier = tierOf(input.kind);
            if (input.environment !== undefined) {
              if (tier === undefined) return yield* refuse("invalid", "environment_with_kind");
              const problem = environmentNameProblem(input.environment.name);
              if (problem !== undefined) return yield* refuse("invalid", problem);
            }
            if (input.projectId === options.hqProjectId) {
              return yield* refuse("invalid", "hq_project");
            }
            const view = yield* roles.forWrite;
            /**
             * `can`'s answer on the application's projects and the project's kind as they stand:
             * whether the application has its project of this kind already counts too — a
             * devstage is its stage, and a project Zerops no longer has holds no place.
             */
            const decided = Effect.gen(function* () {
              const appProjects = yield* sql<{
                readonly project_id: string;
                readonly kind: string;
              }>`SELECT project_id, kind FROM hq_app_project WHERE app_id::text = ${appId}`;
              const sameKind = (kind: string) =>
                kind === input.kind || (input.kind === "stage" && kind === "devstage");
              yield* allowed(
                userId,
                "attach",
                {
                  projectId: input.projectId,
                  held: yield* heldOf(sql, input.projectId),
                  to: input.kind,
                  appProjectIds: appProjects.map((row) => row.project_id),
                  slotTaken: appProjects.some(
                    (row) =>
                      sameKind(row.kind) &&
                      view.projects.some((project) => project.id === row.project_id),
                  ),
                },
                view,
              );
            });
            // Decided first on the structure as it stands, so a refusal spends nothing of Zerops;
            // then again in the write, under the application's lock.
            yield* decided;
            // What this write would conflict with or take over — the project in any application,
            // the application's environments of its tier. A row whose project Zerops no longer has
            // (asked by its id) stops counting and goes with this write, its environment taken
            // over; one Zerops cannot answer for refuses it.
            const holders = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project
              WHERE project_id = ${input.projectId}
                 OR (${tier ?? null}::text IS NOT NULL AND kind = ${input.kind}
                     AND app_id::text = ${appId})`;
            const gone = yield* goneOf(holders.map((row) => row.project_id));
            yield* conflictOnUnique(
              leader.write(
                Effect.gen(function* () {
                  // The project, then the application's row, locked: attaches of one project, or
                  // into one application, are decided one after another, each on what the one
                  // before left — two never take one place. The row lock lets a reference to the
                  // application pass.
                  yield* lockProject(sql, input.projectId);
                  const apps = yield* sql`
                    SELECT 1 FROM hq_app WHERE id::text = ${appId} FOR NO KEY UPDATE`;
                  yield* decided;
                  if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
                  const replaced = (yield* environmentRows(gone)).find((row) => row.tier === tier);
                  yield* dropRows(gone);
                  yield* sql`
                    INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
                    VALUES (${input.projectId}, ${appId}::uuid, ${input.kind}, ${userId})`;
                  if (tier !== undefined) {
                    yield* recordEnvironment({
                      projectId: input.projectId,
                      appId,
                      tier,
                      userId,
                      name: input.environment?.name,
                      projectName:
                        view.projects.find((project) => project.id === input.projectId)?.name ?? "",
                      replaced,
                    });
                  }
                  // A Mate set up already keeps its record: renaming it is its admin's
                  // (`edit_mate_record`), not an attacher's.
                  if (input.mate !== undefined) {
                    yield* sql`
                      INSERT INTO hq_mate (project_id, name, face, made_by)
                      VALUES (${input.projectId}, ${input.mate.name}, ${input.mate.face}, ${userId})
                      ON CONFLICT (project_id) DO NOTHING`;
                  }
                }),
              ),
              "placed_or_production_taken",
            );
            yield* changed;
            yield* PubSub.publish(mateChanged, input.projectId);
          }),
        ),

        moveProject: confirmed((userId, projectId, { appId, kind }) =>
          Effect.gen(function* () {
            if (projectId === options.hqProjectId) {
              return yield* refuse("invalid", "hq_project");
            }
            const view = yield* roles.forWrite;
            // The kind is read and decided on in the write that changes it, and the change lands
            // only on the row still of that kind: a writer's change in between makes a conflict.
            if (appId === null) {
              const removed = yield* leader.write(
                Effect.gen(function* () {
                  yield* lockProject(sql, projectId);
                  const held = yield* heldOf(sql, projectId);
                  yield* allowed(userId, "detach", { projectId, held }, view);
                  return yield* sql`
                    DELETE FROM hq_app_project
                    WHERE project_id = ${projectId} AND kind = ${held}
                    RETURNING 1`;
                }),
              );
              if (removed.length > 0) {
                yield* changed;
                yield* PubSub.publish(mateChanged, projectId);
              }
              return { projectId, appId, kind: null };
            }
            const target = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project WHERE app_id::text = ${appId}`;
            // The application's environments of the tier, if gone from Zerops, make room as on
            // attach, the first one's environment taken over.
            const tier = tierOf(kind);
            const holders = yield* sql<{ readonly project_id: string }>`
              SELECT project_id FROM hq_app_project
              WHERE ${tier ?? null}::text IS NOT NULL AND kind = ${kind}
                AND app_id::text = ${appId} AND project_id <> ${projectId}`;
            const gone = yield* goneOf(holders.map((row) => row.project_id));
            yield* conflictOnUnique(
              leader.write(
                Effect.gen(function* () {
                  yield* lockProject(sql, projectId);
                  const held = yield* heldOf(sql, projectId);
                  yield* allowed(
                    userId,
                    "move",
                    {
                      projectId,
                      held,
                      to: kind,
                      appProjectIds: target.map((row) => row.project_id),
                    },
                    view,
                  );
                  if (isMateKind(kind)) {
                    const mates = yield* sql`SELECT 1 FROM hq_mate WHERE project_id = ${projectId}`;
                    if (mates.length === 0) {
                      return yield* refuse("invalid", "mate_record_missing");
                    }
                  }
                  const apps = yield* sql`
                    SELECT 1 FROM hq_app WHERE id::text = ${appId} FOR NO KEY UPDATE`;
                  if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
                  // Its environment stays only where the project stays: moved anywhere else, it
                  // is recorded anew there.
                  const stays = yield* sql`
                    SELECT 1 FROM hq_app_project
                    WHERE project_id = ${projectId} AND app_id::text = ${appId} AND kind = ${kind}`;
                  if (stays.length === 0) {
                    yield* sql`DELETE FROM hq_environment WHERE project_id = ${projectId}`;
                  }
                  const replaced = (yield* environmentRows(gone)).find((row) => row.tier === tier);
                  yield* dropRows(gone);
                  const placed = yield* sql`
                    INSERT INTO hq_app_project (project_id, app_id, kind, created_by)
                    VALUES (${projectId}, ${appId}::uuid, ${kind}, ${userId})
                    ON CONFLICT (project_id)
                    DO UPDATE SET app_id = EXCLUDED.app_id, kind = EXCLUDED.kind
                    WHERE hq_app_project.kind = ${held}
                    RETURNING 1`;
                  if (placed.length === 0) return yield* refuse("conflict", "held_changed");
                  if (tier !== undefined && stays.length === 0) {
                    yield* recordEnvironment({
                      projectId,
                      appId,
                      tier,
                      userId,
                      name: undefined,
                      projectName:
                        view.projects.find((project) => project.id === projectId)?.name ?? "",
                      replaced,
                    });
                  }
                }),
              ),
              "production_taken",
            );
            yield* changed;
            yield* PubSub.publish(mateChanged, projectId);
            return { projectId, appId, kind };
          }),
        ),

        createMate: confirmed((userId, mate) =>
          Effect.gen(function* () {
            const name = mate.name.trim();
            if (!fitsName(name) || mate.face.length < 1 || mate.face.length > 64) {
              return yield* refuse("invalid", "name_length");
            }
            if (mate.projectId === options.hqProjectId) {
              return yield* refuse("invalid", "hq_project");
            }
            const view = yield* roles.forWrite;
            yield* conflictOnUnique(
              leader.write(
                Effect.gen(function* () {
                  // Held as decided until this write ends: a placement of the project waits.
                  yield* lockProject(sql, mate.projectId);
                  const held = yield* heldOf(sql, mate.projectId);
                  yield* allowed(
                    userId,
                    "create_mate_record",
                    { projectId: mate.projectId, held },
                    view,
                  );
                  yield* sql`
                    INSERT INTO hq_mate (project_id, name, face, made_by)
                    VALUES (${mate.projectId}, ${name}, ${mate.face}, ${userId})`;
                }),
              ),
              "mate_record_exists",
            );
            yield* changed;
            yield* PubSub.publish(mateChanged, mate.projectId);
            return { projectId: mate.projectId, name, face: mate.face };
          }),
        ),

        patchMate: confirmed((userId, projectId, patch) =>
          Effect.gen(function* () {
            const name = patch.name?.trim();
            if (name === undefined && patch.face === undefined) {
              return yield* refuse("invalid", "nothing_to_change");
            }
            if ((name !== undefined && !fitsName(name)) || (patch.face?.length ?? 1) > 64) {
              return yield* refuse("invalid", "name_length");
            }
            const view = yield* roles.forWrite;
            const rows = yield* leader.write(
              Effect.gen(function* () {
                const held = yield* heldOf(sql, projectId);
                yield* allowed(userId, "edit_mate_record", { projectId, held }, view);
                return yield* sql<{ readonly name: string; readonly face: string }>`
                  UPDATE hq_mate
                  SET name = COALESCE(${name ?? null}, name), face = COALESCE(${patch.face ?? null}, face)
                  WHERE project_id = ${projectId}
                  RETURNING name, face`;
              }),
            );
            if (rows[0] === undefined) return yield* refuse("mate_not_found", "mate_not_found");
            yield* changed;
            yield* PubSub.publish(mateChanged, projectId);
            return { projectId, ...rows[0] };
          }),
        ),

        read: (userId) =>
          Effect.gen(function* () {
            const view = yield* roles.view;
            const apps = yield* sql<{ readonly id: string; readonly name: string }>`
              SELECT id::text AS id, name FROM hq_app ORDER BY seq`;
            const rows = yield* sql<{
              readonly project_id: string;
              readonly app_id: string;
              readonly kind: string;
              readonly mate: MateView | null;
            }>`
              SELECT p.project_id, p.app_id::text AS app_id, p.kind,
                     CASE WHEN m.project_id IS NULL THEN NULL ELSE json_build_object(
                       'name', m.name, 'face', m.face, 'madeBy', m.made_by,
                       'standupRequestedBy', m.standup_requested_by,
                       'closedOff', m.closed_off_at IS NOT NULL) END AS mate
              FROM hq_app_project p LEFT JOIN hq_mate m USING (project_id)
              ORDER BY p.seq`;
            const alone = yield* sql<{ readonly project_id: string; readonly mate: MateView }>`
              SELECT m.project_id, json_build_object(
                       'name', m.name, 'face', m.face, 'madeBy', m.made_by,
                       'standupRequestedBy', m.standup_requested_by,
                       'closedOff', m.closed_off_at IS NOT NULL) AS mate
              FROM hq_mate m
              WHERE NOT EXISTS (SELECT 1 FROM hq_app_project p WHERE p.project_id = m.project_id)
              ORDER BY m.seq`;
            const environments = yield* sql<{
              readonly project_id: string;
              readonly app_id: string;
              readonly tier: "stage" | "production";
              readonly name: string;
              readonly sources: ReadonlyArray<string>;
              readonly order: number;
              readonly key_held: boolean;
              readonly key_invalid: boolean;
            }>`
              SELECT e.project_id, e.app_id::text AS app_id, e.tier, e.name, e.sources,
                     (rank() OVER (PARTITION BY e.app_id ORDER BY e.declared_seq))::int AS "order",
                     t.project_id IS NOT NULL AS key_held,
                     t.invalid_since IS NOT NULL AS key_invalid
              FROM hq_environment e LEFT JOIN hq_deploy_token t USING (project_id)
              ORDER BY e.declared_seq`;
            const deploys = yield* sql<{
              readonly project_id: string;
              readonly service: string;
              readonly live: boolean;
              readonly sha: string;
              readonly state: DeployView["state"];
              readonly failure: DeployView["failure"];
              readonly message: string | null;
              readonly app_version_id: string | null;
              readonly process_id: string | null;
              readonly requested_by: string | null;
              readonly at: string;
            }>`
              SELECT * FROM (
                SELECT DISTINCT ON (project_id, service) project_id, service, false AS live, sha,
                       state, failure, message, app_version_id, process_id, requested_by,
                       to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
                FROM hq_deploy ORDER BY project_id, service, created_at DESC
              ) newest
              UNION ALL
              SELECT * FROM (
                SELECT DISTINCT ON (project_id, service) project_id, service, true AS live, sha,
                       state, failure, message, app_version_id, process_id, requested_by,
                       to_char(updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
                FROM hq_deploy WHERE state = 'live' ORDER BY project_id, service, updated_at DESC
              ) live
              ORDER BY service`;
            const deployView = (row: (typeof deploys)[number]): DeployView => ({
              sha: row.sha,
              state: row.state,
              failure: row.failure,
              message: row.message,
              appVersionId: row.app_version_id,
              processId: row.process_id,
              requestedBy: row.requested_by,
              at: row.at,
            });
            const environmentView = (row: (typeof environments)[number]): EnvironmentView => {
              const of = deploys.filter((deploy) => deploy.project_id === row.project_id);
              return {
                projectId: row.project_id,
                tier: row.tier,
                name: row.name,
                sources: row.sources,
                order: row.order,
                keyHeld: row.key_held,
                keyInvalid: row.key_invalid,
                deploys: of.flatMap((deploy) => {
                  if (deploy.live) return [];
                  const live = of.find(
                    (candidate) => candidate.live && candidate.service === deploy.service,
                  );
                  return [
                    {
                      service: deploy.service,
                      latest: deployView(deploy),
                      live: live === undefined ? null : deployView(live),
                    },
                  ];
                }),
              };
            };
            const names = new Map(view.projects.map((project) => [project.id, project.name]));
            const person = { kind: "person", userId } as const;
            const reads = (projectId: string) =>
              can(person, "read_project", { projectId }, view).allow;
            const visible = rows.filter((row) => reads(row.project_id));
            return {
              ungrouped: alone
                .filter((row) => reads(row.project_id))
                .map((row) => ({
                  projectId: row.project_id,
                  name: names.get(row.project_id) ?? "",
                  mate: row.mate,
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
                      mate: row.mate,
                    })),
                  environments: can(
                    person,
                    "read_change",
                    {
                      projectIds: rows
                        .filter((row) => row.app_id === app.id)
                        .map((row) => row.project_id),
                    },
                    view,
                  ).allow
                    ? environments.filter((row) => row.app_id === app.id).map(environmentView)
                    : [],
                }))
                .filter(
                  (app) =>
                    can(
                      person,
                      "read_app",
                      { projectIds: app.projects.map((project) => project.projectId) },
                      view,
                    ).allow,
                ),
            };
          }),
      });
    }),
  );
