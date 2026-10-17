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
 *
 * @module taskIntake
 */
import type { MateTaskMessage, MateTaskSource } from "@t3tools/contracts";
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
  return { ...source, title };
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
        const clean = { ...said, text: cleanTaskText(said.text) };
        for (const task of live) yield* tasks.message(task.id, clean);
        return live.length > 0;
      });

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
