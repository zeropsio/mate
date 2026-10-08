/**
 * The crew's eyes on the engine: a cursor over each conversation's durable record, never the
 * volatile provider bus.
 *
 * - **Each crewmate's conversation and the Mate's own.** When a conversation's record moves
 *   (`MateEngine.changes`), the observer reads its events after the crew's cursor, a page at a
 *   time, and tells the crew `Observed`; the crew's step stores the new cursor in the same
 *   transaction, so each event is handled once, and again after a restart only if its step never
 *   committed. At start every crewmate's conversation and every conversation the engine lists is
 *   caught up.
 * - **A deploy** the Mate's conversation shows (`zerops_deploy` onto a service) is told as
 *   `Deploy` before the batch that holds it, so a crash between the two tells it again; the crew
 *   freezes a host once.
 * - **Gauges**, the two reads allowed off the bus: a login's fullest usage window (`Gauge`) and a
 *   sign-in or signer that moved (`LoginsChanged`). A missed gauge is replaced by the next one.
 *
 * @module crew/engine/CrewObserver
 */
import * as Clock from "effect/Clock";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import type * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import type { ConversationId, EngineEvent, KnownEngineEvent } from "@t3tools/contracts";

import type { EventsUnreadable } from "../../../engine/MateEngine.ts";
import type { CrewInput } from "./command.ts";
import { membersInOrder, type CrewState } from "./state.ts";

/** An input the crew did not take in: its step refused it or never committed. */
export class CrewInputUnrecorded extends Data.TaggedError("CrewInputUnrecorded")<{
  readonly detail: string;
}> {}

/** How long a catch-up that failed waits before it reads again: doubling, at most 30 s. */
export const catchUpRetryMs = (failures: number): number =>
  Math.min(30_000, 500 * 2 ** Math.max(0, failures - 1));

/** Events read per page of a conversation's record. */
export const OBSERVE_PAGE = 200;

export interface CrewGaugeReading {
  readonly login: string;
  readonly usagePercent: number;
}

export interface CrewObserverInputs {
  /** The conversation whose record moved, each time it does. */
  readonly changes: Stream.Stream<ConversationId>;
  readonly eventsAfter: (
    conversationId: ConversationId,
    afterSeq: number,
    limit?: number,
  ) => Effect.Effect<ReadonlyArray<EngineEvent>, EventsUnreadable>;
  readonly crewState: Effect.Effect<CrewState>;
  /**
   * Tells the crew one input under `commandId`: a repeat is answered by its receipt. It fails when
   * the crew did not take the input in, so its reader never moves past it.
   */
  readonly tell: (input: CrewInput, commandId: string) => Effect.Effect<void, CrewInputUnrecorded>;
  /** The conversations the engine holds besides the crew's: the Mate's own. */
  readonly conversations: Effect.Effect<ReadonlyArray<ConversationId>>;
  readonly gauges: Stream.Stream<CrewGaugeReading>;
  /** Logins whose sign-in or signer moved. */
  readonly signIns: Stream.Stream<ReadonlyArray<string>>;
}

const toolNameOf = (name: string): string => name.replace(/^mcp__[^_]+__/, "");

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The service a `zerops_deploy` call deploys onto, as its row shows its input. */
const deployTarget = (shows: unknown, input: string | undefined): string | undefined => {
  if (isRecord(shows)) {
    const direct = shows.targetService;
    if (typeof direct === "string") return direct;
    const nested = isRecord(shows.input) ? shows.input.targetService : undefined;
    if (typeof nested === "string") return nested;
  }
  const match = input?.match(/targetService["':=\s]+([A-Za-z0-9-]+)/);
  return match?.[1];
};

/** A `zerops_deploy` call's start or end in a conversation's record. */
export const deployOf = (
  event: KnownEngineEvent,
): { readonly itemId: string; readonly host: string; readonly ended: boolean } | undefined => {
  if (event._tag !== "ItemOpened" && event._tag !== "ItemUpdated" && event._tag !== "ItemClosed") {
    return undefined;
  }
  const body = event.body;
  if (body.kind !== "call" || toolNameOf(body.tool.name) !== "zerops_deploy") return undefined;
  const host = deployTarget(body.shows, body.input);
  if (host === undefined) return undefined;
  // A call a restart cut off (`unreturned`, `stopped`) says nothing of the deploy: it may still run.
  if (body.state === "unreturned" || body.state === "stopped") return undefined;
  return { itemId: event.itemId, host, ended: body.state !== "running" };
};

/**
 * Runs the observer in the caller's scope. Catch-ups run one conversation at a time on one fiber,
 * in the order their changes came.
 */
export const observeCrew = (inputs: CrewObserverInputs): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const pending = yield* Queue.unbounded<ConversationId>();
    const queued = new Set<string>();
    /** Deploys told started, by item: one start each, then one end. */
    const deploying = new Set<string>();
    const enqueue = (conversationId: ConversationId) =>
      queued.has(conversationId)
        ? Effect.void
        : Effect.sync(() => queued.add(conversationId)).pipe(
            Effect.andThen(Queue.offer(pending, conversationId)),
            Effect.asVoid,
          );

    const scope = yield* Effect.scope;
    /** Catch-ups that failed in a row, by conversation: the next waits the longer. */
    const failures = new Map<string, number>();

    const catchUp = (conversationId: ConversationId) =>
      Effect.gen(function* () {
        const state = yield* inputs.crewState;
        const crewmate = membersInOrder(state).some(
          (member) => member.conversationId === conversationId,
        );
        // From the crew's own cursor each time: what it never took in is read again.
        let cursor = state.cursors[conversationId] ?? 0;
        for (;;) {
          const page = yield* inputs.eventsAfter(conversationId, cursor, OBSERVE_PAGE);
          const events = page as ReadonlyArray<KnownEngineEvent>;
          if (events.length === 0) break;
          if (!crewmate) {
            for (const event of events) {
              const deploy = deployOf(event);
              if (deploy === undefined) continue;
              if (!deploy.ended && !deploying.has(deploy.itemId)) {
                yield* inputs.tell(
                  { _tag: "Deploy", host: deploy.host, phase: "started" },
                  `deploy:${deploy.itemId}:started`,
                );
                deploying.add(deploy.itemId);
              } else if (deploy.ended) {
                yield* inputs.tell(
                  { _tag: "Deploy", host: deploy.host, phase: "ended" },
                  `deploy:${deploy.itemId}:ended`,
                );
                deploying.delete(deploy.itemId);
              }
            }
          }
          const toSeq = events.at(-1)!.seq;
          yield* inputs.tell(
            { _tag: "Observed", conversationId, events },
            `observe:${conversationId}:${toSeq}`,
          );
          cursor = toSeq;
          if (events.length < OBSERVE_PAGE) break;
        }
        failures.delete(conversationId);
      }).pipe(
        // A read or a step that failed stops this catch-up where the crew's cursor stands; the
        // conversation is read again after a wait, whether or not its record moves meanwhile.
        Effect.catchCause((cause) =>
          Effect.gen(function* () {
            const failed = (failures.get(conversationId) ?? 0) + 1;
            failures.set(conversationId, failed);
            yield* Effect.logWarning("crew: a conversation's record was not taken in", cause);
            yield* Effect.sleep(catchUpRetryMs(failed)).pipe(
              Effect.andThen(enqueue(conversationId)),
              Effect.forkIn(scope),
            );
          }),
        ),
      );

    // Subscribed before the first catch-up, so no change between the two is missed.
    yield* inputs.changes.pipe(Stream.runForEach(enqueue), Effect.forkScoped);
    yield* Queue.take(pending).pipe(
      Effect.tap((conversationId) => Effect.sync(() => queued.delete(conversationId))),
      Effect.flatMap(catchUp),
      Effect.forever,
      Effect.forkScoped,
    );
    const state = yield* inputs.crewState;
    for (const member of membersInOrder(state)) yield* enqueue(member.conversationId);
    for (const conversationId of yield* inputs.conversations) yield* enqueue(conversationId);

    let gauges = 0;
    yield* inputs.gauges.pipe(
      Stream.runForEach((reading) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          inputs
            .tell(
              { _tag: "Gauge", login: reading.login, usagePercent: reading.usagePercent },
              `gauge:${reading.login}:${(gauges += 1)}:${now}`,
            )
            // A missed gauge is replaced by the next one.
            .pipe(Effect.ignore),
        ),
      ),
      Effect.forkScoped,
    );
    let signIns = 0;
    yield* inputs.signIns.pipe(
      Stream.filter((logins) => logins.length > 0),
      Stream.runForEach((logins) =>
        Effect.flatMap(Clock.currentTimeMillis, (now) =>
          inputs
            .tell({ _tag: "LoginsChanged", logins }, `logins:${(signIns += 1)}:${now}`)
            .pipe(
              Effect.catchCause((cause) =>
                Effect.logWarning("crew: a sign-in change was not taken in", cause),
              ),
            ),
        ),
      ),
      Effect.forkScoped,
    );
  });
