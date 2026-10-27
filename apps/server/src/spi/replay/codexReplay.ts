/**
 * Codex replay: drives the real, ported `makeCodexAdapter`
 * (apps/server/src/provider/Layers/CodexAdapter.ts) through its existing
 * `options.makeRuntime` test seam — the same seam `CodexAdapter.test.ts`'s
 * `FakeCodexRuntime` plugs into. `makeCodexAdapter` subscribes to
 * `runtime.events` and calls the ported pure mapper `mapToRuntimeEvents`
 * per event (CodexAdapter.ts:1746); that function isn't exported (it's
 * module-private), so this harness reaches it the same way the ported test
 * suite already does — via the runtime seam, not a private import.
 *
 * Each fixture `message` line carries a real captured wire notification
 * (`{method, params}`). This module converts it to a `ProviderEvent` (the
 * shape `runtime.events` yields) using the notification's own address
 * (`params.threadId`/`params.thread.id` — root or child, whichever the
 * capture recorded) — it does NOT replay `CodexSessionRuntime`'s
 * child-registration/`collabAgent/*` synthesis step, so a captured child
 * notification is mapped directly rather than through the synthetic
 * collab-agent event it would actually produce in production. That
 * synthesis path already has dedicated coverage
 * (CodexCollabWire.test.ts, CodexCollabRuntime.integration.test.ts); this
 * harness's job is pinning `mapToRuntimeEvents`'s per-shape behavior, which
 * holds regardless of which thread a notification is addressed to.
 */
import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CodexSettings,
  type ProviderApprovalDecision,
  ProviderDriverKind,
  type ProviderEvent,
  type SpiEvent,
  type ProviderSession,
  type ProviderTurnStartResult,
  type ProviderUserInputAnswers,
  ThreadId,
  TurnId,
  EventId,
  ApprovalRequestId,
  ProviderItemId,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { ServerConfig } from "../../config.ts";
import { ServerSettingsService } from "../../serverSettings.ts";
import { makeCodexAdapter } from "../../provider/Layers/CodexAdapter.ts";
import { ProviderSessionDirectory } from "../../provider/Services/ProviderSessionDirectory.ts";
import type {
  CodexSessionRuntimeShape,
  CodexThreadSnapshot,
} from "../../provider/Layers/CodexSessionRuntime.ts";

import type { Fixture } from "./types.ts";

const decodeCodexSettings = Schema.decodeSync(CodexSettings);

const REPLAY_THREAD_ID = ThreadId.make("spi-replay-codex-thread");
const REPLAY_NOW = "2026-01-01T00:00:00.000Z";

const providerSessionDirectoryTestLayer = Layer.succeed(ProviderSessionDirectory, {
  upsert: () => Effect.void,
  getProvider: () =>
    Effect.die(new Error("ProviderSessionDirectory.getProvider is not used by replayCodex")),
  getBinding: () => Effect.succeed(Option.none()),
  listThreadIds: () => Effect.succeed([]),
  listBindings: () => Effect.succeed([]),
});

/**
 * Minimal from-scratch equivalent of CodexAdapter.test.ts's FakeCodexRuntime
 * (not exported from that .test.ts file). Implements just enough of
 * `CodexSessionRuntimeShape` for `makeCodexAdapter` to run against: an
 * `events` stream the adapter subscribes to and maps, fed by `emit`.
 */
class ReplayCodexRuntime implements CodexSessionRuntimeShape {
  private readonly eventQueue = Effect.runSync(Queue.unbounded<ProviderEvent>());

  start(): Effect.Effect<ProviderSession> {
    return Effect.succeed({
      provider: ProviderDriverKind.make("codex"),
      status: "ready",
      runtimeMode: "full-access",
      threadId: REPLAY_THREAD_ID,
      cwd: process.cwd(),
      createdAt: REPLAY_NOW,
      updatedAt: REPLAY_NOW,
    } satisfies ProviderSession);
  }

  get getSession(): Effect.Effect<ProviderSession> {
    return this.start();
  }

  sendTurn(): Effect.Effect<ProviderTurnStartResult> {
    return Effect.succeed({ threadId: REPLAY_THREAD_ID, turnId: TurnId.make("spi-replay-turn") });
  }

  interruptTurn(): Effect.Effect<void> {
    return Effect.void;
  }

  get compactThread(): Effect.Effect<void> {
    return Effect.void;
  }

  get readThread(): Effect.Effect<CodexThreadSnapshot> {
    return Effect.succeed({ threadId: "spi-replay-thread", turns: [] });
  }

  rollbackThread(): Effect.Effect<CodexThreadSnapshot> {
    return Effect.succeed({ threadId: "spi-replay-thread", turns: [] });
  }

  uploadFeedback() {
    return Effect.die(new Error("ReplayCodexRuntime.uploadFeedback is not used by replayCodex"));
  }

  respondToRequest(
    _requestId: ApprovalRequestId,
    _decision: ProviderApprovalDecision,
  ): Effect.Effect<void> {
    return Effect.void;
  }

  respondToUserInput(
    _requestId: ApprovalRequestId,
    _answers: ProviderUserInputAnswers,
  ): Effect.Effect<void> {
    return Effect.void;
  }

  get events(): Stream.Stream<ProviderEvent, never> {
    return Stream.fromQueue(this.eventQueue);
  }

  get close(): Effect.Effect<void> {
    return Effect.void;
  }

  emit(event: ProviderEvent): Effect.Effect<void> {
    return Queue.offer(this.eventQueue, event).pipe(Effect.asVoid);
  }
}

interface WireNotification {
  readonly method: string;
  readonly params: Record<string, unknown>;
}

function threadIdFromParams(params: Record<string, unknown>): string | undefined {
  const thread = params.thread;
  if (
    typeof thread === "object" &&
    thread !== null &&
    typeof (thread as { id?: unknown }).id === "string"
  ) {
    return (thread as { id: string }).id;
  }
  return typeof params.threadId === "string" ? params.threadId : undefined;
}

function turnIdFromParams(params: Record<string, unknown>): string | undefined {
  if (typeof params.turnId === "string") return params.turnId;
  const turn = params.turn;
  if (
    typeof turn === "object" &&
    turn !== null &&
    typeof (turn as { id?: unknown }).id === "string"
  ) {
    return (turn as { id: string }).id;
  }
  return undefined;
}

function itemIdFromParams(params: Record<string, unknown>): string | undefined {
  const item = params.item;
  if (
    typeof item === "object" &&
    item !== null &&
    typeof (item as { id?: unknown }).id === "string"
  ) {
    return (item as { id: string }).id;
  }
  return undefined;
}

/** Converts one fixture `message` line (a real captured `{method,params}` notification) into a `ProviderEvent`. */
function wireNotificationToProviderEvent(
  notification: WireNotification,
  index: number,
): ProviderEvent {
  const threadId = threadIdFromParams(notification.params) ?? String(REPLAY_THREAD_ID);
  const turnId = turnIdFromParams(notification.params);
  const itemId = itemIdFromParams(notification.params);

  return {
    id: EventId.make(`wire-${index}`),
    kind: "notification",
    provider: ProviderDriverKind.make("codex"),
    threadId: ThreadId.make(threadId),
    createdAt: REPLAY_NOW,
    method: notification.method,
    ...(turnId ? { turnId: TurnId.make(turnId) } : {}),
    ...(itemId ? { itemId: ProviderItemId.make(itemId) } : {}),
    payload: notification.params,
  };
}

/**
 * Runs a fixture's `message` lines (raw Codex wire notifications) through
 * the real adapter's mapping pipeline and returns every emitted
 * `SpiEvent`, in order.
 */
export async function replayCodex(fixture: Fixture): Promise<ReadonlyArray<SpiEvent>> {
  const codexConfig = decodeCodexSettings({});
  const runtime = new ReplayCodexRuntime();

  const program = Effect.gen(function* () {
    const adapter = yield* makeCodexAdapter(codexConfig, {
      makeRuntime: () => Effect.succeed(runtime),
    });

    const events: Array<SpiEvent> = [];
    yield* Stream.runForEach(adapter.streamEvents, (event) =>
      Effect.sync(() => {
        events.push(event);
      }),
    ).pipe(Effect.forkScoped);

    yield* adapter.startSession({
      threadId: REPLAY_THREAD_ID,
      provider: ProviderDriverKind.make("codex"),
      runtimeMode: "full-access",
    });
    // Let session-started/configured events (and their forked event fiber)
    // settle before feeding wire notifications.
    yield* Effect.yieldNow;

    const notifications = fixture.lines
      .filter((line) => line.kind === "message")
      .map((line) => line.message as WireNotification);

    for (const [index, notification] of notifications.entries()) {
      yield* runtime.emit(wireNotificationToProviderEvent(notification, index));
      // mapToRuntimeEvents is synchronous CPU work wrapped in a single-fiber
      // Effect.gen; yielding lets the queue consumer fiber drain each
      // notification before the next is offered, keeping output order
      // faithful to arrival order.
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
    }

    yield* Effect.yieldNow;
    yield* Effect.yieldNow;

    return events;
  });

  const testLayer = Layer.mergeAll(
    ServerConfig.layerTest(process.cwd(), process.cwd()),
    ServerSettingsService.layerTest(),
    providerSessionDirectoryTestLayer,
  ).pipe(Layer.provideMerge(NodeServices.layer));

  return Effect.runPromise(Effect.scoped(program).pipe(Effect.provide(testLayer)));
}
