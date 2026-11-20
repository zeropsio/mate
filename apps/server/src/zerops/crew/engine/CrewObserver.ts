/**
 * The crew's eyes on the engine: a cursor over each conversation's durable record, never the
 * volatile provider bus.
 *
 * - **Each crewmate's conversation and the Mate's own.** When a conversation's record moves
 *   (`MateEngine.changes`), the observer reads its events after the crew's cursor, a page at a
 *   time, and tells the crew `Observed` only for a page that holds an event the crew reads
 *   (`crewReads`): the range from the crew's cursor to the page's end, with those events; the
 *   crew's step folds them and stores the new cursor in the same transaction, so each event is
 *   handled once, and again after a restart only if its step never committed. A page with nothing
 *   the crew reads is not told; the next told range covers it. At start every crewmate's
 *   conversation and every conversation the engine lists is caught up.
 * - **A deploy** the Mate's conversation shows (`zerops_deploy` onto a service, a dev server moved
 *   onto its supervisor) is an event the crew reads: it is folded with the cursor that passes it,
 *   and the crew freezes a host once.
 * - **Gauges**, the two reads off the record: a login's fullest usage window, from its instance's
 *   snapshot (`Gauge`, `planUsage.ts`), and a sign-in or signer that moved (`LoginsChanged`). A
 *   missed gauge is replaced by the next one.
 * - **A process Zerops pushed** (or its socket's (re)connect) while a host is frozen is told as
 *   `ProcessesMoved`, and once when the observer subscribes, for what came before: the crew
 *   reads the frozen host's redeploy then, never on a timer.
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
import { crewReads } from "./decide.observed.ts";
import { frozenHosts, membersInOrder, type CrewState } from "./state.ts";

/** An input the crew did not take in: its step refused it or never committed. */
export class CrewInputUnrecorded extends Data.TaggedError("CrewInputUnrecorded")<{
  readonly detail: string;
}> {}

/** How long a catch-up that failed waits before it reads again: doubling, at most 30 s. */
const catchUpRetryMs = (failures: number): number =>
  Math.min(30_000, 500 * 2 ** Math.max(0, failures - 1));

/** Events read per page of a conversation's record. */
const OBSERVE_PAGE = 200;

export interface CrewGaugeReading {
  readonly login: string;
  readonly usagePercent: number | null;
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
  /** The project's processes moved (`CrewPlatformProcesses.moved`), subscribed when it runs. */
  readonly processes: Effect.Effect<Stream.Stream<void>, never, Scope.Scope>;
}

/**
 * Runs the observer in the caller's scope. Catch-ups run one conversation at a time on one fiber,
 * in the order their changes came.
 */
export const observeCrew = (inputs: CrewObserverInputs): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    const pending = yield* Queue.unbounded<ConversationId>();
    const queued = new Set<string>();
    /**
     * How far this process read each conversation past the crew's cursor, every event after the
     * cursor up to there holding nothing the crew reads by the rules it was read under. Nothing
     * owns that fact durably: a restart reads again from the crew's cursor, at most up to the
     * events since a run's last admission or end, which the crew always reads.
     */
    const unread = new Map<string, { readonly crewmate: boolean; readonly upTo: number }>();
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
        // The range told next starts at the crew's own cursor each time: what it never took in is
        // told again. Reading goes on from what this process found holds nothing for the crew.
        let cursor = state.cursors[conversationId] ?? 0;
        const skipped = unread.get(conversationId);
        let readUpTo =
          skipped !== undefined && skipped.crewmate === crewmate
            ? Math.max(cursor, skipped.upTo)
            : cursor;
        for (;;) {
          const page = yield* inputs.eventsAfter(conversationId, readUpTo, OBSERVE_PAGE);
          const events = page as ReadonlyArray<KnownEngineEvent>;
          if (events.length === 0) break;
          const upTo = events.at(-1)!.seq;
          const read = events.filter((event) => crewReads(event, crewmate));
          if (read.length > 0) {
            yield* inputs.tell(
              { _tag: "Observed", conversationId, from: cursor + 1, upTo, events: read },
              `observe:${conversationId}:${upTo}`,
            );
            cursor = upTo;
          }
          readUpTo = upTo;
          unread.set(conversationId, { crewmate, upTo });
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
    let moves = 0;
    const moved = Effect.gen(function* () {
      if (frozenHosts(yield* inputs.crewState).length === 0) return;
      const now = yield* Clock.currentTimeMillis;
      yield* inputs
        .tell({ _tag: "ProcessesMoved" }, `processes:${(moves += 1)}:${now}`)
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("crew: a process move was not taken in", cause),
          ),
        );
    });
    // Subscribed before the first tell, so nothing between the two is missed.
    const processes = yield* inputs.processes;
    yield* moved;
    yield* processes.pipe(
      Stream.runForEach(() => moved),
      Effect.forkScoped,
    );
  });
