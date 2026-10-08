/**
 * The import end to end, over one SQLite file holding V1's projections and the engine's tables:
 * a recorded V1 thread (`testing/history/v1Thread.ts`) seeded through V1's own repositories, then
 * brought in by the `history.import` effect the way a flipped Mate's first boot does.
 */
// @effect-diagnostics nodeBuiltinImport:off - the store's objects are files beside the database.
import * as NodeCrypto from "node:crypto";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CommandId,
  ConversationId,
  MATE_ENGINE_PROTOCOLS,
  type EngineConversationFrame,
  type KnownEngineEvent,
} from "@t3tools/contracts";

import { contentAssetsAt } from "../../assets/ContentAssets.ts";
import { runMigrations } from "../../persistence/Migrations.ts";
import * as NodeSqliteClient from "../../persistence/NodeSqliteClient.ts";
import { ProjectionThreadActivityRepositoryLive } from "../../persistence/Layers/ProjectionThreadActivities.ts";
import { ProjectionThreadMessageRepositoryLive } from "../../persistence/Layers/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlanRepositoryLive } from "../../persistence/Layers/ProjectionThreadProposedPlans.ts";
import { ProjectionTurnRepositoryLive } from "../../persistence/Layers/ProjectionTurns.ts";
import { ProjectionThreadActivityRepository } from "../../persistence/Services/ProjectionThreadActivities.ts";
import { ProjectionThreadMessageRepository } from "../../persistence/Services/ProjectionThreadMessages.ts";
import { ProjectionThreadProposedPlanRepository } from "../../persistence/Services/ProjectionThreadProposedPlans.ts";
import { ProjectionTurnRepository } from "../../persistence/Services/ProjectionTurns.ts";
import { Conversations, type ConversationsShape } from "../Conversations.ts";
import { askImport, makeHistoryImport } from "../effects/historyImport.ts";
import { EffectHandlers, handlersOf, makeEffectWorker } from "../outbox/EffectWorker.ts";
import { EngineStoreError, type CommitStage } from "../store/EngineStore.ts";
import {
  LONG_NOTE,
  LONG_THOUGHT,
  SCREENSHOT,
  THREAD,
  activities,
  at,
  messages,
  pendingTurn,
  proposedPlans,
  turns,
} from "../testing/history/v1Thread.ts";
import { audit, engineLayer, newBoot, tempDb, type Engine } from "../testing/world.ts";
import { itemOfRow } from "../wire/records.ts";
import { makeEngineWire } from "../wire/EngineWire.ts";
import * as LiveBusModule from "../LiveBus.ts";

const c = ConversationId.make(THREAD);
const SCREENSHOT_DIGEST = NodeCrypto.createHash("sha256")
  .update(Buffer.from(SCREENSHOT.data, "base64"))
  .digest("hex");
const source = { kind: "v1", threadId: THREAD } as const;
const ana = { kind: "person", subject: "ana" } as const;
/** Small batches, so the thread takes several steps and a restart can fall between them. */
const BATCH = 7;

// ── the file ────────────────────────────────────────────────────────────────────────────────

/** A database holding the recorded V1 thread, as V1 wrote it. */
const seededDb = (label: string) =>
  Effect.gen(function* () {
    const file = tempDb(label);
    yield* Effect.gen(function* () {
      yield* runMigrations();
      const turnRepository = yield* ProjectionTurnRepository;
      const messageRepository = yield* ProjectionThreadMessageRepository;
      const activityRepository = yield* ProjectionThreadActivityRepository;
      const planRepository = yield* ProjectionThreadProposedPlanRepository;
      for (const turn of turns) yield* turnRepository.upsertByTurnId(turn);
      yield* turnRepository.replacePendingTurnStart(pendingTurn);
      for (const message of messages) yield* messageRepository.upsert(message);
      for (const activity of activities) yield* activityRepository.upsert(activity);
      for (const plan of proposedPlans) yield* planRepository.upsert(plan);
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          ProjectionTurnRepositoryLive,
          ProjectionThreadMessageRepositoryLive,
          ProjectionThreadActivityRepositoryLive,
          ProjectionThreadProposedPlanRepositoryLive,
        ).pipe(Layer.provideMerge(NodeSqliteClient.layer({ filename: file }))),
      ),
    );
    return file;
  });

/** V1's tables, row by row. */
const v1Tables = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const dump: Record<string, unknown> = {};
  for (const table of [
    "projection_turns",
    "projection_thread_messages",
    "projection_thread_activities",
    "projection_thread_proposed_plans",
    "projection_threads",
    "orchestration_events",
  ]) {
    dump[table] = yield* sql.unsafe(`SELECT * FROM ${table} ORDER BY rowid`);
  }
  return dump;
});

// ── a lifetime ──────────────────────────────────────────────────────────────────────────────

interface Lifetime {
  readonly fault?: (stage: CommitStage) => Effect.Effect<void, EngineStoreError>;
  /** The conversation's door as the worker sees it, to cut a lifetime at a chosen point. */
  readonly tell?: (tell: ConversationsShape["tell"]) => ConversationsShape["tell"];
}

type Worker = Effect.Success<ReturnType<typeof makeEffectWorker>>;

/** One process lifetime on the file: the engine, its worker and the import's handler. */
const lifetime = <A, E>(
  file: string,
  body: (tools: {
    readonly worker: Worker;
    readonly conversations: ConversationsShape;
  }) => Effect.Effect<A, E, Engine>,
  options: Lifetime = {},
) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const door =
      options.tell === undefined
        ? conversations
        : { ...conversations, tell: options.tell(conversations.tell) };
    const handler = yield* makeHistoryImport({
      records: BATCH,
      pictures: () => contentAssetsAt(NodePath.dirname(file)),
    }).pipe(Effect.provideService(Conversations, door));
    const worker = yield* makeEffectWorker(newBoot()).pipe(
      Effect.provideService(EffectHandlers, handlersOf(handler)),
      Effect.provideService(Conversations, door),
    );
    yield* worker.reconcileAtBoot();
    return yield* body({ worker, conversations });
  }).pipe(
    Effect.provide(
      engineLayer(file, new Map(), options.fault === undefined ? {} : { fault: options.fault }),
    ),
  );

/** Works the outbox until nothing waits in it: a retry's backoff is waited out. */
const drain = (worker: Worker) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (let round = 0; round < 400; round++) {
      if (yield* worker.runOnce) continue;
      const [waiting] = yield* sql<{ readonly n: number }>`
        SELECT COUNT(*) AS n FROM engine_effect WHERE state IN ('pending', 'running', 'settling')
      `;
      if ((waiting?.n ?? 0) === 0) return;
      yield* Effect.sleep(20);
    }
  });

const start = askImport(c, source);

// ── what the engine holds ───────────────────────────────────────────────────────────────────

const parse = (text: string): unknown => JSON.parse(text);
const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** The conversation's record as its readers get it: runs, items, requests, and their parts. */
const recordOf = (file: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const runs = yield* sql<{
      readonly run_id: string;
      readonly ordinal: number;
      readonly trigger_json: string;
      readonly principal_json: string;
      readonly state: string;
      readonly end_json: string;
      readonly end_source: string;
      readonly queued_at: number;
      readonly started_at: number | null;
      readonly ended_at: number | null;
    }>`
    SELECT run_id, ordinal, trigger_json, principal_json, state, end_json, end_source, queued_at,
      started_at, ended_at FROM engine_run WHERE conversation_id = ${c} ORDER BY ordinal
  `;
    const itemRows = yield* sql<Parameters<typeof itemOfRow>[0]>`
    SELECT * FROM engine_item WHERE conversation_id = ${c} ORDER BY opened_seq
  `;
    const items = yield* Effect.forEach(itemRows, itemOfRow);
    const requests = yield* sql<{
      readonly request_id: string;
      readonly run_id: string;
      readonly at: number;
      readonly ask_json: string;
      readonly answerable: number;
      readonly state: string;
      readonly answer_json: string | null;
    }>`
    SELECT request_id, run_id, at, ask_json, answerable, state, answer_json FROM engine_request
    WHERE conversation_id = ${c} ORDER BY seq
  `;
    const data = yield* sql<{ readonly item_id: string; readonly data_json: string }>`
    SELECT item_id, data_json FROM engine_item_data WHERE conversation_id = ${c} ORDER BY item_id
  `;
    const details = yield* sql<{ readonly item_id: string; readonly body: string }>`
    SELECT d.item_id, d.body FROM engine_item_detail d JOIN engine_item i ON i.item_id = d.item_id
    WHERE i.conversation_id = ${c} ORDER BY d.item_id
  `;
    return {
      runs: runs.map((run) => ({
        ...run,
        trigger: parse(run.trigger_json),
        end: parse(run.end_json),
      })),
      items,
      requests: requests.map((request) => ({
        ...request,
        ask: parse(request.ask_json),
        answer: request.answer_json === null ? null : parse(request.answer_json),
      })),
      data: new Map(data.map((row) => [row.item_id, parse(row.data_json)])),
      details: new Map(details.map((row) => [row.item_id, row.body])),
      /** The store's objects: each picture's bytes, once. */
      originals: NodeFS.readdirSync(NodePath.join(NodePath.dirname(file), "assets", "originals"), {
        withFileTypes: true,
      })
        .filter((entry) => entry.isFile() && !entry.name.includes("."))
        .map((entry) => entry.name)
        .toSorted(),
      /** The store's references to them: one per picture of each call, whatever restarted. */
      occurrences: NodeFS.readdirSync(
        NodePath.join(NodePath.dirname(file), "assets", "occurrences"),
      ).length,
    };
  });
type Held = Effect.Success<ReturnType<typeof recordOf>>;

/** What a comparison of two imports reads: the records without the sequence they landed at. */
const comparable = (held: Held) => ({
  runs: held.runs.map(({ run_id, trigger, end, queued_at, started_at, ended_at }) => ({
    run_id,
    trigger,
    end,
    queued_at,
    started_at,
    ended_at,
  })),
  // An occurrence's id is the store's own; its content is what two imports share. A call's
  // record holds its result's pictures as its data does.
  items: held.items.map(({ seq: _seq, rev: _rev, ...item }) => withoutOccurrenceIds(item)),
  requests: held.requests,
  data: [...held.data].map(([id, data]) => [id, withoutOccurrenceIds(data)]),
  details: [...held.details],
  originals: held.originals,
  occurrences: held.occurrences,
});

const withoutOccurrenceIds = (data: unknown): unknown =>
  JSON.parse(
    JSON.stringify(data, (key, value: unknown) =>
      key === "asset" && typeof value === "object" && value !== null
        ? { ...value, id: "occurrence" }
        : value,
    ),
  );

/** The import once, start to end, on a fresh file. */
const importedOnce = Effect.gen(function* () {
  const file = yield* seededDb("history");
  return yield* lifetime(file, ({ worker }) =>
    Effect.gen(function* () {
      const reserved = yield* start;
      yield* drain(worker);
      return { reserved, held: yield* recordOf(file), ...(yield* audit(c)) };
    }),
  );
});

const ms = (seconds: number) => Date.parse(at(seconds));
const itemOf = (held: Held, predicate: (item: Held["items"][number]) => boolean) => {
  const found = held.items.find(predicate);
  if (found === undefined) throw new Error("no such item");
  return found;
};
const callOf = (held: Held, name: string) =>
  itemOf(held, (item) => item.kind === "call" && item.tool.name === name) as Extract<
    Held["items"][number],
    { kind: "call" }
  >;
const dataOf = (held: Held, id: string) =>
  held.data.get(id) as { readonly payload: Record<string, unknown> } | undefined;

// ── the record ──────────────────────────────────────────────────────────────────────────────

describe("a flipped Mate's V1 thread, brought into its engine conversation", () => {
  const rows: ReadonlyArray<readonly [string, (held: Held) => void]> = [
    [
      "each V1 turn is a run that ended, in its order, marked imported with its V1 turn",
      (held) =>
        expect(held.runs.map((run) => [run.ordinal, run.state, run.trigger])).toEqual([
          [1, "ended", { kind: "imported", from: "v1", turn: "turn-1" }],
          [2, "ended", { kind: "imported", from: "v1", turn: "turn-2" }],
          [3, "ended", { kind: "imported", from: "v1", turn: "turn-3" }],
          [4, "ended", { kind: "imported", from: "v1", turn: "turn-4" }],
          [5, "ended", { kind: "imported", from: "v1", turn: null }],
        ]),
    ],
    [
      "a turn that completed, was stopped, failed, was running at the move or never started ends so",
      (held) =>
        expect(held.runs.map((run) => [run.end, run.end_source])).toEqual([
          [{ kind: "completed" }, "agent"],
          [{ kind: "stopped", by: { kind: "engine" } }, "stop-asked"],
          [{ kind: "failed", reason: "The agent process exited.", next: null }, "agent"],
          [
            {
              kind: "cut-by-restart",
              continuedBy: null,
              notContinued: "it ran on the previous engine",
              words: "The Mate moved to the new engine.",
            },
            "inferred-from-restart",
          ],
          [
            {
              kind: "failed",
              reason: "It was never sent: the conversation moved to the new engine first.",
              next: null,
            },
            "inferred-from-restart",
          ],
        ]),
    ],
    [
      "a run keeps the times V1 gave its turn; one V1 never closed ends at its last record",
      (held) =>
        expect(held.runs.map((run) => [run.queued_at, run.started_at, run.ended_at])).toEqual([
          [ms(0), ms(0), ms(100)],
          [ms(200), ms(200), ms(300)],
          [ms(400), ms(400), ms(500)],
          [ms(600), ms(600), ms(608)],
          [ms(700), null, ms(700)],
        ]),
    ],
    [
      "a person's message is their words under its V1 id, delivered, with its picture and its file named",
      (held) =>
        expect(itemOf(held, (item) => item.kind === "person")).toMatchObject({
          runId: `${c}/r/1`,
          at: ms(0),
          by: { kind: "person" },
          text: "[Picture 1] [File 1]\nStand up the shop from this design.",
          sendId: "msg-1",
          delivery: { state: "delivered", at: ms(0) },
          attachments: [
            {
              type: "image",
              id: "pic-1",
              name: "design.png",
              mimeType: "image/png",
              sizeBytes: 2048,
            },
            { type: "unknown", was: "file" },
          ],
        }),
    ],
    [
      "a message that never started its turn is its run's, still the person's words",
      (held) =>
        expect(
          held.items.filter((item) => item.runId === `${c}/r/5`).map((item) => item.kind),
        ).toEqual(["person"]),
    ],
    [
      "the agent's message is its note, a long one cut to its budget and whole on request",
      (held) => {
        const short = itemOf(held, (item) => item.kind === "note" && item.runId === `${c}/r/1`);
        expect(short).toMatchObject({
          text: "The shop is up on the dev service.",
          streaming: false,
        });
        const long = itemOf(held, (item) => item.kind === "note" && item.runId === `${c}/r/2`);
        expect((long as { text: string }).text).toBe(LONG_NOTE.slice(0, 16 * 1024));
        expect(held.details.get(long.id)).toBe(LONG_NOTE);
      },
    ],
    [
      "its reasoning is a thought, its preview drawn and the whole on request",
      (held) => {
        const thought = itemOf(held, (item) => item.kind === "thought");
        expect(thought).toMatchObject({
          preview: LONG_THOUGHT.slice(0, 280),
          length: LONG_THOUGHT.length,
          streaming: false,
        });
        expect(held.details.get(thought.id)).toBe(LONG_THOUGHT);
      },
    ],
    [
      "a command is a command step that ended done, V1's payload its data",
      (held) => {
        const call = itemOf(
          held,
          (item) => item.kind === "call" && item.tool.name === "Bash" && item.runId === `${c}/r/1`,
        );
        expect(call).toMatchObject({ step: "command", state: "done", endedAt: ms(4), at: ms(2) });
        expect(dataOf(held, call.id)).toMatchObject({
          source: "v1",
          kind: "tool.completed",
          payload: { detail: "Bash: ls /var/www", data: { command: "ls /var/www" } },
        });
      },
    ],
    [
      "a tool searched, a file edit that failed and a picture looked at are their steps",
      (held) => {
        expect(callOf(held, "ToolSearch")).toMatchObject({ step: "tool", state: "done" });
        expect(callOf(held, "Edit")).toMatchObject({ step: "edit", state: "failed" });
        expect(callOf(held, "Read")).toMatchObject({ step: "look", state: "done" });
        expect(dataOf(held, callOf(held, "Read").id)?.payload).toMatchObject({
          data: { imagePath: "/var/www/design.png" },
        });
      },
    ],
    [
      "a Zerops tool keeps its result, its server, how it presents itself and its picture, stored by its content",
      (held) => {
        const deploy = callOf(held, "mcp__zerops__zerops_deploy");
        expect(deploy).toMatchObject({
          step: "mcp",
          tool: { name: "mcp__zerops__zerops_deploy", server: "zerops" },
          words: "Deploy",
          state: "done",
          presentation: { title: "Deploy", source: { key: "mcp:zerops", name: "Zerops" } },
        });
        expect(dataOf(held, deploy.id)?.payload).toMatchObject({
          data: {
            zerops: {
              toolName: "zerops_deploy",
              resultText: '{"status":"DEPLOYED","service":"api"}',
              images: [
                {
                  mimeType: "image/png",
                  asset: {
                    threadId: THREAD,
                    ownerId: "a-8",
                    original: { status: "ready", digest: SCREENSHOT_DIGEST },
                  },
                },
              ],
            },
          },
        });
        expect(JSON.stringify(dataOf(held, deploy.id))).not.toContain(SCREENSHOT.data);
        expect(JSON.stringify(dataOf(held, deploy.id))).not.toContain("imagesDropped");
      },
    ],
    [
      "the same picture in two calls is one stored object, each call its own reference",
      (held) => {
        const browser = callOf(held, "mcp__zerops__zerops_browser");
        expect(dataOf(held, browser.id)?.payload).toMatchObject({
          data: {
            zerops: {
              images: [{ asset: { ownerId: "a-33", original: { digest: SCREENSHOT_DIGEST } } }],
            },
          },
        });
        expect(held.originals).toEqual([SCREENSHOT_DIGEST]);
        expect(held.occurrences).toBe(2);
      },
    ],
    [
      "a helper is a helper step and its work, and its own call is the helper's",
      (held) => {
        expect(callOf(held, "Agent")).toMatchObject({ step: "helper", state: "done" });
        expect(
          itemOf(held, (item) => item.kind === "work" && item.work === "helper-1"),
        ).toMatchObject({
          workKind: "helper",
          status: "completed",
          title: "Translate the catalogue",
        });
        expect(
          itemOf(
            held,
            (item) =>
              item.kind === "call" && item.by.kind === "helper" && item.tool.name === "Bash",
          ),
        ).toMatchObject({ by: { kind: "helper", helperId: "helper-1" }, state: "done" });
      },
    ],
    [
      "a call its stopped turn never finished reads stopped",
      (held) =>
        expect(
          itemOf(
            held,
            (item) => item.kind === "call" && item.runId === `${c}/r/2` && item.state !== "done",
          ),
        ).toMatchObject({ tool: { name: "Bash" }, state: "stopped", endedAt: null }),
    ],
    [
      "background work V1 never heard end is over, lost; work reported after its turn sits where it came",
      (held) => {
        expect(
          itemOf(held, (item) => item.kind === "work" && item.work === "shell-1"),
        ).toMatchObject({
          runId: `${c}/r/3`,
          workKind: "shell",
          status: "lost",
        });
        expect(
          itemOf(held, (item) => item.kind === "work" && item.work === "helper-late"),
        ).toMatchObject({ runId: `${c}/r/4`, status: "failed", title: "Check the footer" });
      },
    ],
    [
      "an approval allowed, a question answered, one dismissed and one left are requests in their final state, never answerable",
      (held) => {
        expect(
          held.requests.map((request) => [
            request.run_id,
            request.ask,
            request.state,
            request.answerable,
            (request.answer as { summary?: string } | null)?.summary ?? null,
          ]),
        ).toEqual([
          [
            `${c}/r/2`,
            { kind: "approval", requestKind: "command", detail: "rm -rf dist" },
            "answered",
            0,
            "Allowed",
          ],
          [
            `${c}/r/2`,
            {
              kind: "question",
              questions: [{ id: "q1", question: "Which currency?", options: [{ label: "CZK" }] }],
              dismissible: false,
            },
            "answered",
            0,
            "CZK",
          ],
          [
            `${c}/r/3`,
            { kind: "approval", requestKind: "file-change", detail: "write .env" },
            "lapsed",
            0,
            null,
          ],
          [
            `${c}/r/4`,
            {
              kind: "question",
              questions: [{ id: "q1", question: "Keep the old footer?" }],
              dismissible: false,
            },
            "dismissed",
            0,
            "Dismissed",
          ],
        ]);
        expect(
          held.items.flatMap((item) => (item.kind === "request" ? [item.requestId] : [])),
        ).toEqual(held.requests.map((request) => request.request_id));
      },
    ],
    [
      "a plan, a compaction, a warning, an error, a denial, a failed provider call, a capture's gap, a note and a proposed plan are markers",
      (held) => {
        expect(
          held.items.flatMap((item) => (item.kind === "marker" ? [[item.runId, item.marker]] : [])),
        ).toEqual([
          [`${c}/r/1`, { kind: "plan", reason: "Deploy before the frontend." }],
          [`${c}/r/3`, { kind: "warning", reason: "Rate limits are close" }],
          [`${c}/r/3`, { kind: "error", reason: "Tool denied: Bash: not allowed in plan mode" }],
          [
            `${c}/r/3`,
            { kind: "error", reason: "Provider user input response failed: the session is gone" },
          ],
          [`${c}/r/3`, { kind: "compacted" }],
          [`${c}/r/4`, { kind: "capture-gap", reason: "api: the service did not answer" }],
          [`${c}/r/4`, { kind: "error", reason: "Socket hang up." }],
          [`${c}/r/4`, { kind: "runtime.note", reason: "Model switched to opus" }],
          [`${c}/r/4`, { kind: "plan", reason: "Footer plan" }],
        ]);
        const plan = itemOf(held, (item) => item.kind === "marker" && item.runId === `${c}/r/1`);
        expect(dataOf(held, plan.id)).toMatchObject({
          payload: { plan: [{ step: "Read the recipe" }, { step: "Deploy the api" }] },
        });
      },
    ],
    [
      "what V1 shows nowhere is left: a progress tick, the meter, a capture that went well, a system line",
      (held) =>
        expect(held.items.map((item) => [item.runId?.slice(-1), item.kind])).toEqual(
          [
            ["1", "person thought call call call call call marker note"],
            ["2", "person call work call request request call note call"],
            ["3", "person marker marker marker marker work request"],
            ["4", "person marker marker marker request work marker"],
            ["5", "person"],
          ].flatMap(([run, kinds]) => kinds!.split(" ").map((kind) => [run, kind])),
        ),
    ],
  ];

  it.live.each(rows)("%s", ([_sentence, check]) =>
    Effect.map(cached, (imported) => check(imported.held)),
  );

  it.live("is copied whole: the record holds every run reserved, and the rules' audit holds", () =>
    Effect.gen(function* () {
      const imported = yield* cached;
      expect(imported.reserved).toBe(5);
      expect(imported.problems).toEqual([]);
      expect(imported.state.history).toMatchObject({ state: "complete" });
    }),
  );
});

/** The import, run once for every sentence that reads it. */
let memo: Effect.Success<typeof importedOnce> | undefined;
const cached = Effect.suspend(() =>
  memo !== undefined
    ? Effect.succeed(memo)
    : Effect.tap(importedOnce, (imported) =>
        Effect.sync(() => {
          memo = imported;
        }),
      ),
);

// ── once, whatever happens ──────────────────────────────────────────────────────────────────

describe("a client watching while the earlier record comes in", () => {
  // Catches an import streamed to a subscriber record by record: thousands of items as changes,
  // the whole thread derived again on each, where the window is what the client asked for.
  it.live("gets its window once the import is in, never the import record by record", () =>
    Effect.gen(function* () {
      const file = yield* seededDb("watched");
      const frames = yield* lifetime(file, ({ worker }) =>
        Effect.scoped(
          Effect.gen(function* () {
            const wire = yield* makeEngineWire({ coalesce: 0 });
            const frames: Array<EngineConversationFrame> = [];
            yield* Stream.runForEach(
              wire.subscribe(
                { protocol: MATE_ENGINE_PROTOCOLS[0]!, conversationId: c },
                { subject: "ana", environmentId: "env-1", epoch: 1 },
              ),
              (frame) => Effect.sync(() => frames.push(frame)),
            ).pipe(Effect.forkScoped);
            yield* Effect.sleep(50);
            yield* start;
            yield* drain(worker);
            for (let wait = 0; wait < 100 && frames.at(-1)?.type !== "synchronized"; wait++)
              yield* Effect.sleep(20);
            yield* Effect.sleep(100);
            return frames;
          }),
        ).pipe(Effect.provide(LiveBusModule.layer)),
      );
      const imported = frames.flatMap((frame) =>
        frame.type === "changes" ? frame.runs.filter((run) => run.trigger.kind === "imported") : [],
      );
      expect(imported).toEqual([]);
      const reset = frames.findIndex((frame) => frame.type === "reset");
      expect(reset).toBeGreaterThan(0);
      expect(frames.slice(reset).map((frame) => frame.type)).toEqual([
        "reset",
        "snapshot",
        "synchronized",
      ]);
      const window = frames[reset + 1];
      expect(window?.type === "snapshot" && window.runs.length).toBeGreaterThan(0);
    }),
  );
});

describe("the import, once", () => {
  it.live("leaves V1's tables as they were, so flipping back finds the conversation", () =>
    Effect.gen(function* () {
      const file = yield* seededDb("v1-unchanged");
      const before = yield* v1Tables.pipe(
        Effect.provide(NodeSqliteClient.layer({ filename: file })),
      );
      yield* lifetime(file, ({ worker }) => Effect.andThen(start, drain(worker)));
      const after = yield* v1Tables.pipe(
        Effect.provide(NodeSqliteClient.layer({ filename: file })),
      );
      expect(after).toEqual(before);
    }),
  );

  it.live("asked twice, in two lifetimes, copies the record once", () =>
    Effect.gen(function* () {
      const file = yield* seededDb("twice");
      const first = yield* lifetime(file, ({ worker }) =>
        Effect.gen(function* () {
          yield* start;
          yield* drain(worker);
          return yield* recordOf(file);
        }),
      );
      const second = yield* lifetime(file, ({ worker }) =>
        Effect.gen(function* () {
          expect(yield* start).toBe(0);
          yield* drain(worker);
          return { held: yield* recordOf(file), ...(yield* audit(c)) };
        }),
      );
      expect(second.held).toEqual(first);
      expect(second.problems).toEqual([]);
    }),
  );

  it.live(
    "cut by a restart between two batches, resumes where it stood and copies nothing twice",
    () =>
      Effect.gen(function* () {
        const reference = yield* cached;
        const file = yield* seededDb("restart");
        yield* lifetime(file, ({ worker }) =>
          Effect.gen(function* () {
            yield* start;
            yield* worker.runOnce;
            yield* worker.runOnce;
          }),
        );
        const middle = yield* lifetime(file, () => recordOf(file));
        expect(middle.items.length).toBeGreaterThan(0);
        expect(middle.items.length).toBeLessThan(reference.held.items.length);
        const after = yield* lifetime(file, ({ worker }) =>
          Effect.gen(function* () {
            yield* drain(worker);
            return { held: yield* recordOf(file), ...(yield* audit(c)) };
          }),
        );
        expect(comparable(after.held)).toEqual(comparable(reference.held));
        expect(after.problems).toEqual([]);
        expect(after.state.history).toMatchObject({ state: "complete" });
      }),
  );

  it.live("holds a message sent meanwhile until the earlier record is in, then runs it after", () =>
    Effect.gen(function* () {
      const file = yield* seededDb("meanwhile");
      const { events } = yield* lifetime(file, ({ worker, conversations }) =>
        Effect.gen(function* () {
          yield* start;
          yield* worker.runOnce;
          yield* conversations.ask({
            commandId: CommandId.make("send-1"),
            conversationId: c,
            principal: ana,
            command: { _tag: "Send", text: "hello again" },
          });
          yield* drain(worker);
          return yield* audit(c);
        }),
      );
      const seqOf = (tag: KnownEngineEvent["_tag"]) =>
        events.find((event) => event._tag === tag)?.seq ?? Number.NaN;
      expect(events.find((event) => event._tag === "RunQueued")).toMatchObject({
        runId: `${c}/r/6`,
        ordinal: 6,
      });
      expect(seqOf("HistoryImportEnded")).toBeLessThan(seqOf("RunAdmitted"));
    }),
  );
});

// ── the crash table ─────────────────────────────────────────────────────────────────────────

type Crash =
  | { readonly at: number; readonly how: "after" | "mid-effect" | "outcome-unrecorded" }
  | { readonly at: number; readonly how: "mid-commit"; readonly stage: CommitStage };

const STAGES: ReadonlyArray<CommitStage> = [
  "receipt",
  "events",
  "projections",
  "outbox",
  "settle",
  "snapshot",
];

/** The import's moves: the start, then the worker batch by batch. */
const MOVES = 1 + 7;

const crashes: ReadonlyArray<Crash> = Array.from({ length: MOVES }, (_, at) => at).flatMap(
  (at): ReadonlyArray<Crash> => [
    { at, how: "after" },
    ...(at > 0
      ? [{ at, how: "mid-effect" } as const, { at, how: "outcome-unrecorded" } as const]
      : []),
    ...STAGES.map((stage) => ({ at, how: "mid-commit", stage }) as const),
  ],
);

describe("the import's crash table", () => {
  it.live("a restart at any of its step boundaries copies the record once, whole", () =>
    Effect.gen(function* () {
      const reference = comparable((yield* cached).held);
      const broken: Array<string> = [];
      for (const crash of crashes) {
        const file = yield* seededDb("history-crash");
        let armed = false;
        let commits = 0;
        let acted = false;
        const label = `${crash.at} ${crash.at === 0 ? "ImportHistory" : "worker"} — ${crash.how}${crash.how === "mid-commit" ? `@${crash.stage}` : ""}`;
        yield* lifetime(
          file,
          ({ worker }) =>
            Effect.gen(function* () {
              for (let move = 0; move <= crash.at; move++) {
                armed = move === crash.at;
                if (armed && crash.how === "mid-effect") {
                  // The handler's batch goes in, then the process dies before it returns.
                  yield* Effect.forkDetach(worker.runOnce);
                  for (let spin = 0; spin < 200; spin++) {
                    if (acted) break;
                    yield* Effect.sleep(5);
                  }
                  return;
                }
                if (move === 0) yield* Effect.exit(start);
                else yield* Effect.exit(worker.runOnce);
              }
            }),
          {
            fault: (stage) =>
              armed && crash.how === "mid-commit" && stage === crash.stage && commits++ === 0
                ? Effect.fail(
                    new EngineStoreError({ operation: "commit", cause: new Error("process died") }),
                  )
                : Effect.void,
            tell: (tell) => (envelope) => {
              if (!armed) return tell(envelope);
              // The batch went in, then the process died before the handler returned.
              if (crash.how === "mid-effect" && envelope.command._tag === "HistoryBatch")
                return Effect.andThen(
                  tell(envelope),
                  Effect.suspend(() => {
                    acted = true;
                    return Effect.never;
                  }),
                );
              if (crash.how === "outcome-unrecorded" && envelope.command._tag === "EffectSettled")
                return Effect.die("process died before the outcome was recorded");
              return tell(envelope);
            },
          },
        );
        const after = yield* lifetime(file, ({ worker, conversations }) =>
          Effect.gen(function* () {
            yield* drain(worker);
            // Whatever the crash cut, a start asked again goes on where the import stands.
            yield* start;
            yield* drain(worker);
            const held = yield* recordOf(file);
            yield* conversations.ask({
              commandId: CommandId.make("after-restart"),
              conversationId: c,
              principal: ana,
              command: { _tag: "Send", text: "after the restart" },
            });
            return { held, ...(yield* audit(c)) };
          }),
        );
        const problems = [...after.problems];
        if (after.state.history?.state !== "complete")
          problems.push(`the import ends complete: ${after.state.history?.state}`);
        if (!same(comparable(after.held), reference))
          problems.push("the record is the import's, once and whole");
        if (after.state.activeRunId !== `${c}/r/6`)
          problems.push(`the person's message runs after it: active ${after.state.activeRunId}`);
        if (problems.length > 0) broken.push(`${label}\n    ${problems.join("\n    ")}`);
      }
      expect(broken).toEqual([]);
    }),
  );
});
