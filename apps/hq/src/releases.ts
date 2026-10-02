/**
 * An application's releases to production (SPEC §3.2d), where main's client tagged and its broker
 * judged (main C). A person asks for a release of what they were offered — the recipe repository's
 * `main` head read with the offer, and each production service at a commit of its repository's
 * `main` — and Core, for whoever `can`'s `release` allows, checks it against what HQ holds now and
 * tags it: an annotated tag on the recipe repository's `main`, its message the release's lines
 * (`@t3tools/shared/hqRelease`). What HQ refuses is only an answer — no tag, no record; what it
 * tags it records approved, with its event, in the same fenced write — and in it asks production
 * again for each commit it lists whose build failed there (main C15), which no deploy pass retries
 * by itself.
 *
 * - **Checked under the recipe repository's lock**, so two releases of one application go one after
 *   another: the name is new and newer by version than every release; `main` is still the head
 *   offered; the production tier there declares each service, built from one of the application's
 *   repositories (`tierRuntimes.ts`); each commit is on that repository's `main`, its head or
 *   before.
 * - **A rollback is a new release** (main C29): named the patch over every release, listing an
 *   approved release's entries as they were — a service production no longer builds included, for
 *   its deploy to report (C16) — and the earlier release stays as it was.
 * - **Read** by whoever reads the application's changes, as main's group repository's tags were:
 *   newest first by version, at most ten.
 *
 * @module releases
 */
import type { GitError } from "@t3tools/hq-git";
import { RECIPE_REPO } from "@t3tools/shared/hqRecipe";
import {
  type CreateReleaseRequest,
  RELEASES_SHOWN,
  RELEASE_REFUSALS,
  type Release,
  ReleaseEntry,
  type RollbackRequest,
  compareReleaseTags,
  nextPatch,
  releaseMessage,
} from "@t3tools/shared/hqRelease";
import { type Decision, type Facts, REASONS, can } from "@t3tools/shared/zeropsPermissions";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { SqlError } from "effect/unstable/sql/SqlError";

import { appendEvent } from "./gitEvents.ts";
import { GitHost, mainOf } from "./gitHost.ts";
import { Leader, type NotLeader } from "./leader.ts";
import { RecipeTiers, type RecipeTierUnreadable } from "./recipeTiers.ts";
import { Roles } from "./roles.ts";
import { tierRuntimes } from "./tierRuntimes.ts";
import type { ZeropsError } from "./zerops/api.ts";

/** A person's ask HQ refused: a code, and the reason (a permission's, or the release's own). */
export class ReleaseRefused extends Schema.TaggedError<ReleaseRefused>()("ReleaseRefused", {
  code: Schema.Literals(["forbidden", "app_not_found", "release_not_found", "conflict"]),
  reason: Schema.Literals([...REASONS, ...RELEASE_REFUSALS, "app_not_found", "release_not_found"]),
}) {}

type Made = Effect.Effect<
  Release,
  ReleaseRefused | NotLeader | SqlError | GitError | ZeropsError | RecipeTierUnreadable
>;

export class Releases extends Context.Service<
  Releases,
  {
    /** The application's releases, newest first by version, at most `RELEASES_SHOWN`. */
    readonly list: (
      userId: string,
      appId: string,
    ) => Effect.Effect<ReadonlyArray<Release>, ReleaseRefused | SqlError | ZeropsError>;
    /** A release of what the person was offered, tagged and recorded, or refused. */
    readonly release: (userId: string, appId: string, request: CreateReleaseRequest) => Made;
    /** A new release of the approved release `tag`'s entries, tagged on the head offered. */
    readonly rollback: (
      userId: string,
      appId: string,
      tag: string,
      request: RollbackRequest,
    ) => Made;
    /** The application's newest approved release by version: what its production runs. */
    readonly newest: (appId: string) => Effect.Effect<Release | undefined, SqlError>;
    /** Ticks after every release made, starting with the current tick. */
    readonly changes: Stream.Stream<number>;
  }
>()("@t3tools/hq/releases") {}

interface ReleaseRow {
  readonly tag: string;
  readonly sha: string;
  readonly entries: ReadonlyArray<ReleaseEntry>;
  readonly released_by: string;
  readonly released_at: string;
  readonly state: "approved" | "refused";
  readonly reason: string | null;
  readonly rollback_of: string | null;
}

const RELEASE_COLUMNS = `tag, sha, entries, released_by,
  to_char(released_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS released_at,
  state, reason, rollback_of`;

const releaseOf = (row: ReleaseRow): Release => ({
  tag: row.tag,
  sha: row.sha,
  entries: row.entries,
  by: row.released_by,
  at: row.released_at,
  state: row.state,
  reason: row.reason,
  rollbackOf: row.rollback_of,
});

const refuse = (code: ReleaseRefused["code"], reason: ReleaseRefused["reason"]) =>
  Effect.fail(new ReleaseRefused({ code, reason }));

const person = (userId: string) => ({ kind: "person", userId }) as const;

const encodeEntries = Schema.encodeSync(Schema.fromJsonString(Schema.Array(ReleaseEntry)));

export const releasesLayer: Layer.Layer<
  Releases,
  never,
  Leader | SqlClient.SqlClient | GitHost | Roles | RecipeTiers
> = Layer.effect(
  Releases,
  Effect.gen(function* () {
    const leader = yield* Leader;
    const sql = yield* SqlClient.SqlClient;
    const gitHost = yield* GitHost;
    const roles = yield* Roles;
    const recipes = yield* RecipeTiers;
    const ticks = yield* SubscriptionRef.make(0);

    /** The person's ask, allowed by `decision`, or refused with its reason. */
    const allowed = (userId: string, appId: string, decision: Decision) =>
      decision.allow
        ? Effect.void
        : Effect.andThen(
            Effect.logInfo("release refused", { userId, appId, reason: decision.reason }),
            refuse("forbidden", decision.reason),
          );

    /**
     * The application's projects, once the person sees it — first, so an id tells nobody without it
     * whether it names an application — and HQ has it.
     */
    const seenApp = (userId: string, appId: string, facts: Facts) =>
      Effect.gen(function* () {
        const projects = yield* sql<{ readonly project_id: string; readonly kind: string }>`
          SELECT project_id, kind FROM hq_app_project WHERE app_id::text = ${appId}`;
        const projectIds = projects.map((row) => row.project_id);
        yield* allowed(userId, appId, can(person(userId), "read_app", { projectIds }, facts));
        const apps = yield* sql`SELECT 1 FROM hq_app WHERE id::text = ${appId}`;
        if (apps.length === 0) return yield* refuse("app_not_found", "app_not_found");
        return projects;
      });

    /** Whether the person may release the application, over the org read now. */
    const releaser = (userId: string, appId: string) =>
      Effect.gen(function* () {
        const facts = yield* roles.fresh;
        const projects = yield* seenApp(userId, appId, facts);
        const target = {
          projectIds: projects.map((row) => row.project_id),
          productionProjectId:
            projects.find((row) => row.kind === "production")?.project_id ?? null,
        };
        yield* allowed(userId, appId, can(person(userId), "release", target, facts));
      });

    /** The application's releases, by version, newest first. */
    const releasesOf = (appId: string) =>
      Effect.map(
        sql<ReleaseRow>`
          SELECT ${sql.literal(RELEASE_COLUMNS)} FROM hq_release WHERE app_id::text = ${appId}`,
        (rows) => rows.map(releaseOf).sort((a, b) => compareReleaseTags(b.tag, a.tag)),
      );

    /**
     * The release `tag` of `entries`, on the recipe repository's `main` at `groupHead`, checked and
     * tagged under its lock, and recorded approved: who asked, and for a rollback, what it goes back
     * to. `tag` is the person's, or none to take the patch over every release (a rollback's).
     */
    const make = (
      appId: string,
      wanted: {
        readonly tag: string | null;
        readonly groupHead: string;
        readonly entries: ReadonlyArray<ReleaseEntry>;
        readonly by: string;
        readonly rollbackOf: string | null;
      },
    ): Made =>
      Effect.gen(function* () {
        const git = yield* gitHost.git;
        const group = { appId, id: RECIPE_REPO };
        const made = yield* leader.write(
          Effect.gen(function* () {
            // The recipe repository's row, locked: its releases, and its merges, one at a time.
            const repos = yield* sql`
              SELECT 1 FROM hq_repo WHERE app_id::text = ${appId} AND name = ${RECIPE_REPO}
              FOR UPDATE`;
            if (repos.length === 0) return yield* refuse("conflict", "no_group_main");
            const tags = (yield* releasesOf(appId)).map((release) => release.tag);
            const tag = wanted.tag ?? nextPatch(tags);
            if (tags.includes(tag)) return yield* refuse("conflict", "tag_taken");
            if (tags.some((other) => compareReleaseTags(other, tag) > 0)) {
              return yield* refuse("conflict", "tag_not_newer");
            }
            const main = yield* mainOf(git, group);
            if (main === null) return yield* refuse("conflict", "no_group_main");
            if (main !== wanted.groupHead) return yield* refuse("conflict", "group_moved");
            // The production tier at that head: what each service is built from.
            const tier = yield* recipes.read(appId, "production");
            const read = tier.state === "present" ? tierRuntimes(tier.importYaml, appId) : null;
            const repoOf = new Map(
              read?.ok === true
                ? read.runtimes.map((runtime) => [runtime.hostname, runtime.repo] as const)
                : [],
            );
            // What it names before where it is: every service, then every commit. A rollback carries
            // the earlier release's entries as they were (main C16): one production no longer
            // builds, its deploy reports, and deploys the rest.
            if (
              wanted.rollbackOf === null &&
              wanted.entries.some((entry) => !repoOf.has(entry.service))
            ) {
              return yield* refuse("conflict", "unknown_service");
            }
            for (const entry of wanted.entries) {
              const repo = repoOf.get(entry.service);
              if (repo === undefined) continue;
              if (!(yield* git.onMain({ appId, id: repo }, entry.sha))) {
                return yield* refuse("conflict", "entry_not_on_main");
              }
            }
            const tagged = yield* git.createTag(
              group,
              tag,
              wanted.groupHead,
              releaseMessage(wanted.entries).trimEnd(),
            );
            // The same tag on the same commit: one this write tagged before its record failed.
            if (tagged.kind === "conflict") return yield* refuse("conflict", "tag_taken");
            const [row] = yield* sql<ReleaseRow>`
              INSERT INTO hq_release
                (app_id, tag, sha, entries, released_by, state, rollback_of)
              VALUES (${appId}::uuid, ${tag}, ${wanted.groupHead},
                ${encodeEntries(wanted.entries)}::jsonb, ${wanted.by}, 'approved',
                ${wanted.rollbackOf})
              RETURNING ${sql.literal(RELEASE_COLUMNS)}`;
            // Production is asked again for each commit it lists, even over its build's own failure,
            // which no pass retries by itself (main C15, B37): the releaser asks it.
            for (const entry of wanted.entries) {
              yield* sql`
                UPDATE hq_deploy
                SET state = 'pending', failure = NULL, message = NULL,
                    requested_by = ${wanted.by}, updated_at = now()
                WHERE project_id IN (
                    SELECT project_id FROM hq_environment
                    WHERE app_id::text = ${appId} AND tier = 'production'
                  )
                  AND service = ${entry.service} AND sha = ${entry.sha}
                  AND state = 'failed' AND failure = 'job'`;
            }
            yield* appendEvent(sql, {
              kind: "released",
              appId,
              repo: RECIPE_REPO,
              number: null,
              data: { tag, sha: wanted.groupHead, by: wanted.by, rollbackOf: wanted.rollbackOf },
            });
            return releaseOf(row!);
          }),
        );
        yield* SubscriptionRef.update(ticks, (n) => n + 1);
        return made;
      });

    return Releases.of({
      newest: (appId) =>
        Effect.map(releasesOf(appId), (all) => all.find((release) => release.state === "approved")),
      changes: SubscriptionRef.changes(ticks),
      list: (userId, appId) =>
        Effect.gen(function* () {
          const facts = yield* roles.view;
          const projects = yield* seenApp(userId, appId, facts);
          const projectIds = projects.map((row) => row.project_id);
          yield* allowed(userId, appId, can(person(userId), "read_change", { projectIds }, facts));
          return (yield* releasesOf(appId)).slice(0, RELEASES_SHOWN);
        }),
      release: (userId, appId, request) =>
        Effect.andThen(
          releaser(userId, appId),
          make(appId, {
            tag: request.tag,
            groupHead: request.groupHead,
            entries: request.entries,
            by: userId,
            rollbackOf: null,
          }),
        ),
      rollback: (userId, appId, tag, request) =>
        Effect.gen(function* () {
          yield* releaser(userId, appId);
          const [earlier] = yield* sql<ReleaseRow>`
            SELECT ${sql.literal(RELEASE_COLUMNS)} FROM hq_release
            WHERE app_id::text = ${appId} AND tag = ${tag}`;
          if (earlier === undefined) return yield* refuse("release_not_found", "release_not_found");
          if (earlier.state !== "approved")
            return yield* refuse("conflict", "release_not_approved");
          return yield* make(appId, {
            tag: null,
            groupHead: request.groupHead,
            entries: earlier.entries,
            by: userId,
            rollbackOf: tag,
          });
        }),
    });
  }),
);
