import { describe, expect, it } from "@effect/vitest";
import * as Clock from "effect/Clock";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import type { ItemLifecyclePayload, SpiEvent, ThreadId } from "@t3tools/contracts";

import { PersistenceSqlError } from "../persistence/Errors.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ZeropsThreadLifecycle from "../persistence/ZeropsThreadLifecycle.ts";
import { ProviderRuntimeEventBusTest } from "../spi/ProviderRuntimeEventBus.ts";
import { applyToolCall } from "../spi/toolCall.ts";
import { ZEROPS_ENVELOPE_FENCE } from "./zeropsEnvelope.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";

const THREAD = "thread-1" as ThreadId;
const OTHER_THREAD = "thread-2" as ThreadId;

const envelopeJsonText = (phase: string) =>
  JSON.stringify({
    phase,
    environment: "container",
    project: { id: "proj-1", name: "z3-eval" },
    services: [
      {
        hostname: "kanbandev",
        typeVersion: "nodejs@22",
        runtimeClass: "dynamic",
        status: "ACTIVE",
        bootstrapped: true,
      },
    ],
    generated: "2026-08-28T12:00:00Z",
  });

const envelopeBlock = (phase: string) =>
  `## Status\n\nPhase: ${phase}\n\n\`\`\`${ZEROPS_ENVELOPE_FENCE}\n${envelopeJsonText(phase)}\n\`\`\`\n`;

let eventCounter = 0;

/**
 * An enriched (`.toolCall` already attached, via `applyToolCall` — the same
 * enrichment the real bus applies) Claude `item.completed`/`item.started`
 * for one `zerops_*` tool.
 */
const claudeEvent = (options: {
  readonly threadId?: ThreadId;
  readonly toolName?: string;
  readonly text?: string;
  readonly type?: "item.started" | "item.completed";
  readonly itemId?: string;
}): SpiEvent =>
  applyToolCall({
    eventId: `evt-${(eventCounter += 1)}`,
    provider: "claudeAgent",
    threadId: options.threadId ?? THREAD,
    createdAt: "2026-08-28T12:00:00Z",
    type: options.type ?? "item.completed",
    itemId: options.itemId ?? `toolu_${options.toolName ?? "workflow"}`,
    payload: {
      itemType: "mcp_tool_call",
      status: options.type === "item.started" ? "inProgress" : "completed",
      title: "zerops",
      data: {
        toolName: options.toolName ?? "mcp__zerops__zerops_workflow",
        input: { action: "status" },
        ...(options.type === "item.started"
          ? {}
          : {
              result: {
                type: "tool_result",
                tool_use_id: options.itemId ?? "toolu_01",
                content: [{ type: "text", text: options.text ?? envelopeBlock("develop-active") }],
              },
            }),
      },
    } satisfies ItemLifecyclePayload,
  } as SpiEvent);

const persistence = ZeropsThreadLifecycle.layer.pipe(Layer.provideMerge(SqlitePersistenceMemory));

/**
 * Events are fed through `ingest` — the reducer's own entry point, which the
 * background subscription is a thin adapter over. That makes every assertion
 * below a receipt: the call returns when the event has been folded in, with no
 * clock involved. One test drives the subscription instead, to prove the wiring.
 */
const withLifecycle = <A, E>(
  use: (lifecycle: ZeropsLifecycle.ZeropsLifecycle["Service"]) => Effect.Effect<A, E, never>,
) =>
  Effect.scoped(
    Effect.gen(function* () {
      const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
      const lifecycle = yield* ZeropsLifecycle.make({
        toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
        repository,
      });
      return yield* use(lifecycle);
    }),
  ).pipe(Effect.provide(persistence));

describe("ZeropsLifecycle", () => {
  it.effect("has nothing for a thread that has run no Zerops tools", () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        const state = yield* lifecycle.get(THREAD);
        expect(state.threadId).toBe(THREAD);
        expect(state.envelope).toBeUndefined();
        expect(state.recentTools).toEqual([]);
      }),
    ),
  );

  it.effect("records the envelope a workflow result carries", () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(claudeEvent({}));
        const state = yield* lifecycle.get(THREAD);
        expect(state.envelope?.phase).toBe("develop-active");
        expect(state.envelope?.services[0]?.hostname).toBe("kanbandev");
        expect(state.recentTools.at(-1)?.toolName).toBe("zerops_workflow");
      }),
    ),
  );

  it.effect("keeps the latest envelope when a later one arrives", () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(claudeEvent({ text: envelopeBlock("bootstrap-active") }));
        yield* lifecycle.ingest(claudeEvent({ text: envelopeBlock("develop-active") }));
        expect((yield* lifecycle.get(THREAD)).envelope?.phase).toBe("develop-active");
      }),
    ),
  );

  it.effect("records a tool that carries no envelope without disturbing the state", () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(claudeEvent({}));
        // Only three tools carry an envelope; zerops_deploy returns JSON. The
        // strip still has to be able to say "deploying", which is what
        // recentTools is for.
        yield* lifecycle.ingest(
          claudeEvent({
            toolName: "mcp__zerops__zerops_deploy",
            text: '{"service":"kanbandev","status":"ok"}',
          }),
        );
        const state = yield* lifecycle.get(THREAD);
        expect(state.envelope?.phase).toBe("develop-active");
        expect(state.recentTools.map((tool) => tool.toolName)).toEqual([
          "zerops_workflow",
          "zerops_deploy",
        ]);
      }),
    ),
  );

  it.effect("takes the envelope a JSON-document result carries", () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        // zerops_deploy returns one JSON document, so it carries the envelope
        // under a top-level key rather than in a fence.
        yield* lifecycle.ingest(
          claudeEvent({
            toolName: "mcp__zerops__zerops_deploy",
            text: `{"service":"kanbandev","status":"ok","envelope":${envelopeJsonText(
              "develop-active",
            )}}`,
          }),
        );
        const state = yield* lifecycle.get(THREAD);
        expect(state.envelope?.phase).toBe("develop-active");
        expect(state.recentTools.at(-1)?.toolName).toBe("zerops_deploy");
      }),
    ),
  );

  it.effect("keeps the previous envelope when a block is corrupted", () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(claudeEvent({}));
        yield* lifecycle.ingest(
          claudeEvent({ text: `text\n\n\`\`\`${ZEROPS_ENVELOPE_FENCE}\nnot json\n\`\`\`\n` }),
        );
        // Adopting nothing is right; adopting an older envelope would move the
        // strip backwards.
        expect((yield* lifecycle.get(THREAD)).envelope?.phase).toBe("develop-active");
      }),
    ),
  );

  it.effect("ignores tools that are not Zerops tools", () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(claudeEvent({ toolName: "mcp__t3-code__browser_open" }));
        const state = yield* lifecycle.get(THREAD);
        expect(state.recentTools).toEqual([]);
        expect(state.envelope).toBeUndefined();
      }),
    ),
  );

  it.effect("marks a started tool in progress and completes it in place", () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(
          claudeEvent({
            toolName: "mcp__zerops__zerops_deploy",
            type: "item.started",
            itemId: "toolu_deploy",
          }),
        );
        expect((yield* lifecycle.get(THREAD)).recentTools).toEqual([
          expect.objectContaining({ toolName: "zerops_deploy", status: "inProgress" }),
        ]);

        yield* lifecycle.ingest(
          claudeEvent({
            toolName: "mcp__zerops__zerops_deploy",
            text: '{"status":"ok"}',
            itemId: "toolu_deploy",
          }),
        );
        expect((yield* lifecycle.get(THREAD)).recentTools).toEqual([
          expect.objectContaining({ toolName: "zerops_deploy", status: "completed" }),
        ]);
      }),
    ),
  );

  it.effect("keeps threads independent", () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(claudeEvent({ text: envelopeBlock("develop-active") }));
        yield* lifecycle.ingest(
          claudeEvent({ threadId: OTHER_THREAD, text: envelopeBlock("bootstrap-active") }),
        );
        expect((yield* lifecycle.get(THREAD)).envelope?.phase).toBe("develop-active");
        expect((yield* lifecycle.get(OTHER_THREAD)).envelope?.phase).toBe("bootstrap-active");
      }),
    ),
  );

  it.effect("delivers events arriving on the provider bus to a thread subscriber", () =>
    Effect.scoped(
      Effect.gen(function* () {
        // The one test that goes through the real subscription rather than
        // `ingest`, so the stream wiring is covered too.
        const bus = yield* Queue.unbounded<SpiEvent>();
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
        const lifecycle = yield* ZeropsLifecycle.make({
          toolEvents: Stream.fromQueue(bus),
          repository,
        });

        const subscription = yield* lifecycle.subscribe(THREAD);
        expect(subscription.latest.envelope).toBeUndefined();

        const next = yield* Stream.runHead(subscription.changes).pipe(Effect.forkChild);
        yield* Queue.offer(bus, claudeEvent({ threadId: OTHER_THREAD }));
        yield* Queue.offer(bus, claudeEvent({}));
        const published = yield* Fiber.join(next);

        // The other thread's event must not reach this subscriber.
        expect(published._tag === "Some" ? published.value.threadId : undefined).toBe(THREAD);
      }),
    ).pipe(Effect.provide(persistence)),
  );

  it.effect("33 updates on other threads never displace thread A's latest", () =>
    withLifecycle((lifecycle) =>
      Effect.scoped(
        Effect.gen(function* () {
          // A slow subscriber: it reads nothing until every update has landed.
          const subscription = yield* lifecycle.subscribe(THREAD);
          yield* lifecycle.ingest(claudeEvent({ text: envelopeBlock("develop-active") }));
          for (let index = 0; index < 33; index += 1) {
            yield* lifecycle.ingest(
              claudeEvent({ threadId: OTHER_THREAD, text: envelopeBlock("bootstrap-active") }),
            );
          }

          const next = yield* Stream.runHead(subscription.changes).pipe(
            Effect.timeoutOption("1 second"),
            Effect.forkChild,
          );
          yield* TestClock.adjust("1 second");
          const delivered = Option.flatten(yield* Fiber.join(next));

          expect(Option.map(delivered, (state) => state.threadId)).toEqual(Option.some(THREAD));
          expect(Option.map(delivered, (state) => state.envelope?.phase)).toEqual(
            Option.some("develop-active"),
          );
        }),
      ),
    ),
  );

  it.effect("a transient DB read failure is not persisted over the row", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
        yield* Effect.scoped(
          Effect.gen(function* () {
            const first = yield* ZeropsLifecycle.make({
              toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
              repository,
            });
            yield* first.ingest(claudeEvent({}));
          }),
        );

        const readsFail = yield* Ref.make(true);
        const lifecycle = yield* ZeropsLifecycle.make({
          toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
          repository: {
            ...repository,
            getByThreadId: (threadId) =>
              Effect.flatMap(Ref.get(readsFail), (fail) =>
                fail
                  ? Effect.fail(
                      new PersistenceSqlError({ operation: "getByThreadId", cause: "busy" }),
                    )
                  : repository.getByThreadId(threadId),
              ),
          },
        });

        // A result with no envelope, folded while the row cannot be read.
        yield* lifecycle.ingest(
          claudeEvent({ toolName: "mcp__zerops__zerops_deploy", text: '{"status":"ok"}' }),
        );
        yield* Ref.set(readsFail, false);

        const row = yield* repository.getByThreadId(THREAD);
        expect(Option.map(row, (stored) => stored.envelope !== null)).toEqual(Option.some(true));
        expect((yield* lifecycle.get(THREAD)).envelope?.phase).toBe("develop-active");
      }),
    ).pipe(Effect.provide(persistence)),
  );

  it.effect("an update between snapshot and subscribe is delivered", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
        const service = yield* Deferred.make<ZeropsLifecycle.ZeropsLifecycle["Service"]>();
        const reads = yield* Ref.make(0);
        const scope = yield* Effect.scope;
        const lifecycle = yield* ZeropsLifecycle.make({
          toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
          repository: {
            ...repository,
            // The subscriber's snapshot read lets an update start while it is
            // in flight, and gives that update a second to land.
            getByThreadId: (threadId) =>
              Effect.gen(function* () {
                const stored = yield* repository.getByThreadId(threadId);
                if ((yield* Ref.getAndUpdate(reads, (count) => count + 1)) === 0) {
                  const racing = yield* Effect.flatMap(Deferred.await(service), (running) =>
                    running.ingest(claudeEvent({})),
                  ).pipe(Effect.forkIn(scope));
                  yield* Fiber.await(racing).pipe(Effect.timeoutOption("1 second"));
                }
                return stored;
              }),
          },
        });
        yield* Deferred.succeed(service, lifecycle);

        const subscribing = yield* lifecycle.subscribe(THREAD).pipe(Effect.forkScoped);
        yield* TestClock.adjust("1 second");
        const subscription = yield* Fiber.join(subscribing);

        const seen = yield* Stream.concat(
          Stream.make(subscription.latest),
          subscription.changes,
        ).pipe(
          Stream.filter((state) => state.envelope !== undefined),
          Stream.runHead,
          Effect.timeoutOption("1 second"),
          Effect.forkChild,
        );
        yield* TestClock.adjust("1 second");
        const delivered = Option.flatten(yield* Fiber.join(seen));

        expect(Option.map(delivered, (state) => state.envelope?.phase)).toEqual(
          Option.some("develop-active"),
        );
        expect((yield* lifecycle.get(THREAD)).envelope?.phase).toBe("develop-active");
      }),
    ).pipe(Effect.provide(persistence)),
  );

  it.effect("ingest failure restarts the ingest", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* Queue.unbounded<SpiEvent>();
        const runs = yield* Ref.make(0);
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
        const lifecycle = yield* ZeropsLifecycle.make({
          // The first run of the event stream dies; every later run is healthy.
          toolEvents: Stream.unwrap(
            Effect.map(
              Ref.getAndUpdate(runs, (count) => count + 1),
              (run) => (run === 0 ? Stream.die("provider stream defect") : Stream.fromQueue(bus)),
            ),
          ),
          repository,
        });

        const subscription = yield* lifecycle.subscribe(THREAD);
        const next = yield* Stream.runHead(subscription.changes).pipe(
          Effect.timeoutOption("1 minute"),
          Effect.forkChild,
        );
        yield* Queue.offer(bus, claudeEvent({}));
        yield* TestClock.adjust("1 minute");
        const delivered = Option.flatten(yield* Fiber.join(next));

        expect(Option.map(delivered, (state) => state.envelope?.phase)).toEqual(
          Option.some("develop-active"),
        );
      }),
    ).pipe(Effect.provide(persistence)),
  );

  it.effect("after a healthy run the restart backoff starts from the first rung again", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const starts = yield* Ref.make<ReadonlyArray<number>>([]);
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
        yield* ZeropsLifecycle.make({
          // Six runs die at once and climb the backoff to its cap; the seventh
          // runs healthily for two minutes before it dies; the eighth stays up.
          toolEvents: Stream.unwrap(
            Effect.gen(function* () {
              const now = yield* Clock.currentTimeMillis;
              const run = (yield* Ref.getAndUpdate(starts, (seen) => [...seen, now])).length;
              if (run < 6) {
                return Stream.die("provider stream defect");
              }
              if (run === 6) {
                return Stream.fromEffect(
                  Effect.andThen(Effect.sleep("2 minutes"), Effect.die("provider stream defect")),
                );
              }
              return Stream.never;
            }),
          ),
          repository,
        });

        for (let second = 0; second < 300; second += 1) {
          yield* TestClock.adjust("1 second");
        }

        expect((yield* Ref.get(starts)).map((at) => at / 1000)).toEqual([
          0, 1, 3, 7, 15, 31, 61, 182,
        ]);
      }),
    ).pipe(Effect.provide(persistence)),
  );

  it.effect(
    "a defect reading one thread's state does not stop the next event from being ingested",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          // The real bus is a fresh PubSub subscription per run, so an event
          // published while the ingest is down is never seen.
          const bus = yield* PubSub.unbounded<SpiEvent>();
          const subscribed = yield* Deferred.make<void>();
          const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
          const lifecycle = yield* ZeropsLifecycle.make({
            toolEvents: Stream.unwrap(
              Effect.gen(function* () {
                const subscription = yield* PubSub.subscribe(bus);
                yield* Deferred.succeed(subscribed, undefined);
                return Stream.fromSubscription(subscription);
              }),
            ),
            repository: {
              ...repository,
              getByThreadId: (threadId) =>
                threadId === OTHER_THREAD
                  ? Effect.die("corrupt row")
                  : repository.getByThreadId(threadId),
            },
          });

          const subscription = yield* lifecycle.subscribe(THREAD);
          const next = yield* Stream.runHead(subscription.changes).pipe(
            Effect.timeoutOption("1 minute"),
            Effect.forkChild,
          );
          yield* Deferred.await(subscribed);
          yield* PubSub.publish(bus, claudeEvent({ threadId: OTHER_THREAD }));
          yield* PubSub.publish(bus, claudeEvent({}));
          yield* TestClock.adjust("1 minute");
          const delivered = Option.flatten(yield* Fiber.join(next));

          expect(Option.map(delivered, (state) => state.envelope?.phase)).toEqual(
            Option.some("develop-active"),
          );
        }),
      ).pipe(Effect.provide(persistence)),
  );

  it.effect("reads a thread's state back after a restart", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;

        // First "process": one status call, then it goes away.
        yield* Effect.scoped(
          Effect.gen(function* () {
            const lifecycle = yield* ZeropsLifecycle.make({
              toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
              repository,
            });
            yield* lifecycle.ingest(claudeEvent({}));
          }),
        );

        // A container restart keeps state.sqlite, so a returning client must
        // still see its strip without a fresh `status` call.
        const restarted = yield* ZeropsLifecycle.make({
          toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
          repository,
        });
        expect((yield* restarted.get(THREAD)).envelope?.phase).toBe("develop-active");
      }),
    ).pipe(Effect.provide(persistence)),
  );
});

describe("ZeropsLifecycle.layer (wired to the owned ProviderRuntimeEventBus, not ProviderService)", () => {
  it.effect("ingests an event delivered over the bus", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* Queue.unbounded<SpiEvent>();
        const layer = ZeropsLifecycle.layer.pipe(
          Layer.provide(ProviderRuntimeEventBusTest.make(Stream.fromQueue(bus))),
          Layer.provide(persistence),
        );

        const published = yield* Effect.gen(function* () {
          const lifecycle = yield* ZeropsLifecycle.ZeropsLifecycle;
          const subscription = yield* lifecycle.subscribe(THREAD);
          const next = yield* Stream.runHead(subscription.changes).pipe(Effect.forkChild);
          yield* Queue.offer(bus, claudeEvent({}));
          return yield* Fiber.join(next);
        }).pipe(Effect.provide(layer));

        expect(published._tag === "Some" ? published.value.envelope?.phase : undefined).toBe(
          "develop-active",
        );
      }),
    ),
  );
});
