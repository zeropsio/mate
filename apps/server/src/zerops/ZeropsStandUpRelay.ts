/**
 * ZeropsStandUpRelay — a stand-up's progress, live on its run card.
 *
 * zcp's `zerops_standup` builds, deploys and verifies every service of the
 * tier for minutes, and its own progress never reaches the card: the Claude
 * CLI's headless stream drops MCP progress notifications. zcp writes the same
 * progress into its status file (`ZCP_STATUS_FILE`, its `standup` section), so
 * while a stand-up call runs this reads that section and relays every change
 * as the call's progress: one `tool.progress` activity per call, under one
 * stable id, so it is updated in place and a reload shows where it got.
 *
 * Compatibility: no new event type and no new shell field. The activity rides
 * `thread.activity-appended`, which every client already takes, its progress
 * at the payload's top level (`zeropsStandUp`, beside `toolCallId`) where the
 * slimming of tool data never reaches. An older client drops every
 * `tool.progress` row from its work log and reads only an agent's own
 * heartbeat off the kind (a `taskId` this never carries), so it shows nothing
 * new and nothing twice.
 *
 * @module ZeropsStandUpRelay
 */
import {
  CommandId,
  EventId,
  ThreadId,
  type OrchestrationThreadActivity,
  type SpiEvent,
  type TurnId,
} from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import { ZeropsSetup } from "./ZeropsSetup.ts";
import type { ZcpStatus } from "./zeropsSetupSteps.ts";

/** The stand-up tool, as the event's tool call names it (its `mcp__…__` prefix stripped). */
export const STAND_UP_TOOL_NAME = "zerops_standup";

/** How often the status file is read while a stand-up call runs. */
export const STAND_UP_RELAY_INTERVAL = Duration.seconds(2);

/** The longest a call is followed: past zcp's own limit for a stand-up. */
export const STAND_UP_RELAY_LIMIT = Duration.hours(2);

/** A section a call started before is the previous call's: this much clock skew is forgiven. */
const SECTION_SKEW_MS = 5_000;

/** A service's error, cut: a card line, not a log. */
const MAX_ERROR_LENGTH = 300;

/** What the card reads: `payload.zeropsStandUp`. */
export interface StandUpProgress {
  readonly phase: string;
  readonly state: string;
  readonly services: ReadonlyArray<{
    readonly hostname: string;
    readonly step: string;
    readonly state: string;
    readonly processId: string;
    readonly at: string;
    readonly error?: string;
  }>;
}

/**
 * The stand-up section as this call's progress, or `undefined` while it is
 * none of this call's: absent, idle, or started before the call did (the
 * previous call's, until zcp writes this one's).
 */
export const standUpProgressOf = (
  status: ZcpStatus | undefined,
  callStartedAt: string,
): StandUpProgress | undefined => {
  const section = status?.standup;
  if (section === undefined || section.state === undefined || section.state === "idle") {
    return undefined;
  }
  const started = Date.parse(section.startedAt);
  const callStarted = Date.parse(callStartedAt);
  if (!Number.isFinite(started) || started < callStarted - SECTION_SKEW_MS) return undefined;
  return {
    phase: section.phase,
    state: section.state,
    services: section.services.map((service) => ({
      hostname: service.hostname,
      step: service.step,
      state: service.state,
      processId: service.processId,
      at: service.at,
      ...(service.error === "" ? {} : { error: service.error.slice(0, MAX_ERROR_LENGTH) }),
    })),
  };
};

/** The call's one progress row: the same id every time, so each write replaces the last. */
export const standUpProgressActivity = (input: {
  readonly threadId: string;
  readonly turnId: TurnId | null;
  readonly toolCallId: string;
  readonly progress: StandUpProgress;
  readonly at: string;
}): OrchestrationThreadActivity => ({
  id: EventId.make(`zerops-standup:${input.threadId}:${input.toolCallId}`),
  createdAt: input.at,
  tone: "info",
  kind: "tool.progress",
  summary: "Stand-up progress",
  payload: { toolCallId: input.toolCallId, zeropsStandUp: input.progress },
  turnId: input.turnId,
});

/** One string per distinct progress: a write only when it moves. */
const progressKey = (progress: StandUpProgress): string =>
  [
    progress.phase,
    progress.state,
    ...progress.services.map((service) =>
      [
        service.hostname,
        service.step,
        service.state,
        service.processId,
        service.at,
        service.error ?? "",
      ].join("\u0000"),
    ),
  ].join("\n");

const isStandUpCall = (event: SpiEvent) =>
  event.toolCall?.name === STAND_UP_TOOL_NAME && event.itemId !== undefined;

export const make = Effect.gen(function* () {
  const bus = yield* ProviderRuntimeEventBus;
  const setup = yield* ZeropsSetup;
  const orchestration = yield* OrchestrationEngineService;
  const crypto = yield* Crypto.Crypto;
  const scope = yield* Effect.scope;
  /** The calls followed now: when each started, what was last written, and its loop. */
  const following = new Map<
    string,
    { readonly startedAt: string; last: string | undefined; fiber?: Fiber.Fiber<void> }
  >();

  /** Writes the call's progress when it changed since the last write. */
  const relayOnce = (
    event: SpiEvent,
    call: { readonly startedAt: string; last: string | undefined },
  ) =>
    Effect.gen(function* () {
      const progress = standUpProgressOf(yield* setup.status, call.startedAt);
      if (progress === undefined) return;
      const written = progressKey(progress);
      if (written === call.last) return;
      const at = DateTime.formatIso(yield* DateTime.now);
      yield* orchestration.dispatch({
        type: "thread.activity.append",
        commandId: CommandId.make(`zerops-standup:${yield* crypto.randomUUIDv4}`),
        threadId: ThreadId.make(event.threadId),
        activity: standUpProgressActivity({
          threadId: event.threadId,
          turnId: event.turnId ?? null,
          toolCallId: event.itemId!,
          progress,
          at,
        }),
        createdAt: at,
      });
      call.last = written;
    }).pipe(Effect.catchCause(() => Effect.void));

  const follow = (
    event: SpiEvent,
    call: { readonly startedAt: string; last: string | undefined },
  ) =>
    relayOnce(event, call).pipe(
      Effect.andThen(Effect.sleep(STAND_UP_RELAY_INTERVAL)),
      Effect.forever,
      Effect.timeout(STAND_UP_RELAY_LIMIT),
      Effect.ignore,
    );

  const handle = (event: SpiEvent) =>
    Effect.gen(function* () {
      if (!isStandUpCall(event)) return;
      const key = `${event.threadId}:${event.itemId}`;
      const followed = following.get(key);
      if (event.type === "item.started" && followed === undefined) {
        const call: {
          readonly startedAt: string;
          last: string | undefined;
          fiber?: Fiber.Fiber<void>;
        } = { startedAt: event.createdAt, last: undefined };
        following.set(key, call);
        call.fiber = yield* Effect.forkIn(follow(event, call), scope);
        return;
      }
      if (event.type === "item.completed" && followed !== undefined) {
        following.delete(key);
        if (followed.fiber !== undefined) yield* Fiber.interrupt(followed.fiber);
        // The call's end: what the file says of it last, once more.
        yield* relayOnce(event, followed);
      }
    });

  yield* Effect.forkScoped(Stream.runForEach(bus.events, handle));
});

export const layer = Layer.effectDiscard(make);
