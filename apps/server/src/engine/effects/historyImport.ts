/**
 * `history.import` (replay-safe, lane `side`): one batch of a conversation's earlier record. It
 * reads its source's plan (a V1 thread, or a crewmate's chain of them), the bodies of the slice starting at its cursor, and tells the
 * conversation the batch under an id derived from the effect, so a restart that runs it again
 * gets the stored receipt instead of a second copy. One batch is one step: at most
 * `HISTORY_BATCH_RECORDS` records and about `HISTORY_BATCH_BYTES` of them.
 *
 * @module engine/effects/historyImport
 */
import * as Effect from "effect/Effect";
import * as Schedule from "effect/Schedule";
import * as SqlClient from "effect/sql/SqlClient";
import { CommandId, ThreadId, type ConversationId, type HistorySource } from "@t3tools/contracts";

import type { ContentAssets } from "../../assets/ContentAssets.ts";

import { Conversations } from "../Conversations.ts";
import { planOfChain, recordsOf, type Plan, type Records, type V1Bodies } from "../history/v1.ts";
import { keepPictures } from "../history/pictures.ts";
import { readBodies, readSkeleton } from "../history/V1History.ts";
import type { EffectHandler, HandlerResult } from "../outbox/EffectWorker.ts";
import { failed, ok } from "./shared.ts";

/** The records one step copies at most. */
export const HISTORY_BATCH_RECORDS = 200;
/** About the most one step copies, as JSON: a batch over it is halved. */
export const HISTORY_BATCH_BYTES = 1024 * 1024;

interface Payload {
  readonly source: HistorySource;
  readonly runs: number;
  readonly cursor: number;
}

const ENGINE = { kind: "engine" } as const;

const sizeOf = (built: Records) =>
  JSON.stringify(built.records).length +
  built.details.reduce((sum, detail) => sum + detail.body.length, 0) +
  JSON.stringify(built.data).length;

/**
 * The plan of what a source brings: its V1 thread's turns, or its chain's oldest thread first,
 * the newest kept, and every record they hold.
 */
export const readPlan = (source: HistorySource) =>
  Effect.gen(function* () {
    const chain = source.chain ?? [{ threadId: source.threadId, reason: null, words: null }];
    const segments = [];
    for (const [index, stint] of chain.entries()) {
      segments.push({
        threadId: stint.threadId,
        boundary:
          index === 0 || stint.reason === null
            ? null
            : { stint: index + 1, reason: stint.reason, words: stint.words },
        skeleton: yield* readSkeleton(stint.threadId),
      });
    }
    return planOfChain(segments);
  });

/** Where a source's plan is held while its import runs: one per source. */
const sourceKey = (source: HistorySource): string => JSON.stringify(source);

/** Keeps each call's pictures under the V1 thread it was made in, as V1's own capture does. */
const keepSlicePictures = async (
  store: ContentAssets | null,
  plan: Plan,
  entries: Plan["entries"],
  bodies: V1Bodies,
): Promise<V1Bodies> => {
  const threadOf = new Map<string, string>();
  for (const entry of entries) {
    if (entry.kind !== "call" && entry.kind !== "work") continue;
    const threadId = plan.runs[entry.run - 1]!.threadId;
    for (const id of entry.ids) threadOf.set(id, threadId);
  }
  const activities = new Map(bodies.activities);
  for (const threadId of new Set(threadOf.values())) {
    const own = new Map([...bodies.activities].filter(([id]) => threadOf.get(id) === threadId));
    const kept = await keepPictures(store, ThreadId.make(threadId), {
      messages: new Map(),
      activities: own,
    });
    for (const [id, activity] of kept.activities) activities.set(id, activity);
  }
  return { messages: bodies.messages, activities };
};

/**
 * Starts a conversation's import: its plan's turns reserve the first ordinals. How many it
 * reserved; none when there is nothing to bring, it already brought them, or it already ran.
 */
export const askImport = (conversationId: ConversationId, source: HistorySource) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const plan = yield* readPlan(source);
    yield* conversations.ask({
      commandId: CommandId.make(`history-start:${conversationId}`),
      conversationId,
      principal: ENGINE,
      command: { _tag: "ImportHistory", source, runs: plan.runs.length },
    });
    const history = (yield* conversations.state(conversationId)).history;
    return history?.state === "importing" ? history.runs : 0;
  });

/** How an import that could not start is asked again: soon, then less often, a few times. */
export const IMPORT_RETRY = Schedule.max([Schedule.exponential("1 second"), Schedule.recurs(5)]);

/**
 * Starts a conversation's import, asking again while it fails; one that fails for good says its
 * gap in the conversation (a marker where the earlier record would be), never as if there were
 * nothing to bring. How many turns it reserved.
 */
export const importOrSayGap = (
  conversationId: ConversationId,
  source: HistorySource,
  retry: Schedule.Schedule<unknown, unknown> = IMPORT_RETRY,
) =>
  askImport(conversationId, source).pipe(
    Effect.retry(retry),
    Effect.catchCause((cause) =>
      Effect.gen(function* () {
        yield* Effect.logWarning("Mate engine: the earlier conversation could not be read", cause);
        const conversations = yield* Conversations;
        yield* conversations.ask({
          commandId: CommandId.make(`history-unread:${conversationId}`),
          conversationId,
          principal: ENGINE,
          command: {
            _tag: "ImportHistory",
            source,
            runs: 0,
            unread: "its earlier record could not be read",
          },
        });
        return 0;
      }),
    ),
  );

export interface HistoryImportOptions {
  readonly records?: number;
  readonly bytes?: number;
  /** Where the calls' pictures are kept, asked when a batch has one; none leaves them out. */
  readonly pictures?: () => ContentAssets | null;
}

export const makeHistoryImport = Effect.fn("makeHistoryImport")(function* (
  options: HistoryImportOptions = {},
) {
  const batchRecords = options.records ?? HISTORY_BATCH_RECORDS;
  const batchBytes = options.bytes ?? HISTORY_BATCH_BYTES;
  const pictures = options.pictures ?? (() => null);
  const sql = yield* SqlClient.SqlClient;
  const conversations = yield* Conversations;
  // V1 does not change under the import: a source's plan is read once, until its import ends.
  const plans = new Map<string, Plan>();
  const planFor = (source: HistorySource) => {
    const key = sourceKey(source);
    const held = plans.get(key);
    if (held !== undefined) return Effect.succeed(held);
    return readPlan(source).pipe(
      Effect.provideService(SqlClient.SqlClient, sql),
      Effect.tap((plan) => Effect.sync(() => plans.set(key, plan))),
    );
  };
  return {
    kind: "history.import",
    run: (row) =>
      Effect.gen(function* () {
        const payload = row.payload as Payload;
        const key = sourceKey(payload.source);
        const plan = yield* planFor(payload.source);
        if (plan.runs.length !== payload.runs) {
          plans.delete(key);
          return failed(
            `the V1 thread holds ${plan.runs.length} turns, the import reserved ${payload.runs}`,
          );
        }
        const from = payload.cursor;
        if (from >= plan.entries.length) {
          plans.delete(key);
          return ok({ done: true });
        }
        let to = Math.min(plan.entries.length, from + batchRecords);
        const read = yield* readBodies(plan.entries.slice(from, to)).pipe(
          Effect.provideService(SqlClient.SqlClient, sql),
        );
        const bodies = yield* Effect.promise(() =>
          keepSlicePictures(pictures(), plan, plan.entries.slice(from, to), read),
        );
        let built = recordsOf(row.conversationId, plan, from, to, bodies);
        while (to - from > 1 && sizeOf(built) > batchBytes) {
          to = from + Math.ceil((to - from) / 2);
          built = recordsOf(row.conversationId, plan, from, to, bodies);
        }
        const result = yield* conversations.tell({
          commandId: CommandId.make(`history:${row.effectId}`),
          conversationId: row.conversationId,
          principal: ENGINE,
          command: { _tag: "HistoryBatch", effectId: row.effectId, from, to, ...built },
        });
        if (result._tag === "Rejected") {
          plans.delete(key);
          return failed(
            result.rejection.detail ?? `the batch was refused (${result.rejection.reason})`,
          );
        }
        const done = to >= plan.entries.length;
        if (done) plans.delete(key);
        return ok({ done });
      }).pipe(
        // V1 unreadable now, or the step not committed: the worker tries again, with backoff.
        Effect.catch((error) =>
          Effect.succeed<HandlerResult>({ _tag: "Retry", reason: String(error) }),
        ),
      ),
  } satisfies EffectHandler;
});
