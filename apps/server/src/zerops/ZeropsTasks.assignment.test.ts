import { prepared, opened, sent, signal } from "../engine/testing/fixtures.ts";
import { describe, expect, it } from "@effect/vitest";
import type { Command } from "../engine/domain/command.ts";
import type { CommandResult } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import * as SqlClient from "effect/sql/SqlClient";
import {
  CommandId,
  ConversationId,
  TurnHandle,
  ProviderDriverKind,
  ProviderInstanceId,
  type MateTask,
  type MateTaskReport,
  type MateTaskControlReceipt,
} from "@t3tools/contracts";
import { Conversations } from "../engine/Conversations.ts";
import { EngineSignals } from "../engine/EngineSignals.ts";
import {
  DeliveryUnrecorded,
  MateEngine,
  ViewUnreadable,
  type MateEngineService,
} from "../engine/MateEngine.ts";
import { readConversationView, type ConversationView } from "../engine/read/conversationView.ts";
import { inertMateEngine } from "../engine/testing/inertEngine.ts";
import { engineLayer, tempDb } from "../engine/testing/world.ts";
import { EngineStore, EngineStoreError } from "../engine/store/EngineStore.ts";
import { ProviderInstances } from "../spi/providerInstances.ts";
import { ProviderRuntimeEventBusTest } from "../spi/ProviderRuntimeEventBus.ts";
import { AUTOMATED_MODEL_SELECTION, ZeropsAutomation } from "./ZeropsAutomation.ts";
import { ZeropsCommitAuthor } from "./ZeropsCommitAuthor.ts";
import { ZeropsWorkingCopy } from "./ZeropsWorkingCopy.ts";
import { ZeropsStandUpReceipt } from "./ZeropsStandUpReceipt.ts";
import * as TaskLedger from "./ZeropsTaskLedger.ts";
import * as Tasks from "./ZeropsTasks.ts";

const task = (assignment: string): MateTask => ({
  id: "kept-task",
  assignment,
  source: { kind: "schedule", name: "Actual schedule", title: "Keep tester work" },
  body: "Actual accepted work",
  limits: { minutes: 60, costUsd: null },
});

// The transport/provider ports are fakes. Conversation commands, records, state
// projections and receipts use the actual SQLite engine and its real actors.
const grantMate = (ledger = new Map<string, TaskLedger.TaskEntry>()) =>
  Effect.gen(function* () {
    const conversations = yield* Conversations;
    const sql = yield* SqlClient.SqlClient;
    const signals = yield* EngineSignals;
    const commands = yield* Queue.unbounded<{ command: Command; result: CommandResult }>();
    const reads: { beforeReturn?: (view: ConversationView | undefined) => Effect.Effect<void> } =
      {};
    const read = (id: ConversationId) =>
      readConversationView(id).pipe(
        Effect.provideService(Conversations, conversations),
        Effect.provideService(SqlClient.SqlClient, sql),
        Effect.mapError(() => new ViewUnreadable({ conversationId: id })),
        Effect.tap((view) => reads.beforeReturn?.(view) ?? Effect.void),
      );
    const engine: MateEngineService = {
      ...inertMateEngine,
      conversation: read,
      conversations: Effect.gen(function* () {
        const rows = yield* sql<{
          readonly conversation_id: string;
        }>`SELECT conversation_id FROM engine_conversation`;
        const views = yield* Effect.forEach(rows, (row) =>
          read(ConversationId.make(row.conversation_id)),
        );
        return { views: views.filter((view) => view !== undefined), unread: [], complete: true };
      }).pipe(Effect.orDie),
      changes: Stream.fromPubSub(signals.commits),
      assignAgent: (id, agent) =>
        conversations
          .tell({
            conversationId: id,
            commandId: CommandId.make(`agent:${id}`),
            principal: { kind: "engine" },
            command: { _tag: "AssignAgent", agent },
          })
          .pipe(
            Effect.map((result) => result._tag === "Accepted"),
            Effect.orDie,
          ),
      deliver: (id, command, commandId, principal) =>
        conversations.tell({ conversationId: id, commandId, principal, command }).pipe(
          Effect.tap((result) => Queue.offer(commands, { command, result })),
          Effect.mapError(
            () =>
              new DeliveryUnrecorded({
                conversationId: id,
                message: "synthetic database unavailable",
              }),
          ),
        ),
      runOf: (find) =>
        !("conversationId" in find)
          ? Effect.succeed(undefined)
          : conversations.state(find.conversationId).pipe(
              Effect.map((state) => {
                const run = Object.values(state.runs)
                  .filter(
                    (run) => run.principal.kind === "task" && run.principal.taskId === find.taskId,
                  )
                  .sort((a, b) => b.ordinal - a.ordinal)[0];
                return run === undefined
                  ? undefined
                  : {
                      runId: run.id,
                      ...(run.taskAssignment === undefined
                        ? {}
                        : { taskAssignment: run.taskAssignment }),
                      end: run.end,
                      source: run.endSource,
                      principal: run.principal,
                      reachedAgent: run.startedAt !== null,
                    };
              }),
              Effect.orElseSucceed(() => undefined),
            ),
    };
    const built = yield* Layer.build(
      Tasks.layer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(MateEngine, engine),
            Layer.mock(ZeropsAutomation)({
              automated: Effect.succeed(true),
              keySet: Effect.succeed(true),
              modelSelection: Effect.succeed(AUTOMATED_MODEL_SELECTION),
            }),
            Layer.mock(ProviderInstances)({
              providers: Effect.succeed([
                {
                  instanceId: ProviderInstanceId.make("opencode"),
                  driver: ProviderDriverKind.make("opencode"),
                  enabled: true,
                  installed: true,
                  version: "1",
                  status: "ready",
                  auth: { status: "authenticated" },
                  checkedAt: "2026-10-31T00:00:00Z",
                  models: [
                    {
                      slug: "nebius/zai-org/GLM-5.3",
                      name: "GLM",
                      isCustom: false,
                      capabilities: null,
                    },
                  ],
                  slashCommands: [],
                  skills: [],
                },
              ]),
            }),
            Layer.mock(ZeropsStandUpReceipt)({ settled: Effect.succeed(true) }),
            Layer.mock(ZeropsCommitAuthor)({ set: () => Effect.void }),
            Layer.mock(ZeropsWorkingCopy)({
              hold: () => Effect.succeed({ missed: [], unlisted: false }),
              undelivered: () => Effect.succeed([]),
            }),
            ProviderRuntimeEventBusTest.make(Stream.empty),
            TaskLedger.layerMemory(ledger),
          ),
        ),
      ),
    );
    const service = Context.get(built, Tasks.ZeropsTasks);
    const reports: MateTaskReport[] = [];
    const receipts: MateTaskControlReceipt[] = [];
    const reportQueue = yield* Queue.unbounded<MateTaskReport>();
    const link = yield* service.open(
      (report) =>
        Effect.sync(() => {
          reports.push(report);
        }).pipe(Effect.andThen(Queue.offer(reportQueue, report))),
      (receipt) =>
        Effect.sync(() => {
          receipts.push(receipt);
        }),
    );
    return { link, reports, receipts, engine, reportQueue, reads, commands };
  });

describe("the actual task assignment receiver", () => {
  it.effect("late same-Mate offers and stops cannot revive or stop a successor grant", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mate = yield* grantMate();
        yield* mate.link.receive(task("1"));
        expect(mate.reports.at(-1)?.assignment).toBe("1");
        yield* mate.link.stop("kept-task", "Budget reached", true, "1");
        expect(mate.receipts).toEqual([
          { taskId: "kept-task", assignment: "1", control: "requeue" },
        ]);
        const count = mate.reports.length;
        yield* mate.link.receive(task("1"));
        expect(mate.reports).toHaveLength(count);
        yield* mate.link.receive(task("2"));
        expect(mate.reports.at(-1)?.assignment).toBe("2");
        const store = yield* EngineStore;
        const before = yield* store.load(Tasks.TASKS_CONVERSATION_ID);
        yield* mate.link.receive(task("1"));
        yield* mate.link.stop("kept-task", "Late permanent old stop", false, "1");
        const after = yield* store.load(Tasks.TASKS_CONVERSATION_ID);
        expect(after.taskAssignments["kept-task"]?.assignment).toBe("2");
        expect(after.taskAssignments["kept-task"]?.state).toBe("active");
        expect(after.runs).toEqual(before.runs);
      }),
    ).pipe(Effect.provide(engineLayer(tempDb("task-grant-receiver"), new Map()))),
  );

  it.effect(
    "a fresh task service adopts an actual retained legacy run without resending its brief",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          yield* conversations.tell({
            conversationId: Tasks.TASKS_CONVERSATION_ID,
            commandId: CommandId.make("old-accepted-work"),
            principal: { kind: "task", taskId: "kept-task" },
            command: {
              _tag: "Send",
              taskId: "kept-task",
              text: "Actual tester brief already committed",
            },
          });
          const store = yield* EngineStore;
          const before = yield* store.load(Tasks.TASKS_CONVERSATION_ID);
          const mate = yield* grantMate();
          yield* mate.link.receive({ ...task("9007199254740993"), adoptOnly: true });
          const adopted = yield* store.load(Tasks.TASKS_CONVERSATION_ID);
          expect(Object.keys(adopted.runs)).toEqual(Object.keys(before.runs));
          for (const run of Object.values(before.runs))
            expect(adopted.runs[run.id]).toEqual({ ...run, taskAssignment: "9007199254740993" });
          expect(adopted.taskAssignments["kept-task"]?.assignment).toBe("9007199254740993");
          expect(mate.reports.at(-1)?.assignment).toBe("9007199254740993");
          // Lose all task-service/ledger/link memory. The new owner reads engine state.
          const restarted = yield* grantMate();
          yield* restarted.link.receive({ ...task("9007199254740993"), adoptOnly: true });
          expect((yield* store.load(Tasks.TASKS_CONVERSATION_ID)).runs).toEqual(adopted.runs);
          expect(restarted.reports.at(-1)?.assignment).toBe("9007199254740993");
        }),
      ).pipe(Effect.provide(engineLayer(tempDb("task-grant-adoption"), new Map()))),
  );
  it.effect("an adoption-only offer never starts work without an actual retained task run", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const mate = yield* grantMate();
        yield* mate.link.receive({ ...task("1"), adoptOnly: true });
        const { assignment: _assignment, ...unnumbered } = task("1");
        yield* mate.link.receive({ ...unnumbered, adoptOnly: true });
        expect(mate.reports).toEqual([]);
        expect(yield* mate.engine.conversation(Tasks.TASKS_CONVERSATION_ID)).toBeUndefined();
        expect(yield* Queue.size(mate.commands)).toBe(0);
        yield* mate.link.receive({ ...task("1"), adoptOnly: false });
        expect(mate.reports.at(-1)?.assignment).toBe("1");
        expect(yield* mate.engine.conversation(Tasks.TASKS_CONVERSATION_ID)).toBeDefined();
      }),
    ).pipe(Effect.provide(engineLayer(tempDb("task-adopt-only-absent"), new Map()))),
  );

  it.effect(
    "adoption-only refuses a canonical conversation whose actual run belongs to a person",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const conversations = yield* Conversations;
          yield* conversations.tell({
            conversationId: Tasks.taskConversationId("kept-task"),
            commandId: CommandId.make("person-work-is-not-task-proof"),
            principal: { kind: "person", subject: "zerops-user:actual-person" },
            command: { _tag: "Send", taskId: "kept-task", text: "Actual person work" },
          });
          const mate = yield* grantMate();
          yield* mate.link.receive({ ...task("1"), adoptOnly: true });
          expect(mate.reports).toEqual([]);
          expect(yield* Queue.size(mate.commands)).toBe(0);
          expect(yield* mate.engine.conversation(Tasks.TASKS_CONVERSATION_ID)).toBeUndefined();
        }),
      ).pipe(Effect.provide(engineLayer(tempDb("task-adopt-only-principal"), new Map()))),
  );

  it.effect(
    "adoption-only withholds a missing retained owner instead of creating a replacement run",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const id = Tasks.taskConversationId("kept-task");
          const conversations = yield* Conversations;
          yield* conversations.tell({
            conversationId: id,
            commandId: CommandId.make("retained-work-before-loss"),
            principal: { kind: "task", taskId: "kept-task" },
            command: { _tag: "Send", taskId: "kept-task", text: "Actual retained work" },
          });
          const mate = yield* grantMate();
          expect(yield* mate.engine.conversation(id)).toBeDefined();
          const sql = yield* SqlClient.SqlClient;
          // Remove the fixture's actual owner record; an old actor cache is no proof
          // that its durable owner still exists when restoration is requested.
          yield* sql`DELETE FROM engine_conversation WHERE conversation_id = ${id}`;
          yield* mate.link.receive({ ...task("1"), adoptOnly: true });
          expect(mate.reports).toEqual([]);
          expect(yield* Queue.size(mate.commands)).toBe(0);
          expect(yield* mate.engine.conversation(Tasks.TASKS_CONVERSATION_ID)).toBeUndefined();
        }),
      ).pipe(Effect.provide(engineLayer(tempDb("task-adopt-only-lost"), new Map()))),
  );

  it.effect(
    "a recorded stop acknowledges retirement and reports stopped only from its actual engine outcome",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const mate = yield* grantMate();
          yield* mate.link.receive(task("1"));
          yield* Effect.forkScoped(mate.link.run);
          yield* mate.link.stop("kept-task", "A real stop", false, "1");
          expect(mate.receipts).toEqual([
            { taskId: "kept-task", assignment: "1", control: "stop" },
          ]);
          let stopped: MateTaskReport;
          for (;;) {
            const report = yield* Queue.take(mate.reportQueue);
            if (report.state === "stopped") {
              stopped = report;
              break;
            }
          }
          expect(stopped.assignment).toBe("1");
          const store = yield* EngineStore;
          expect(
            Object.values((yield* store.load(Tasks.TASKS_CONVERSATION_ID)).runs).every(
              (run) => run.state === "ended",
            ),
          ).toBe(true);
        }),
      ).pipe(Effect.provide(engineLayer(tempDb("task-grant-stopped"), new Map()))),
  );

  it.effect(
    "a failed retirement commit sends no control acknowledgement and leaves the current grant active",
    () => {
      const fault = { enabled: false };
      return Effect.scoped(
        Effect.gen(function* () {
          const mate = yield* grantMate();
          yield* mate.link.receive(task("1"));
          const store = yield* EngineStore;
          const before = yield* store.load(Tasks.TASKS_CONVERSATION_ID);
          fault.enabled = true;
          yield* mate.link.stop("kept-task", "Uncommitted stop", false, "1");
          expect(mate.receipts).toEqual([]);
          expect(yield* store.load(Tasks.TASKS_CONVERSATION_ID)).toEqual(before);
        }),
      ).pipe(
        Effect.provide(
          engineLayer(tempDb("task-grant-failed-control"), new Map(), {
            fault: (stage) =>
              fault.enabled && stage === "projections"
                ? Effect.fail(
                    new EngineStoreError({
                      operation: "assignment-control-test",
                      cause: new Error("synthetic fault"),
                    }),
                  )
                : Effect.void,
          }),
        ),
      );
    },
  );

  it.effect(
    "an offer suspended on an older observation cannot act after the actual engine grant advances",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const mate = yield* grantMate();
          yield* mate.link.receive(task("1"));
          const observed = yield* Deferred.make<void>();
          const release = yield* Deferred.make<void>();
          let held = false;
          mate.reads.beforeReturn = (view) =>
            Effect.gen(function* () {
              if (held || view?.taskAssignments?.["kept-task"]?.assignment !== "1") return;
              held = true;
              yield* Deferred.succeed(observed, undefined);
              yield* Deferred.await(release);
            });
          const delayed = yield* Effect.forkScoped(mate.link.receive(task("1")));
          yield* Deferred.await(observed);
          const store = yield* EngineStore;
          const before = yield* store.load(Tasks.TASKS_CONVERSATION_ID);
          const run = Object.values(before.runs)[0]!;
          const conversations = yield* Conversations;
          const adopted = yield* conversations.tell({
            conversationId: Tasks.TASKS_CONVERSATION_ID,
            commandId: CommandId.make("actual-successor-adoption"),
            principal: { kind: "task", taskId: "kept-task", assignment: "2" },
            command: {
              _tag: "AdoptTaskAssignment",
              taskId: "kept-task",
              assignment: "2",
              runId: run.id,
            },
          });
          expect(adopted._tag).toBe("Accepted");
          const reports = mate.reports.length;
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(delayed);
          expect(mate.reports).toHaveLength(reports);
          const after = yield* store.load(Tasks.TASKS_CONVERSATION_ID);
          expect(after.runs).toEqual({ ...before.runs, [run.id]: { ...run, taskAssignment: "2" } });
          expect(after.taskAssignments["kept-task"]?.assignment).toBe("2");
        }),
      ).pipe(Effect.provide(engineLayer(tempDb("task-grant-obsolete-offer"), new Map()))),
  );
  it.effect(
    "a cost limit stops the actual adopted run despite a cached rejection of its old grant",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const ledger = new Map<string, TaskLedger.TaskEntry>();
          yield* Effect.scoped(
            Effect.gen(function* () {
              const first = yield* grantMate(ledger);
              yield* first.link.receive(task("1"));
            }),
          );
          const store = yield* EngineStore;
          const before = yield* store.load(Tasks.TASKS_CONVERSATION_ID);
          const run = Object.values(before.runs)[0]!;
          const conversations = yield* Conversations;
          yield* conversations.tell({
            conversationId: Tasks.TASKS_CONVERSATION_ID,
            commandId: CommandId.make("adopt-before-limit"),
            principal: { kind: "task", taskId: "kept-task", assignment: "2" },
            command: {
              _tag: "AdoptTaskAssignment",
              taskId: "kept-task",
              assignment: "2",
              runId: run.id,
            },
          });
          // An older implementation's stop identity had no grant. Its actual stale
          // observation is rejected and that receipt is durable; grant2 is distinct.
          const stale = yield* conversations.tell({
            conversationId: Tasks.TASKS_CONVERSATION_ID,
            commandId: CommandId.make(`task-stop:kept-task:${run.id}`),
            principal: { kind: "task", taskId: "kept-task", assignment: "1" },
            command: { _tag: "Stop", runId: run.id },
          });
          expect(stale._tag).toBe("Rejected");
          ledger.set("kept-task", {
            ...TaskLedger.emptyTaskEntry,
            ...ledger.get("kept-task"),
            limits: { minutes: 60, costUsd: 1 },
            costNano: "2000000000",
            limitHit: "cost",
          });
          const mate = yield* grantMate(ledger);
          for (;;) {
            const receipt = yield* Queue.take(mate.commands);
            if (receipt.command._tag === "Stop" && receipt.command.runId === run.id) {
              expect(receipt.result._tag).toBe("Accepted");
              break;
            }
          }
          const after = yield* store.load(Tasks.TASKS_CONVERSATION_ID);
          expect(after.runs[run.id]?.stopAsked).not.toBeNull();
          expect(after.runs[run.id]?.state).toBe("ended");
        }),
      ).pipe(Effect.provide(engineLayer(tempDb("task-grant-adopted-limit"), new Map()))),
  );
  it.effect(
    "a person's queued follow-up on a completed task remains working in its actual grant",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const mate = yield* grantMate();
          yield* mate.link.receive(task("1"));
          const conversations = yield* Conversations;
          let step = 0;
          for (const command of [
            prepared(1, Tasks.TASKS_CONVERSATION_ID),
            opened(1, Tasks.TASKS_CONVERSATION_ID),
            sent(1, Tasks.TASKS_CONVERSATION_ID),
          ]) {
            const result = yield* conversations.tell({
              conversationId: Tasks.TASKS_CONVERSATION_ID,
              commandId: CommandId.make(`controlled-provider:${step++}`),
              principal: { kind: "engine" },
              command,
            });
            expect(result._tag).toBe("Accepted");
          }
          const store = yield* EngineStore;
          const running = Object.values((yield* store.load(Tasks.TASKS_CONVERSATION_ID)).runs)[0]!;
          yield* conversations.tell({
            conversationId: Tasks.TASKS_CONVERSATION_ID,
            commandId: CommandId.make("actual-task-end"),
            principal: { kind: "engine" },
            command: signal({
              kind: "turn-ended",
              turn: TurnHandle.make(running.id),
              outcome: { kind: "completed" },
              source: "agent",
            }),
          });
          expect((yield* store.load(Tasks.TASKS_CONVERSATION_ID)).runs[running.id]?.end?.kind).toBe(
            "completed",
          );
          yield* conversations.tell({
            conversationId: Tasks.TASKS_CONVERSATION_ID,
            commandId: CommandId.make("person-follow-up"),
            principal: { kind: "person", subject: "zerops-user:U1" },
            command: { _tag: "Send", text: "Continue that same kept task" },
          });
          yield* mate.link.receive(task("1"));
          expect(mate.reports.at(-1)).toMatchObject({
            taskId: "kept-task",
            assignment: "1",
            state: "working",
          });
        }),
      ).pipe(Effect.provide(engineLayer(tempDb("task-grant-person-follow-up"), new Map()))),
  );
});
