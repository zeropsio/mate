import * as NodeServices from "@effect/platform-node/NodeServices";
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

import {
  ConversationId,
  type ItemLifecyclePayload,
  type SpiEvent,
  type ThreadId,
} from "@t3tools/contracts";

import { layerTest as serverConfigTest } from "../config.ts";
import { conversationOfThread, providerThreadOf } from "../engine/MateEngine.ts";
import { PersistenceSqlError } from "../persistence/Errors.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as ZeropsThreadLifecycle from "../persistence/ZeropsThreadLifecycle.ts";
import { ProviderRuntimeEventBusTest } from "../spi/ProviderRuntimeEventBus.ts";
import { applyToolCall } from "../spi/toolCall.ts";
import { sweepCheckpointRefs } from "../vcs/checkpointRefsSweep.ts";
import { VcsProcess, type VcsProcessOutput } from "../vcs/VcsProcess.ts";
import { ZEROPS_ENVELOPE_FENCE } from "./zeropsEnvelope.ts";
import * as ZeropsLifecycle from "./ZeropsLifecycle.ts";
import {
  isLeaseRepository,
  makeZeropsLeaseRoster,
  makeZeropsRepositorySource,
  ZeropsLeaseRoster,
  ZeropsRepositorySource,
} from "./ZeropsRepositorySource.ts";

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
  readonly input?: Record<string, unknown>;
  readonly isError?: boolean;
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
        input: options.input ?? { action: "status" },
        ...(options.type === "item.started"
          ? {}
          : {
              result: {
                type: "tool_result",
                tool_use_id: options.itemId ?? "toolu_01",
                content: [{ type: "text", text: options.text ?? envelopeBlock("develop-active") }],
                ...(options.isError === true ? { is_error: true } : {}),
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
        threadOwner: conversationOfThread,
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

  it.effect("a provider session's lifecycle is read on its owning conversation", () =>
    withLifecycle((lifecycle) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(
          claudeEvent({ threadId: providerThreadOf(ConversationId.make(THREAD)) }),
        );
        const state = yield* lifecycle.get(THREAD);
        expect(
          state.envelope?.project.id,
          "ASSERTION: the conversation reads its native session's project",
        ).toBe("proj-1");
        expect(state.recentTools.map((tool) => tool.toolName)).toEqual(["zerops_workflow"]);
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

  it.effect(
    "keeps a dev service's last dev-server read when a later envelope did not read them",
    () =>
      withLifecycle((lifecycle) =>
        Effect.gen(function* () {
          const read = (devServers: ReadonlyArray<Record<string, unknown>> | undefined) =>
            claudeEvent({
              toolName: "mcp__zerops__zerops_dev_server",
              text: JSON.stringify({
                hostname: "kanbandev",
                envelope: {
                  ...JSON.parse(envelopeJsonText("develop-active")),
                  services: [
                    {
                      hostname: "kanbandev",
                      typeVersion: "nodejs@22",
                      runtimeClass: "dynamic",
                      status: "ACTIVE",
                      bootstrapped: true,
                      ...(devServers === undefined ? {} : { devServers }),
                    },
                  ],
                },
              }),
            });
          const servers = function* () {
            return (yield* lifecycle.get(THREAD)).envelope?.services[0]?.devServers?.map(
              (server) => [server.name, server.status, server.readAt],
            );
          };

          yield* lifecycle.ingest(
            read([
              { name: "web", port: 3000, status: "running", readAt: "2026-10-14T21:04:00Z" },
              { name: "worker", status: "crashed", readAt: "2026-10-14T21:04:00Z" },
            ]),
          );
          yield* lifecycle.ingest(read(undefined));
          expect(
            yield* servers(),
            "ASSERTION: an envelope that did not read keeps the last read",
          ).toEqual([
            ["web", "running", "2026-10-14T21:04:00Z"],
            ["worker", "crashed", "2026-10-14T21:04:00Z"],
          ]);

          yield* lifecycle.ingest(
            read([{ name: "web", port: 3000, status: "stopped", readAt: "2026-10-14T21:09:00Z" }]),
          );
          expect(yield* servers(), "a newer read replaces the whole list").toEqual([
            ["web", "stopped", "2026-10-14T21:09:00Z"],
          ]);
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

  it.effect("a defect while extracting one event's envelope does not stop the next event", () =>
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
          repository,
        });

        // A tool call whose result text is not a string: extracting its
        // envelope throws.
        const wellFormed = claudeEvent({ threadId: OTHER_THREAD });
        const malformed = {
          ...wellFormed,
          toolCall: {
            ...wellFormed.toolCall!,
            result: { text: null as unknown as string, failed: false },
          },
        } as SpiEvent;

        const subscription = yield* lifecycle.subscribe(THREAD);
        const next = yield* Stream.runHead(subscription.changes).pipe(
          Effect.timeoutOption("1 minute"),
          Effect.forkChild,
        );
        yield* Deferred.await(subscribed);
        yield* PubSub.publish(bus, malformed);
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

describe("ZeropsLifecycle: the lease a conversation's agent acquired", () => {
  const CONVERSATION = ConversationId.make("mate");
  const SESSION = providerThreadOf(CONVERSATION);
  /** The conversation the lifecycle reads a provider session's events on. */
  const OWNER = CONVERSATION as string as ThreadId;
  /** `branch` null: a lease acquired for none. */
  const lease = (alias: string, state = "held", branch: string | null = "feat-x") => ({
    alias,
    pool: "webpool",
    ...(branch === null ? {} : { branch }),
    containerHostname: `node-id-${alias.split("-")[1]}.runtime.webpool.zerops`,
    state,
    unverified: false,
  });
  const envelopeWith = (leases: ReadonlyArray<unknown> | undefined) => ({
    ...JSON.parse(envelopeJsonText("develop-active")),
    ...(leases === undefined ? {} : { leases }),
  });
  /** A `zerops_lease` call's result, as zcp's JSON carrier writes it. */
  const leaseCall = (options: {
    readonly input: Record<string, unknown>;
    readonly leases?: ReadonlyArray<unknown>;
    readonly envelope?: ReadonlyArray<unknown> | undefined;
    readonly isError?: boolean;
    readonly threadId?: ThreadId;
  }) =>
    claudeEvent({
      threadId: options.threadId ?? SESSION,
      toolName: "mcp__zerops__zerops_lease",
      input: options.input,
      ...(options.isError === undefined ? {} : { isError: options.isError }),
      text: JSON.stringify({
        action: options.input.action,
        leases: options.leases ?? [],
        envelope: envelopeWith(options.envelope),
      }),
    });
  const acquire = (alias: string, held: ReadonlyArray<unknown>, branch = "feat-x") =>
    leaseCall({
      input: { action: "acquire", pool: "webpool", branch },
      leases: [lease(alias, "held", branch)],
      envelope: held,
    });
  /** Any other Zerops tool whose envelope reads zcp's leases. */
  const statusReading = (leases: ReadonlyArray<unknown> | undefined) =>
    claudeEvent({
      threadId: SESSION,
      toolName: "mcp__zerops__zerops_deploy",
      text: JSON.stringify({ status: "DEPLOYED", envelope: envelopeWith(leases) }),
    });

  const withLeases = <A, E>(
    use: (
      lifecycle: ZeropsLifecycle.ZeropsLifecycle["Service"],
      told: () => Effect.Effect<ReadonlyArray<unknown>>,
      noted: () => Effect.Effect<ReadonlyArray<string> | undefined>,
    ) => Effect.Effect<A, E, never>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
        const changes = yield* Ref.make<ReadonlyArray<unknown>>([]);
        const roster = yield* Ref.make<ReadonlyArray<string> | undefined>(undefined);
        const lifecycle = yield* ZeropsLifecycle.make({
          toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
          repository,
          threadOwner: conversationOfThread,
          recordLease: (conversation, change, key) =>
            Ref.update(changes, (all) => [...all, { conversation, change, key }]),
          noteLeases: (aliases) => Ref.set(roster, aliases),
        });
        return yield* use(
          lifecycle,
          () =>
            Effect.map(Ref.get(changes), (all) =>
              all.map((entry) => (entry as { readonly change: unknown }).change),
            ),
          () => Ref.get(roster),
        );
      }),
    ).pipe(Effect.provide(persistence));

  it.effect("keeps the latest leases, and the last read where a result did not read them", () =>
    withLeases((lifecycle) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(statusReading([lease("webpool-3")]));
        yield* lifecycle.ingest(statusReading(undefined));
        const kept = (yield* lifecycle.get(OWNER)).envelope?.leases;
        expect(kept?.map((one) => one.alias)).toEqual(["webpool-3"]);
        yield* lifecycle.ingest(statusReading([]));
        expect((yield* lifecycle.get(OWNER)).envelope?.leases, "an empty read is none").toEqual([]);
      }),
    ),
  );

  it.effect("keeps a lease's dev servers while it is held, and drops them when it ends", () =>
    withLeases((lifecycle) =>
      Effect.gen(function* () {
        const preview = [
          {
            name: "webpool-3",
            port: 3000,
            url: "https://webpool-3003.zerops.app",
            status: "running",
            readAt: "2026-10-23T12:00:00Z",
          },
        ];
        const devServersOf = Effect.map(lifecycle.get(OWNER), (state) =>
          state.envelope?.leases?.find((one) => one.alias === "webpool-3"),
        );
        yield* lifecycle.ingest(
          statusReading([{ ...lease("webpool-3"), devServers: preview }, lease("webpool-4")]),
        );
        expect((yield* devServersOf)?.devServers).toEqual(preview);
        yield* lifecycle.ingest(statusReading([lease("webpool-3"), lease("webpool-4")]));
        expect((yield* devServersOf)?.devServers, "a read that did not ask keeps them").toEqual(
          preview,
        );
        yield* lifecycle.ingest(statusReading(undefined));
        expect((yield* devServersOf)?.devServers).toEqual(preview);
        yield* lifecycle.ingest(statusReading([lease("webpool-3", "released")]));
        expect(yield* devServersOf).not.toHaveProperty("devServers");
        yield* lifecycle.ingest(statusReading([]));
        yield* lifecycle.ingest(statusReading([lease("webpool-3")]));
        expect(yield* devServersOf, "a lease held again starts unread").not.toHaveProperty(
          "devServers",
        );
      }),
    ),
  );

  it.effect("a successful acquire binds its conversation to the container it leased", () =>
    withLeases((lifecycle, told) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(acquire("webpool-3", [lease("webpool-3")]));
        expect(yield* told()).toContainEqual({
          _tag: "BindLease",
          lease: { alias: "webpool-3", pool: "webpool", branch: "feat-x" },
        });
      }),
    ),
  );

  it.effect("the binding is told once per call: its key is the call's own", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
        const keys: Array<string> = [];
        const lifecycle = yield* ZeropsLifecycle.make({
          toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
          repository,
          threadOwner: conversationOfThread,
          recordLease: (_conversation, change, key) =>
            Effect.sync(() => {
              if (change._tag === "BindLease") keys.push(key);
            }),
        });
        const event = acquire("webpool-3", [lease("webpool-3")]);
        yield* lifecycle.ingest(event);
        yield* lifecycle.ingest(event);
        expect(keys).toHaveLength(2);
        expect(keys[0]).toBe(keys[1]);
      }),
    ).pipe(Effect.provide(persistence)),
  );

  it.effect("a lease acquired for no branch binds without one", () =>
    withLeases((lifecycle, told) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(
          leaseCall({
            input: { action: "acquire", pool: "webpool" },
            leases: [lease("webpool-3", "held", null)],
          }),
        );
        expect(yield* told()).toContainEqual({
          _tag: "BindLease",
          lease: { alias: "webpool-3", pool: "webpool", branch: null },
        });
      }),
    ),
  );

  it.effect(
    "an acquire whose result names no lease of its own binds the one its envelope holds",
    () =>
      withLeases((lifecycle, told) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(
            leaseCall({
              input: { action: "acquire", pool: "webpool", branch: "feat-y" },
              envelope: [lease("webpool-3"), lease("webpool-4", "held", "feat-y")],
            }),
          );
          expect(yield* told()).toContainEqual({
            _tag: "BindLease",
            lease: { alias: "webpool-4", pool: "webpool", branch: "feat-y" },
          });
        }),
      ),
  );

  it.effect("a failed acquire, or one still running, binds nothing", () =>
    withLeases((lifecycle, told) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(
          leaseCall({
            input: { action: "acquire", pool: "webpool", branch: "feat-x" },
            isError: true,
          }),
        );
        yield* lifecycle.ingest(
          claudeEvent({
            threadId: SESSION,
            toolName: "mcp__zerops__zerops_lease",
            type: "item.started",
            input: { action: "acquire", pool: "webpool", branch: "feat-x" },
          }),
        );
        expect(yield* told()).toEqual([]);
      }),
    ),
  );

  it.effect("a thread that is no conversation of the engine is bound to nothing", () =>
    withLeases((lifecycle, told) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest({
          ...acquire("webpool-3", [lease("webpool-3")]),
          threadId: THREAD,
        });
        expect(yield* told()).toEqual([]);
      }),
    ),
  );

  it.effect(
    "every read of zcp's leases tells which mounts are leases, and a restart the last",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
          const noted = yield* Ref.make<ReadonlyArray<string> | undefined>(undefined);
          const start = ZeropsLifecycle.make({
            toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
            repository,
            threadOwner: conversationOfThread,
            noteLeases: (aliases) => Ref.set(noted, aliases),
          });
          const lifecycle = yield* start;
          expect(yield* Ref.get(noted), "nothing stored, nothing told").toBeUndefined();
          yield* lifecycle.ingest(statusReading([lease("webpool-3"), lease("webpool-4", "lost")]));
          expect(yield* Ref.get(noted)).toEqual(["webpool-3", "webpool-4"]);

          // A restart: the roster starts empty, and the last stored read is told again.
          yield* Ref.set(noted, undefined);
          yield* start;
          expect(yield* Ref.get(noted)).toEqual(["webpool-3", "webpool-4"]);
        }),
      ).pipe(Effect.provide(persistence)),
  );

  /**
   * The lifecycle over conversations whose records bind as the engine's does: a conversation takes
   * its first lease, and lets go of it when told the lease ended.
   */
  const withConversations = <A, E>(
    use: (
      lifecycle: ZeropsLifecycle.ZeropsLifecycle["Service"],
      bound: () => Effect.Effect<Readonly<Record<string, string>>>,
      told: () => Effect.Effect<ReadonlyArray<ZeropsLifecycle.LeaseChange>>,
    ) => Effect.Effect<A, E, never>,
  ) =>
    Effect.scoped(
      Effect.gen(function* () {
        const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
        const records = yield* Ref.make<Readonly<Record<string, string>>>({});
        const changes = yield* Ref.make<ReadonlyArray<ZeropsLifecycle.LeaseChange>>([]);
        const lifecycle = yield* ZeropsLifecycle.make({
          toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
          repository,
          threadOwner: conversationOfThread,
          leaseBindings: Effect.map(Ref.get(records), (all) =>
            Object.entries(all).map(([conversation, alias]) => ({
              conversation: conversation as ThreadId,
              alias,
            })),
          ),
          recordLease: (conversation, change) =>
            Effect.andThen(
              Ref.update(changes, (all) => [...all, change]),
              Ref.update(records, (all) => {
                const { [conversation]: alias, ...others } = all;
                if (change._tag === "BindLease")
                  return alias === undefined ? { ...all, [conversation]: change.lease.alias } : all;
                return alias === change.ended ? others : all;
              }),
            ),
        });
        return yield* use(
          lifecycle,
          () => Ref.get(records),
          () => Ref.get(changes),
        );
      }),
    ).pipe(Effect.provide(persistence));
  const sessionOf = (name: string) => providerThreadOf(ConversationId.make(name));
  const release = (alias: string, threadId: ThreadId, held: ReadonlyArray<unknown>) =>
    leaseCall({
      input: { action: "release", lease: alias },
      leases: [lease(alias, "released")],
      envelope: held,
      threadId,
    });
  const acquireBy = (threadId: ThreadId, alias: string, held: ReadonlyArray<unknown>) => ({
    ...acquire(alias, held),
    threadId,
  });

  it.effect("a release unbinds the lease it released", () =>
    withConversations((lifecycle, bound) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(acquireBy(sessionOf("ada"), "webpool-3", [lease("webpool-3")]));
        yield* lifecycle.ingest(
          leaseCall({
            input: { action: "release", lease: "webpool-3" },
            leases: [lease("webpool-3", "released")],
            threadId: sessionOf("ada"),
          }),
        );
        expect(yield* bound()).toEqual({});
      }),
    ),
  );

  it.effect(
    "a lease gone from zcp's leases, or read lost or released, unbinds; an unchanged read tells nothing",
    () =>
      withConversations((lifecycle, bound, told) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(acquireBy(sessionOf("ada"), "webpool-3", [lease("webpool-3")]));
          yield* lifecycle.ingest(
            acquireBy(sessionOf("bob"), "webpool-4", [lease("webpool-3"), lease("webpool-4")]),
          );
          const first = (yield* told()).length;
          yield* lifecycle.ingest(statusReading([lease("webpool-3"), lease("webpool-4")]));
          expect((yield* told()).length, "the same leases again say nothing new").toBe(first);
          yield* lifecycle.ingest(
            statusReading([lease("webpool-3", "lost"), lease("webpool-5", "unmounted")]),
          );
          expect(yield* bound()).toEqual({});
          expect((yield* told()).slice(first)).toEqual([
            { _tag: "UnbindLease", ended: "webpool-3" },
            { _tag: "UnbindLease", ended: "webpool-4" },
          ]);
        }),
      ),
  );

  it.effect("an acquire's binding is told after what its own read of the leases unbinds", () =>
    withConversations((lifecycle, bound, told) =>
      Effect.gen(function* () {
        yield* lifecycle.ingest(acquireBy(sessionOf("ada"), "webpool-3", [lease("webpool-3")]));
        const first = (yield* told()).length;
        yield* lifecycle.ingest(
          acquireBy(sessionOf("ada"), "webpool-4", [
            lease("webpool-3", "lost"),
            lease("webpool-4"),
          ]),
        );
        expect((yield* told()).slice(first).map((change) => change._tag)).toEqual([
          "UnbindLease",
          "BindLease",
        ]);
        expect(yield* bound()).toEqual({ ada: "webpool-4" });
      }),
    ),
  );

  it.effect(
    "a lease another conversation released, then a third acquired again, is bound to the third alone",
    () =>
      withConversations((lifecycle, bound) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(acquireBy(sessionOf("ada"), "webpool-3", [lease("webpool-3")]));
          expect(yield* bound()).toEqual({ ada: "webpool-3" });
          yield* lifecycle.ingest(release("webpool-3", sessionOf("bob"), []));
          expect(yield* bound(), "a release by any conversation unbinds its holder").toEqual({});
          yield* lifecycle.ingest(acquireBy(sessionOf("cid"), "webpool-3", [lease("webpool-3")]));
          expect(yield* bound()).toEqual({ cid: "webpool-3" });
        }),
      ),
  );

  it.effect(
    "a lease acquired again by another conversation unbinds the one bound to it, its release unseen",
    () =>
      withConversations((lifecycle, bound) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(acquireBy(sessionOf("ada"), "webpool-3", [lease("webpool-3")]));
          yield* lifecycle.ingest(acquireBy(sessionOf("cid"), "webpool-3", [lease("webpool-3")]));
          expect(yield* bound()).toEqual({ cid: "webpool-3" });
        }),
      ),
  );

  it.effect.each([
    { name: "gone from them", read: [lease("webpool-4")] },
    { name: "lost", read: [lease("webpool-3", "lost"), lease("webpool-4")] },
    { name: "released", read: [lease("webpool-3", "released"), lease("webpool-4")] },
    {
      name: "reserved with no record of zcp's",
      read: [lease("webpool-3", "unknown-holder"), lease("webpool-4")],
    },
  ])(
    "another conversation's read of zcp's leases with the lease $name unbinds every conversation bound to it",
    ({ read }) =>
      withConversations((lifecycle, bound) =>
        Effect.gen(function* () {
          yield* lifecycle.ingest(acquireBy(sessionOf("ada"), "webpool-3", [lease("webpool-3")]));
          yield* lifecycle.ingest(
            acquireBy(sessionOf("bob"), "webpool-4", [lease("webpool-3"), lease("webpool-4")]),
          );
          yield* lifecycle.ingest({ ...statusReading(read), threadId: sessionOf("cid") });
          expect(yield* bound()).toEqual({ bob: "webpool-4" });
        }),
      ),
  );

  it.effect(
    "a lease's mount stays a lease's to every sweep after a restart that kept an older read of the leases",
    () =>
      Effect.scoped(
        Effect.gen(function* () {
          const repository = yield* ZeropsThreadLifecycle.ZeropsThreadLifecycleRepository;
          const ada = providerThreadOf(ConversationId.make("ada"));
          const bob = providerThreadOf(ConversationId.make("bob"));
          const before = yield* makeZeropsLeaseRoster;
          yield* Effect.scoped(
            Effect.gen(function* () {
              const lifecycle = yield* ZeropsLifecycle.make({
                toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
                repository,
                threadOwner: conversationOfThread,
                noteLeases: before.note,
              });
              yield* lifecycle.ingest({ ...statusReading([]), threadId: ada });
              yield* TestClock.adjust("1 second");
              yield* lifecycle.ingest({
                ...acquire("webpool-3", [lease("webpool-3")]),
                threadId: bob,
              });
              yield* TestClock.adjust("1 second");
              // A Zerops tool that reads no leases: ada's older read is stored again, newest.
              yield* lifecycle.ingest(
                claudeEvent({
                  threadId: ada,
                  toolName: "mcp__zerops__zerops_logs",
                  text: "no envelope",
                }),
              );
            }),
          );

          // A restart: a new roster, told what the store kept, and the mounts read again.
          const roster = yield* makeZeropsLeaseRoster;
          yield* ZeropsLifecycle.make({
            toolEvents: Stream.empty as Stream.Stream<SpiEvent>,
            repository,
            threadOwner: conversationOfThread,
            noteLeases: roster.note,
          });
          const source = yield* makeZeropsRepositorySource({
            enabled: true,
            readMountTable: Effect.succeed(
              [
                "appdev:/var/www /var/www/appdev fuse.sshfs rw,nosuid,nodev,relatime 0 0",
                "webpool-3:/var/www /var/www/webpool-3 fuse.sshfs rw,nosuid,nodev,relatime 0 0",
              ].join("\n"),
            ),
            leaseAliases: roster.aliases,
          });

          const listed = yield* source.list;
          const webpool =
            listed._tag === "available"
              ? listed.repositories.find((entry) => entry.host === "webpool-3")
              : undefined;
          expect(webpool?.kind).toBe("lease");
          expect(webpool !== undefined && isLeaseRepository(webpool)).toBe(true);

          const swept: Array<string> = [];
          yield* sweepCheckpointRefs.pipe(
            Effect.provide(
              Layer.mergeAll(
                Layer.succeed(ZeropsRepositorySource, source),
                serverConfigTest("/nowhere", { prefix: "sweep" }),
                Layer.succeed(
                  VcsProcess,
                  VcsProcess.of({
                    run: (input) =>
                      Effect.sync(() => {
                        swept.push(input.cwd);
                        return {
                          exitCode: 0 as VcsProcessOutput["exitCode"],
                          stdout: "",
                          stderr: "",
                          stdoutTruncated: false,
                          stderrTruncated: false,
                        };
                      }),
                  }),
                ),
              ),
            ),
          );
          expect(swept).toEqual(["/var/www/appdev"]);
        }),
      ).pipe(Effect.provide(Layer.merge(persistence, NodeServices.layer))),
  );
});

describe("ZeropsLifecycle.layer (wired to the owned ProviderRuntimeEventBus, not ProviderService)", () => {
  it.effect("ingests an event delivered over the bus", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const bus = yield* Queue.unbounded<SpiEvent>();
        const layer = ZeropsLifecycle.layer(conversationOfThread).pipe(
          Layer.provide(ProviderRuntimeEventBusTest.make(Stream.fromQueue(bus))),
          Layer.provide(persistence),
          Layer.provide(Layer.effect(ZeropsLeaseRoster, makeZeropsLeaseRoster)),
        );

        const published = yield* Effect.gen(function* () {
          const lifecycle = yield* ZeropsLifecycle.ZeropsLifecycle;
          const subscription = yield* lifecycle.subscribe(THREAD);
          const next = yield* Stream.runHead(subscription.changes).pipe(Effect.forkChild);
          yield* Queue.offer(
            bus,
            claudeEvent({ threadId: providerThreadOf(ConversationId.make(THREAD)) }),
          );
          return yield* Fiber.join(next);
        }).pipe(Effect.provide(layer));

        expect(published._tag === "Some" ? published.value.envelope?.phase : undefined).toBe(
          "develop-active",
        );
      }),
    ),
  );
});
