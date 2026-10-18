/**
 * HQ's one door for tasks (`taskSources.ts`), whatever their source: `TaskIntake` takes a task in
 * once its source's gate let its asker in, and carries follow-ups and stops to it; the registry of
 * channels (`TaskSourceChannels`) is where each source says how it hears back.
 *
 * - `enqueue`: the ask's text cleaned (no HTML comments, no zero-width or bidi characters), waiting
 *   as a task (`queued`) — once per delivery (`duplicate` again), and once per work item while it
 *   is live: a second ask on a key whose task is live is a message to it instead (`told`), from the
 *   source's own kind of message, none where its text is the task's already.
 * - `message`: kept by the key's live tasks, told to each one's Mate once it took it.
 * - `stop`: the key's live tasks dropped while no Mate took them, else their Mates told to stop.
 * - `answerEnded`: a reply after the key's latest task ended, answered once per end with how it
 *   ended (`hq_task.end_answered_at`), never while it is live or its change waits for review.
 *
 * @module taskIntake
 */
import type { MateTaskMessage, MateTaskSource } from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";
import * as SqlClient from "effect/sql/SqlClient";

import { Leader } from "./leader.ts";
import { MateTasks } from "./mateTasks.ts";
import {
  type TaskSourceChannel,
  TaskIntake,
  TaskIntakeUnavailable,
  TaskSourceChannels,
  type TaskEnd,
  authorOf,
  cleanTaskText,
  cleanTaskTitle,
  encodeSource,
} from "./taskSources.ts";

/** Each source kind's channel, as its layer registered it; the last registration wins. */
export const taskSourceChannelsLayer = Layer.effect(
  TaskSourceChannels,
  Effect.gen(function* () {
    const registered = yield* Ref.make(new Map<MateTaskSource["kind"], TaskSourceChannel>());
    return TaskSourceChannels.of({
      register: (channel) =>
        Ref.update(registered, (channels) => new Map(channels).set(channel.kind, channel)),
      of: (kind) => Effect.map(Ref.get(registered), (channels) => channels.get(kind)),
    });
  }),
);

/** What a second ask on a live task's key is, as a message to it. */
const askAgainFrom = (kind: MateTaskSource["kind"]): MateTaskMessage["from"] =>
  kind === "slack-thread" || kind === "discord-thread" ? "reply" : "edit";

/** A source's text fields, cleaned as its body is. */
const cleanSource = (source: MateTaskSource): MateTaskSource => {
  const title = cleanTaskTitle(source.title, "Untitled task");
  return source.kind === "schedule"
    ? { ...source, title }
    : { ...source, title, author: authorOf(source.author) };
};

export const taskIntakeLayer = Layer.effect(
  TaskIntake,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const leader = yield* Leader;
    const tasks = yield* MateTasks;

    /** The live tasks of a work item, in every application that holds one. */
    const liveOf = (sourceKey: string) =>
      sql<{ readonly id: string; readonly body: string }>`
        SELECT id::text AS id, body FROM hq_task
        WHERE source_key = ${sourceKey} AND state IN ('queued', 'assigned', 'working', 'waiting')`;

    const message = (sourceKey: string, said: MateTaskMessage) =>
      Effect.gen(function* () {
        const live = yield* liveOf(sourceKey);
        const clean = { ...said, author: authorOf(said.author), text: cleanTaskText(said.text) };
        for (const task of live) yield* tasks.message(task.id, clean);
        return live.length > 0;
      });

    /**
     * The key's latest task, where it ended and its end is unanswered: done with no change waiting
     * for review (it hears that one), failed, stopped or dropped.
     */
    const unansweredEnd = (sourceKey: string) =>
      Effect.map(
        sql<{ readonly id: string }>`
          SELECT t.id::text AS id FROM (
            SELECT * FROM hq_task WHERE source_key = ${sourceKey} ORDER BY seq DESC LIMIT 1) t
          WHERE t.state IN ('done', 'failed', 'stopped', 'dropped') AND t.ended_at IS NOT NULL
            AND t.end_answered_at IS DISTINCT FROM t.ended_at
            AND NOT (t.state = 'done' AND EXISTS (SELECT 1 FROM hq_change c
              WHERE c.app_id = t.app_id AND c.repo = t.change_repo
                AND c.number = t.change_number AND c.state = 'open'))`,
        (rows) => rows[0]?.id,
      );

    /** The end answered: how it ended, once — none where another reply answered it first. */
    const answer = (taskId: string) =>
      Effect.map(
        leader.write(sql<{ readonly state: string; readonly why: string | null }>`
          UPDATE hq_task SET end_answered_at = ended_at
          WHERE id::text = ${taskId} AND ended_at IS NOT NULL
            AND state IN ('done', 'failed', 'stopped', 'dropped')
            AND end_answered_at IS DISTINCT FROM ended_at
          RETURNING state, COALESCE(detail, stop_reason) AS why`),
        ([row]): TaskEnd | undefined =>
          row === undefined
            ? undefined
            : row.state === "done"
              ? { kind: "finished" }
              : { kind: "stopped", why: row.why },
      );

    /** HQ's own failure to tell (not the leading HQ, its database away): nothing said. */
    const untold = (what: string, sourceKey: string) =>
      Effect.catchCause((cause: Cause.Cause<unknown>) =>
        Effect.as(Effect.logWarning(what, { sourceKey, cause }), undefined),
      );

    return TaskIntake.of({
      enqueue: (input) =>
        Effect.gen(function* () {
          const source = cleanSource(input.source);
          const body = cleanTaskText(input.body);
          const [made] = yield* leader.write(sql<{ readonly id: string }>`
            INSERT INTO hq_task (app_id, repo, number, title, body, url, author, delivery_id, state,
              source_kind, source, source_key, requested_by)
            VALUES (${input.appId}::uuid,
              ${source.kind === "github-issue" ? source.repo : null},
              ${source.kind === "github-issue" ? source.number : null},
              ${source.title}, ${body},
              ${"url" in source ? source.url : null},
              ${"author" in source ? source.author : null},
              ${input.deliveryId}, 'queued', ${source.kind}, ${encodeSource(source)}::jsonb,
              ${input.sourceKey}, ${input.requestedBy})
            ON CONFLICT DO NOTHING
            RETURNING id::text AS id`);
          if (made !== undefined) {
            yield* tasks.arrived(made.id);
            const [place] = yield* sql<{ readonly position: number }>`
              SELECT count(*)::int AS position FROM hq_task
              WHERE app_id::text = ${input.appId} AND state = 'queued'
                AND seq <= (SELECT seq FROM hq_task WHERE id::text = ${made.id})`;
            return {
              kind: "queued",
              taskId: made.id,
              position: Math.max(1, place?.position ?? 1),
            } as const;
          }
          const seen = yield* sql`SELECT 1 FROM hq_task WHERE delivery_id = ${input.deliveryId}`;
          if (seen.length > 0) return { kind: "duplicate" } as const;
          const [live] = yield* sql<{ readonly id: string; readonly body: string }>`
            SELECT id::text AS id, body FROM hq_task
            WHERE app_id::text = ${input.appId} AND source_key = ${input.sourceKey}
              AND state IN ('queued', 'assigned', 'working', 'waiting')`;
          if (live === undefined) return { kind: "duplicate" } as const;
          // Asked again with nothing new: the task already holds it.
          if (body.trim() !== "" && body !== live.body)
            yield* tasks.message(live.id, {
              id: input.deliveryId,
              from: askAgainFrom(source.kind),
              author: "author" in source ? source.author : null,
              text: body,
            });
          return { kind: "told", taskId: live.id } as const;
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.andThen(
              Effect.logWarning("a task not taken in", { sourceKey: input.sourceKey, cause }),
              Effect.fail(new TaskIntakeUnavailable()),
            ),
          ),
        ),
      message: (sourceKey, said) =>
        message(sourceKey, said).pipe(
          Effect.catchCause((cause) =>
            Effect.as(Effect.logWarning("a task's message not kept", { sourceKey, cause }), false),
          ),
        ),
      answerEnded: <E, R>(sourceKey: string, allowed: Effect.Effect<boolean, E, R>) =>
        Effect.gen(function* () {
          const ended = yield* unansweredEnd(sourceKey).pipe(
            untold("a task's end not read", sourceKey),
          );
          if (ended === undefined || !(yield* allowed)) return undefined;
          return yield* answer(ended).pipe(untold("a task's end not answered", sourceKey));
        }),
      stop: (sourceKey, reason) =>
        Effect.gen(function* () {
          for (const task of yield* liveOf(sourceKey)) yield* tasks.stop(task.id, reason);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("a task not stopped", { sourceKey, cause }),
          ),
        ),
    });
  }),
);
