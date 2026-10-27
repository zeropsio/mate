import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  EventId,
  PROVIDER_RUNTIME_SPI_VERSION,
  ProviderDriverKind,
  ThreadId,
  TurnId,
  type SpiEvent,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { handledQueue } from "@t3tools/shared/testing/handledQueue";
import * as Fiber from "effect/Fiber";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import { ZeropsSetup } from "./ZeropsSetup.ts";
import {
  layer as relayLayer,
  STAND_UP_RELAY_INTERVAL,
  standUpProgressOf,
  type StandUpProgress,
  ZeropsStandUpRelay,
} from "./ZeropsStandUpRelay.ts";
import { MateEngine } from "../engine/MateEngine.ts";
import { parseZcpStatus, type ZcpStatus } from "./zeropsSetupSteps.ts";
import { inertMateEngine } from "../engine/testing/inertEngine.ts";

/**
 * Starts listening before the trigger; the next status pass must actually return. A followed
 * call's next pass is one interval away on the test clock.
 */
const checked = <A, E, R>(trigger: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const relay = yield* ZeropsStandUpRelay;
    const pass = yield* relay.nextPass.pipe(Effect.forkChild({ startImmediately: true }));
    yield* trigger;
    yield* TestClock.adjust(STAND_UP_RELAY_INTERVAL);
    yield* Fiber.join(pass);
  }).pipe(Effect.orDie);
/** The followed calls' ends: one more pass, an interval on, finds the stand-up gone. */
const finished = Effect.gen(function* () {
  const relay = yield* ZeropsStandUpRelay;
  const ended = yield* relay.finished.pipe(Effect.forkChild({ startImmediately: true }));
  yield* TestClock.adjust(STAND_UP_RELAY_INTERVAL);
  yield* Fiber.join(ended);
}).pipe(Effect.orDie);

const CALL_AT = "2026-10-01T10:00:00.000Z";

const section = (overrides: Record<string, unknown> = {}) =>
  parseZcpStatus({
    version: 1,
    standup: {
      state: "running",
      phase: "development",
      startedAt: "2026-10-01T10:00:01Z",
      services: [
        { hostname: "api", step: "build", state: "running", processId: "proc-1", at: CALL_AT },
        { hostname: "web", step: "build", state: "pending" },
      ],
      ...overrides,
    },
  });

describe("standUpProgressOf", () => {
  it("is the call's services, step by step, with the running process", () => {
    assert.deepStrictEqual(standUpProgressOf(section(), CALL_AT), {
      phase: "development",
      state: "running",
      services: [
        { hostname: "api", step: "build", state: "running", processId: "proc-1", at: CALL_AT },
        { hostname: "web", step: "build", state: "pending", processId: "", at: "" },
      ],
    });
  });

  const none: ReadonlyArray<[string, ZcpStatus | undefined]> = [
    ["no status file", undefined],
    ["an idle stand-up", section({ state: "idle" })],
    ["the previous call's section", section({ startedAt: "2026-10-01T09:40:00Z" })],
    [
      "a section an earlier call goes on with",
      section({ startedAt: "2026-10-01T09:40:00Z", callStartedAt: "2026-10-01T09:50:00Z" }),
    ],
  ];
  it.each(Array.from(none, ([name, status]) => ({ title: `is nothing for ${name}`, status })))(
    "$title",
    ({ status }) => assert.isUndefined(standUpProgressOf(status, CALL_AT)),
  );

  it("is the stage call's, going on with the section its first call left waiting", () => {
    const carried = section({
      phase: "stage",
      startedAt: "2026-10-01T09:40:00Z",
      callStartedAt: "2026-10-01T10:00:01Z",
    });
    assert.strictEqual(standUpProgressOf(carried, CALL_AT)?.phase, "stage");
  });

  it("cuts a service's error to a card line", () => {
    const progress = standUpProgressOf(
      section({
        services: [{ hostname: "api", step: "deploy", state: "failed", error: "x".repeat(900) }],
      }),
      CALL_AT,
    );
    assert.strictEqual(progress?.services[0]?.error?.length, 300);
  });
});

const standUpEvent = (
  type: "item.started" | "item.updated" | "item.completed",
  createdAt: string,
  itemId = "call-1",
  provider = "claudeAgent",
): SpiEvent =>
  ({
    eventId: EventId.make(`event-${type}`),
    provider: ProviderDriverKind.make(provider),
    threadId: ThreadId.make("thread-main"),
    turnId: TurnId.make("turn-1"),
    itemId,
    createdAt,
    type,
    payload: { itemType: "mcp_tool_call" },
    toolCall: { name: "zerops_standup", rawName: "mcp__zerops__zerops_standup" },
  }) as unknown as SpiEvent;

/** An engine that keeps each progress a call is given, live on its item; a clear is not kept. */
const progressEngine = (shown: Ref.Ref<ReadonlyArray<StandUpProgress>>) =>
  Layer.succeed(MateEngine, {
    ...inertMateEngine,
    callProgress: (_thread, _tool, progress) =>
      progress === null
        ? Effect.void
        : Ref.update(shown, (all) => [...all, progress as StandUpProgress]),
  });

describe("ZeropsStandUpRelay", () => {
  it.effect("relays each change of the call's section into one progress row, then stops", () =>
    Effect.gen(function* () {
      const events = yield* handledQueue<SpiEvent>();
      const status = yield* Ref.make<ZcpStatus | undefined>(undefined);
      const appended = yield* Ref.make<ReadonlyArray<StandUpProgress>>([]);
      const appends = Ref.get(appended);
      const layer = relayLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ProviderRuntimeEventBus, {
              version: PROVIDER_RUNTIME_SPI_VERSION,
              events: events.events,
              enrichmentFailures: Stream.empty,
            }),
            Layer.mock(ZeropsSetup)({
              status: Ref.get(status),
              standUpGone: () => Effect.succeed(false),
              noteStandUpCall: () => Effect.void,
            }),
            progressEngine(appended),
            NodeServices.layer,
          ),
        ),
      );
      yield* Effect.gen(function* () {
        yield* checked(events.publish(standUpEvent("item.started", CALL_AT)));
        assert.deepStrictEqual(yield* appends, [], "nothing to say before zcp writes");
        yield* checked(Ref.set(status, section()));
        yield* checked(Effect.void);
        const unchangedTwice = (yield* appends).length;
        yield* Ref.set(
          status,
          section({
            state: "done",
            services: [{ hostname: "api", step: "verify", state: "done", processId: "proc-2" }],
          }),
        );
        yield* events.publish(standUpEvent("item.completed", "2026-10-01T10:05:00.000Z"));
        const all = yield* appends;
        assert.strictEqual(unchangedTwice, 1, "an unchanged section is written once");
        assert.strictEqual(all.length, 2);
        assert.deepStrictEqual(all[1], {
          phase: "development",
          state: "done",
          services: [
            { hostname: "api", step: "verify", state: "done", processId: "proc-2", at: "" },
          ],
        });
        yield* Ref.set(status, section({ state: "failed" }));
        assert.strictEqual((yield* appends).length, 2, "a settled call is followed no more");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

// An ACP agent (Cursor, Grok, Antigravity) sends no start: its call's first
// update is where the stand-up began.
describe("ZeropsStandUpRelay: a call first seen running", () => {
  it.effect("follows it from its first update, once, and never after its end", () =>
    Effect.gen(function* () {
      const events = yield* handledQueue<SpiEvent>();
      const status = yield* Ref.make<ZcpStatus | undefined>(section());
      const appended = yield* Ref.make<ReadonlyArray<StandUpProgress>>([]);
      const appends = Ref.get(appended);
      const layer = relayLayer.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.succeed(ProviderRuntimeEventBus, {
              version: PROVIDER_RUNTIME_SPI_VERSION,
              events: events.events,
              enrichmentFailures: Stream.empty,
            }),
            Layer.mock(ZeropsSetup)({
              status: Ref.get(status),
              standUpGone: () => Effect.succeed(false),
              noteStandUpCall: () => Effect.void,
            }),
            progressEngine(appended),
            NodeServices.layer,
          ),
        ),
      );
      yield* Effect.gen(function* () {
        yield* checked(events.publish(standUpEvent("item.updated", CALL_AT, "call-1", "cursor")));
        yield* events.publish(
          standUpEvent("item.updated", "2026-10-01T10:01:00.000Z", "call-1", "cursor"),
        );
        assert.strictEqual((yield* appends).length, 1, "its first update follows it");
        yield* Ref.set(status, section({ state: "done" }));
        yield* events.publish(
          standUpEvent("item.completed", "2026-10-01T10:05:00.000Z", "call-1", "cursor"),
        );
        assert.strictEqual((yield* appends).length, 2, "its end writes once more");
        yield* events.publish(
          standUpEvent("item.updated", "2026-10-01T10:06:00.000Z", "call-1", "cursor"),
        );
        yield* Ref.set(status, section({ state: "failed" }));
        assert.strictEqual((yield* appends).length, 2, "a late update follows it no more");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

const DEAD_AT = "2026-10-01T10:00:01Z";

describe("ZeropsStandUpRelay: a stand-up whose MCP server died", () => {
  it.effect("stops following it once its process is gone, and leaves the card's last state", () =>
    Effect.gen(function* () {
      const events = yield* handledQueue<SpiEvent>();
      const status = yield* Ref.make<ZcpStatus | undefined>(section());
      const gone = yield* Ref.make(false);
      const noted = yield* Ref.make<ReadonlyArray<unknown>>([]);
      const appended = yield* Ref.make(0);
      const layer = deadLayer(events, status, gone, noted, appended);
      yield* Effect.gen(function* () {
        yield* checked(events.publish(standUpEvent("item.started", CALL_AT)));
        assert.strictEqual(yield* Ref.get(appended), 1);
        yield* Ref.set(gone, true);
        yield* Ref.set(status, section({ state: "running", phase: "stage" }));
        yield* finished;
        yield* Ref.set(gone, false);
        yield* Ref.set(status, section({ state: "failed" }));
        assert.strictEqual(
          yield* Ref.get(appended),
          1,
          "a dead stand-up's section is never written",
        );
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("a stage call going on with its first call's section is followed, and judged", () =>
    Effect.gen(function* () {
      const events = yield* handledQueue<SpiEvent>();
      const carried = (state: string) =>
        section({
          phase: "stage",
          startedAt: "2026-10-01T09:40:00Z",
          callStartedAt: "2026-10-01T10:00:01Z",
          services: [{ hostname: "apistage", step: "build", state }],
        });
      const status = yield* Ref.make<ZcpStatus | undefined>(carried("running"));
      const gone = yield* Ref.make(false);
      const noted = yield* Ref.make<ReadonlyArray<unknown>>([]);
      const appended = yield* Ref.make(0);
      const layer = deadLayer(events, status, gone, noted, appended, "2026-10-01T09:40:00Z");
      yield* Effect.gen(function* () {
        yield* checked(events.publish(standUpEvent("item.started", CALL_AT)));
        assert.strictEqual(yield* Ref.get(appended), 1, "the stage phase reaches the stage call");
        yield* Ref.set(gone, true);
        yield* Ref.set(status, carried("done"));
        yield* finished;
        assert.strictEqual(yield* Ref.get(appended), 1, "its process gone, it is followed no more");
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );

  it.effect("a retry is followed while the dead one's section is still in the file", () =>
    Effect.gen(function* () {
      const events = yield* handledQueue<SpiEvent>();
      // The previous call's section, its process gone, until the retry's zcp call writes its own.
      const status = yield* Ref.make<ZcpStatus | undefined>(
        section({ startedAt: "2026-10-01T09:40:00Z" }),
      );
      const gone = yield* Ref.make(true);
      const noted = yield* Ref.make<ReadonlyArray<unknown>>([]);
      const appended = yield* Ref.make(0);
      const layer = deadLayer(events, status, gone, noted, appended, "2026-10-01T09:40:00Z");
      yield* Effect.gen(function* () {
        yield* checked(events.publish(standUpEvent("item.started", CALL_AT)));
        assert.strictEqual(yield* Ref.get(appended), 0, "the dead section is not this call's");
        yield* checked(Ref.set(status, section()));
        assert.strictEqual(yield* Ref.get(appended), 1, "the retry's own section reaches its card");
        assert.deepStrictEqual(yield* Ref.get(noted), [
          { threadId: "thread-main", turnId: "turn-1", startedAt: CALL_AT },
        ]);
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

/** The relay over a file whose stand-up at `deadAt` lost its process while `gone` holds. */
const deadLayer = (
  events: Effect.Success<ReturnType<typeof handledQueue<SpiEvent>>>,
  status: Ref.Ref<ZcpStatus | undefined>,
  gone: Ref.Ref<boolean>,
  noted: Ref.Ref<ReadonlyArray<unknown>>,
  appended: Ref.Ref<number>,
  deadAt = DEAD_AT,
) =>
  relayLayer.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(ProviderRuntimeEventBus, {
          version: PROVIDER_RUNTIME_SPI_VERSION,
          events: events.events,
          enrichmentFailures: Stream.empty,
        }),
        Layer.mock(ZeropsSetup)({
          status: Ref.get(status),
          standUpGone: (read) =>
            Effect.map(Ref.get(gone), (dead) => dead && read?.standup?.startedAt === deadAt),
          noteStandUpCall: (call) => Ref.update(noted, (all) => [...all, call]),
        }),
        Layer.succeed(MateEngine, {
          ...inertMateEngine,
          callProgress: (_thread, _tool, progress) =>
            progress === null ? Effect.void : Ref.update(appended, (count) => count + 1),
        }),
        NodeServices.layer,
      ),
    ),
  );

describe("ZeropsStandUpRelay: only the newest call of a live thread", () => {
  const world = Effect.gen(function* () {
    const events = yield* handledQueue<SpiEvent>();
    const status = yield* Ref.make<ZcpStatus | undefined>(undefined);
    const appended = yield* Ref.make<ReadonlyArray<string>>([]);
    const layer = relayLayer.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(ProviderRuntimeEventBus, {
            version: PROVIDER_RUNTIME_SPI_VERSION,
            events: events.events,
            enrichmentFailures: Stream.empty,
          }),
          Layer.mock(ZeropsSetup)({
            status: Ref.get(status),
            standUpGone: () => Effect.succeed(false),
            noteStandUpCall: () => Effect.void,
          }),
          Layer.succeed(MateEngine, {
            ...inertMateEngine,
            callProgress: (_thread, _tool, progress) =>
              progress === null
                ? Effect.void
                : Ref.update(appended, (all) => [
                    ...all,
                    (progress as StandUpProgress).services.map((service) => service.state).join(),
                  ]),
          }),
          NodeServices.layer,
        ),
      ),
    );
    return { events, status, appended, layer };
  });
  const running = (startedAt: string, state: string) =>
    section({ startedAt, services: [{ hostname: "api", step: "build", state }] });

  it.effect("a newer stand-up call ends the following of the one before", () =>
    Effect.gen(function* () {
      const { events, status, appended, layer } = yield* world;
      yield* Effect.gen(function* () {
        yield* Ref.set(status, running("2026-10-01T10:00:01Z", "running"));
        yield* checked(events.publish(standUpEvent("item.started", CALL_AT, "call-1")));
        // The first call died without an end; its retry starts.
        yield* events.publish(standUpEvent("item.started", "2026-10-01T10:20:00.000Z", "call-2"));
        yield* checked(Ref.set(status, running("2026-10-01T10:20:01Z", "running")));
        yield* checked(Ref.set(status, running("2026-10-01T10:20:01Z", "done")));
        // The first call's section once, then the retry's twice: the first is followed no more.
        assert.deepStrictEqual(yield* Ref.get(appended), ["running", "running", "done"]);
      }).pipe(Effect.provide(layer), Effect.scoped);
    }),
  );
});

describe("ZeropsStandUpRelay on the Mate engine", () => {
  it.effect(
    "relays each change of the call's section live onto the call, sending V1 nothing, and clears it at the call's end",
    () =>
      Effect.gen(function* () {
        const events = yield* handledQueue<SpiEvent>();
        const status = yield* Ref.make<ZcpStatus | undefined>(undefined);
        const shown = yield* Ref.make<ReadonlyArray<readonly [string, string, unknown]>>([]);
        const layer = relayLayer.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(ProviderRuntimeEventBus, {
                version: PROVIDER_RUNTIME_SPI_VERSION,
                events: events.events,
                enrichmentFailures: Stream.empty,
              }),
              Layer.mock(ZeropsSetup)({
                status: Ref.get(status),
                standUpGone: () => Effect.succeed(false),
                noteStandUpCall: () => Effect.void,
              }),
              Layer.succeed(MateEngine, {
                ...inertMateEngine,
                callProgress: (thread, tool, progress) =>
                  Ref.update(shown, (all) => [...all, [thread, tool, progress] as const]),
              }),
              NodeServices.layer,
            ),
          ),
        );
        yield* Effect.gen(function* () {
          yield* events.publish(standUpEvent("item.started", CALL_AT));
          yield* checked(Ref.set(status, section()));
          yield* Ref.set(status, section({ state: "done" }));
          yield* events.publish(standUpEvent("item.completed", "2026-10-01T10:05:00.000Z"));
          const all = yield* Ref.get(shown);
          // The call's end clears its progress: the record holds its result now.
          assert.deepStrictEqual(all.at(-1), ["thread-main", "zerops_standup", null]);
          assert.deepStrictEqual(
            all
              .slice(0, -1)
              .map(([thread, tool, progress]) => [
                thread,
                tool,
                (progress as { readonly state: string }).state,
              ]),
            [
              ["thread-main", "zerops_standup", "running"],
              ["thread-main", "zerops_standup", "done"],
            ],
          );
        }).pipe(Effect.provide(layer), Effect.scoped);
      }),
  );
});
