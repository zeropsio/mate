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
 * While the Mate engine owns the conversation, the progress goes live on the call's item in the
 * engine's record (`MateEngine.callProgress`), never stored: the call's result is what it keeps.
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
import { completionReceipt } from "@t3tools/shared/completionReceipt";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import { MateEngine } from "../engine/MateEngine.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import { ZeropsSetup } from "./ZeropsSetup.ts";
import { SECTION_SKEW_MS, type ZcpStatus } from "./zeropsSetupSteps.ts";

/** The stand-up tool, as the event's tool call names it (its `mcp__…__` prefix stripped). */
export const STAND_UP_TOOL_NAME = "zerops_standup";

/** How often the status file is read while a stand-up call runs. */
export const STAND_UP_RELAY_INTERVAL = Duration.seconds(2);

/** The longest a call is followed: past zcp's own limit for a stand-up. */
export const STAND_UP_RELAY_LIMIT = Duration.hours(2);

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
 * none of this call's: absent, idle, or run by a call that began before this
 * one did (the previous call's, until zcp writes this one's). A section is
 * matched by the start of the call now running it — a stage call's, for the
 * section its first call left waiting — else, from a zcp that stamps none,
 * by its own start.
 */
export const standUpProgressOf = (
  status: ZcpStatus | undefined,
  callStartedAt: string,
): StandUpProgress | undefined => {
  const section = status?.standup;
  if (section === undefined || section.state === undefined || section.state === "idle") {
    return undefined;
  }
  const started = Date.parse(section.callStartedAt);
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

export class ZeropsStandUpRelay extends Context.Service<
  ZeropsStandUpRelay,
  {
    readonly nextPass: Effect.Effect<void>;
    readonly finished: Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsStandUpRelay") {}

export const make = Effect.gen(function* () {
  const bus = yield* ProviderRuntimeEventBus;
  const setup = yield* ZeropsSetup;
  const orchestration = yield* OrchestrationEngineService;
  const engine = yield* MateEngine;
  const crypto = yield* Crypto.Crypto;
  const scope = yield* Effect.scope;
  /**
   * The one call followed per thread — its newest stand-up call: its id, when
   * it started, what was last written, and its loop. A newer call in the
   * thread (a retry of one that died without an end) or the thread's deletion
   * ends it, so a dead call is never followed on and a retry's progress never
   * lands on its card.
   */
  const following = new Map<
    string,
    {
      readonly callId: string;
      readonly startedAt: string;
      last: string | undefined;
      fiber?: Fiber.Fiber<void>;
    }
  >();

  const unfollow = (threadId: string) =>
    Effect.gen(function* () {
      const followed = following.get(threadId);
      following.delete(threadId);
      if (followed?.fiber !== undefined) yield* Fiber.interrupt(followed.fiber);
    });

  /**
   * Writes the call's progress when it changed since the last write; whether
   * the stand-up's MCP process is provably gone, which leaves the last write.
   * Only this call's section is judged: until zcp writes it, the file holds
   * the previous call's, whose process may be gone without this one's being.
   */
  const passes = completionReceipt();
  const relayOnce = (
    event: SpiEvent,
    call: { readonly startedAt: string; last: string | undefined },
  ) =>
    Effect.gen(function* () {
      const status = yield* setup.status;
      const progress = standUpProgressOf(status, call.startedAt);
      if (progress === undefined) return false;
      if (yield* setup.standUpGone(status)) return true;
      const written = progressKey(progress);
      if (written === call.last) return false;
      // On the engine the progress is live on the call's item, never stored: the call's
      // own result is what the record keeps.
      if (engine.live) {
        yield* engine.callProgress(event.threadId, STAND_UP_TOOL_NAME, progress);
        call.last = written;
        return false;
      }
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
      return false;
    }).pipe(
      Effect.catchCause(() => Effect.succeed(false)),
      Effect.ensuring(passes.complete),
    );

  const follow = (
    event: SpiEvent,
    call: { readonly startedAt: string; last: string | undefined },
  ) =>
    Effect.gen(function* () {
      while (!(yield* relayOnce(event, call))) yield* Effect.sleep(STAND_UP_RELAY_INTERVAL);
    }).pipe(Effect.timeout(STAND_UP_RELAY_LIMIT), Effect.ignore);

  /** Each thread's call that last ended: a late update of it is no new call. */
  const ended = new Map<string, string>();

  const handle = (event: SpiEvent) =>
    Effect.gen(function* () {
      if (!isStandUpCall(event)) return;
      const followed = following.get(event.threadId);
      const same = followed?.callId === event.itemId;
      // A call starts at its start — or, from an ACP agent, which sends none,
      // at its first update.
      const begins =
        event.type === "item.started" ||
        (event.type === "item.updated" && ended.get(event.threadId) !== event.itemId);
      if (begins && !same) {
        yield* unfollow(event.threadId);
        const call: {
          readonly callId: string;
          readonly startedAt: string;
          last: string | undefined;
          fiber?: Fiber.Fiber<void>;
        } = { callId: event.itemId!, startedAt: event.createdAt, last: undefined };
        following.set(event.threadId, call);
        yield* setup.noteStandUpCall({
          threadId: event.threadId,
          turnId: event.turnId ?? undefined,
          startedAt: event.createdAt,
        });
        call.fiber = yield* Effect.forkIn(follow(event, call), scope);
        return;
      }
      if (event.type === "item.completed" && followed !== undefined && same) {
        ended.set(event.threadId, event.itemId!);
        yield* unfollow(event.threadId);
        // The call's end: what the file says of it last, once more.
        yield* relayOnce(event, followed);
        // Its result is in the record now: what was live of it goes.
        if (engine.live) yield* engine.callProgress(event.threadId, STAND_UP_TOOL_NAME, null);
      }
    });

  yield* Effect.forkScoped(Stream.runForEach(bus.events, handle));
  yield* Effect.forkScoped(
    Stream.runForEach(orchestration.streamDomainEvents, (event) =>
      event.type === "thread.deleted"
        ? Effect.sync(() => ended.delete(event.payload.threadId)).pipe(
            Effect.andThen(unfollow(event.payload.threadId)),
          )
        : Effect.void,
    ),
  );
  return {
    nextPass: Effect.suspend(passes.next),
    finished: Effect.suspend(() =>
      Effect.forEach(
        [...following.values()].flatMap((call) => (call.fiber === undefined ? [] : [call.fiber])),
        Fiber.await,
        { discard: true },
      ),
    ),
  };
});

export const layer = Layer.effect(ZeropsStandUpRelay, make);
