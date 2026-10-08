/**
 * The events that ask for deploys (the deploy-jobs design): a merge that moved `main`, a release, an
 * environment added, a deploy key kept — and, written by `deploys.ts` itself, a person's Run again
 * or Add service. Nothing else asks, and nothing asks on a timer.
 *
 * Each is one `hq_rollout` row, written inside the event's own write ({@link addRollout}), so an
 * event that happened is never without its rollout. The request that made the event runs it
 * (`Deploys.run`) and answers with where its jobs stand; {@link Rollouts.wake} tells the leading
 * Core a rollout is there, for one no request runs — called once the event's write is done, never
 * inside it, so what it reads is there. A Core taking the lead reads the table itself, and needs no
 * wake.
 *
 * @module rollouts
 */
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import type * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import type * as SqlClient from "effect/sql/SqlClient";

/** What asked for deploys, and against what. */
export type RolloutCause =
  | {
      readonly cause: "merge";
      readonly appId: string;
      readonly repo: string;
      readonly sha: string;
    }
  | { readonly cause: "release"; readonly appId: string; readonly tag: string; readonly by: string }
  | {
      readonly cause: "env_added" | "key_kept";
      readonly projectId: string;
      readonly by: string;
    };

/**
 * The rollout of `event`, in the caller's write: an environment's names its application from its
 * row, and none where the environment is gone. A merge's is one per commit: the merge's own write
 * and the main move git reports write it once between them.
 */
export const addRollout = (sql: SqlClient.SqlClient, event: RolloutCause) => {
  switch (event.cause) {
    case "merge":
      return sql`
        INSERT INTO hq_rollout (app_id, cause, repo, sha)
        VALUES (${event.appId}::uuid, 'merge', ${event.repo}, ${event.sha})
        ON CONFLICT (app_id, repo, sha) WHERE cause = 'merge' DO NOTHING`;
    case "release":
      return sql`
        INSERT INTO hq_rollout (app_id, cause, tag, by)
        VALUES (${event.appId}::uuid, 'release', ${event.tag}, ${event.by})`;
    case "env_added":
    case "key_kept":
      return sql`
        INSERT INTO hq_rollout (app_id, cause, project_id, by)
        SELECT app_id, ${event.cause}, project_id, ${event.by}
        FROM hq_environment WHERE project_id = ${event.projectId}`;
  }
};

/**
 * The newest rollout of `event`, once its write is done: the one its request runs; none where the
 * event wrote none.
 */
export const rolloutOf = (sql: SqlClient.SqlClient, event: RolloutCause) =>
  Effect.map(
    (() => {
      switch (event.cause) {
        case "merge":
          return sql<{ readonly id: string }>`
            SELECT id::text AS id FROM hq_rollout
            WHERE app_id::text = ${event.appId} AND cause = 'merge' AND repo = ${event.repo}
              AND sha = ${event.sha}`;
        case "release":
          return sql<{ readonly id: string }>`
            SELECT id::text AS id FROM hq_rollout
            WHERE app_id::text = ${event.appId} AND cause = 'release' AND tag = ${event.tag}
            ORDER BY id DESC LIMIT 1`;
        case "env_added":
        case "key_kept":
          return sql<{ readonly id: string }>`
            SELECT id::text AS id FROM hq_rollout
            WHERE project_id = ${event.projectId} AND cause = ${event.cause} AND by = ${event.by}
            ORDER BY id DESC LIMIT 1`;
      }
    })(),
    (rows) => rows[0]?.id,
  );

export class Rollouts extends Context.Service<
  Rollouts,
  {
    /** After an event's write: the leading Core reads its rollouts. */
    readonly wake: Effect.Effect<void>;
    /** Ticks after every wake, starting with the current tick. */
    readonly woken: Stream.Stream<number>;
  }
>()("@t3tools/hq/rollouts") {}

export const rolloutsLayer = Layer.effect(
  Rollouts,
  Effect.gen(function* () {
    const ticks = yield* SubscriptionRef.make(0);
    return Rollouts.of({
      wake: SubscriptionRef.update(ticks, (n) => n + 1),
      woken: SubscriptionRef.changes(ticks),
    });
  }),
);
