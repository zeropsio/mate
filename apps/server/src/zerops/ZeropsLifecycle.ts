/**
 * The lifecycle feed: where each thread's agent is, reduced from what its tools
 * already report.
 *
 * There is no lifecycle state machine here and there must not be one — the
 * `workflow.StateEnvelope` zcp computes IS the state, and this reducer only
 * carries it across. Nothing reads `.zcp/state`, and nothing calls the Zerops
 * API for lifecycle.
 *
 * Two things are recorded per thread:
 *
 * - **the latest envelope**, from every tool that carries one — through either
 *   carrier, the trailing fenced block on a prose result or the top-level
 *   `envelope` key on a JSON one (zcp `docs/spec-mate.md` §1). Latest wins; a
 *   result with no readable envelope leaves the previous one alone.
 * - **the recent `zerops_*` tool calls**, from ALL of them, carrier or not.
 *   The envelope says where the agent IS; it cannot say what is happening right
 *   now. A tool that has started and not finished has no result to carry an
 *   envelope, a failed one carries none by design, and the strip still has to
 *   read "deploying". A log, not a state machine.
 */
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

import {
  ZEROPS_RECENT_TOOLS_LIMIT,
  ZeropsRecentTool,
  ZeropsStateEnvelope,
  type SpiEvent,
  type ThreadId,
  type ZeropsLifecycle as ZeropsLifecycleState,
} from "@t3tools/contracts";

import type { ProjectionRepositoryError } from "../persistence/Errors.ts";
import {
  ZeropsThreadLifecycleRepository,
  type ZeropsThreadLifecycleRow,
} from "../persistence/ZeropsThreadLifecycle.ts";
import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import { extractZeropsEnvelope } from "./zeropsEnvelope.ts";
import { readZeropsToolCall } from "./zeropsToolResult.ts";

export class ZeropsLifecycle extends Context.Service<
  ZeropsLifecycle,
  {
    readonly get: (threadId: ThreadId) => Effect.Effect<ZeropsLifecycleState>;
    readonly subscribe: (threadId: ThreadId) => Effect.Effect<
      {
        readonly latest: ZeropsLifecycleState;
        readonly changes: Stream.Stream<ZeropsLifecycleState>;
      },
      never,
      Scope.Scope
    >;
    /**
     * Folds one provider runtime event in. The background subscription is a
     * thin adapter over this, so a caller (or a test) can drive the reducer
     * directly and know when it has settled.
     */
    readonly ingest: (event: SpiEvent) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsLifecycle") {}

const decodeEnvelope = Schema.decodeUnknownOption(ZeropsStateEnvelope);
const decodeRecentTools = Schema.decodeUnknownOption(Schema.Array(ZeropsRecentTool));
const encodeRecentTools = Schema.encodeUnknownOption(Schema.Array(ZeropsRecentTool));
const encodeEnvelope = Schema.encodeUnknownOption(ZeropsStateEnvelope);

const emptyState = (threadId: ThreadId): ZeropsLifecycleState => ({
  threadId,
  recentTools: [],
});

/**
 * Appends a tool call, or updates the entry a matching `item.started` left
 * behind so a long deploy shows as one entry that changes status rather than
 * two rows.
 */
const withRecentTool = (
  recentTools: ReadonlyArray<ZeropsRecentTool>,
  entry: ZeropsRecentTool,
): ReadonlyArray<ZeropsRecentTool> => {
  const index =
    entry.itemId === undefined
      ? -1
      : recentTools.findLastIndex((tool) => tool.itemId === entry.itemId);
  const next =
    index < 0
      ? [...recentTools, entry]
      : recentTools.map((tool, position) => (position === index ? entry : tool));
  return next.slice(-ZEROPS_RECENT_TOOLS_LIMIT);
};

const INGEST_RESTART_FIRST = Duration.seconds(1);
/** The longest wait between two restarts, and the run length that counts as healthy. */
const INGEST_RESTART_CAP = Duration.seconds(30);

export interface ZeropsLifecycleOptions {
  readonly toolEvents: Stream.Stream<SpiEvent>;
  readonly repository: ZeropsThreadLifecycleRepository["Service"];
}

export const make = (options: ZeropsLifecycleOptions) =>
  Effect.gen(function* () {
    const { toolEvents, repository } = options;
    const channels = yield* Ref.make(new Map<ThreadId, PubSub.PubSub<ZeropsLifecycleState>>());
    const writeMutex = yield* Semaphore.make(1);
    const cache = yield* Ref.make(new Map<ThreadId, ZeropsLifecycleState>());

    /** Reads a stored row tolerantly: anything unreadable degrades to "nothing yet". */
    const fromRow = (row: ZeropsThreadLifecycleRow): ZeropsLifecycleState => ({
      threadId: row.threadId,
      ...(row.envelope === null
        ? {}
        : Option.match(decodeEnvelope(row.envelope), {
            onNone: () => ({}),
            onSome: (envelope) => ({ envelope }),
          })),
      recentTools: Option.getOrElse(
        decodeRecentTools(row.recentTools),
        () => [] as ReadonlyArray<ZeropsRecentTool>,
      ),
      updatedAt: DateTime.makeUnsafe(row.updatedAt),
    });

    /**
     * The thread's state, read from the store on first use. Only a successful
     * read is cached: a failed one says nothing about the row, so nothing may
     * be built on it.
     */
    const load = (
      threadId: ThreadId,
    ): Effect.Effect<ZeropsLifecycleState, ProjectionRepositoryError> =>
      Effect.gen(function* () {
        const cached = (yield* Ref.get(cache)).get(threadId);
        if (cached !== undefined) {
          return cached;
        }
        const stored = yield* repository.getByThreadId(threadId);
        const state = Option.match(stored, {
          onNone: () => emptyState(threadId),
          onSome: fromRow,
        });
        yield* Ref.update(cache, (current) => new Map(current).set(threadId, state));
        return state;
      });

    // A read failure is not worth propagating to a reader: the client's
    // fallback is one `zerops_workflow action="status"` call, which is the same
    // recovery path a compacted thread already takes.
    const loadOrEmpty = (threadId: ThreadId): Effect.Effect<ZeropsLifecycleState> =>
      load(threadId).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("Could not read stored Zerops lifecycle state", {
            threadId,
            cause,
          }).pipe(Effect.as(emptyState(threadId))),
        ),
      );

    /**
     * One channel per thread, so no other thread's traffic can push a thread's
     * latest state out of a subscriber's buffer. Each state is complete, so a
     * subscriber needs only the newest one it has not read yet.
     */
    const channel = (threadId: ThreadId) =>
      Effect.gen(function* () {
        const existing = (yield* Ref.get(channels)).get(threadId);
        if (existing !== undefined) {
          return existing;
        }
        const created = yield* PubSub.sliding<ZeropsLifecycleState>(1);
        yield* Ref.update(channels, (current) => new Map(current).set(threadId, created));
        return created;
      });

    const persist = (state: ZeropsLifecycleState, at: DateTime.Utc) =>
      repository
        .upsert({
          threadId: state.threadId,
          envelope:
            state.envelope === undefined
              ? null
              : Option.getOrElse(encodeEnvelope(state.envelope), () => null),
          recentTools: Option.getOrElse(encodeRecentTools(state.recentTools), () => [] as unknown),
          updatedAt: DateTime.formatIso(at),
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not persist Zerops lifecycle state", {
              threadId: state.threadId,
              cause,
            }),
          ),
        );

    // A state folded over an unread row would be persisted over it and drop
    // its envelope, so an event that cannot be read against its thread's
    // state is dropped instead; the next one reads again. Any other failure
    // or defect in the fold drops its event the same way: one bad event must
    // not stop the ingest for every other thread.
    const ingest = (event: SpiEvent): Effect.Effect<void> =>
      writeMutex.withPermits(1)(
        Effect.gen(function* () {
          if (event.type !== "item.started" && event.type !== "item.completed") {
            return;
          }
          const call = readZeropsToolCall(event);
          if (call === undefined) {
            return;
          }

          const previous = yield* load(event.threadId);
          const at = yield* DateTime.now;
          const resultText = call.result?.text;
          const failed = call.result?.failed === true;
          const envelope =
            resultText === undefined || failed ? undefined : extractZeropsEnvelope(resultText);

          const next: ZeropsLifecycleState = {
            threadId: event.threadId,
            // A result with no readable envelope leaves the previous one
            // standing. Clearing it, or reaching back to an older block, would
            // move the strip backwards over a corrupt payload.
            ...(envelope === undefined
              ? previous.envelope === undefined
                ? {}
                : { envelope: previous.envelope }
              : { envelope }),
            recentTools: withRecentTool(previous.recentTools, {
              toolName: call.name,
              status:
                event.type === "item.started" ? "inProgress" : failed ? "failed" : "completed",
              at,
              ...(event.itemId === undefined ? {} : { itemId: event.itemId }),
            }),
            updatedAt: at,
          };

          yield* Ref.update(cache, (current) => new Map(current).set(next.threadId, next));
          yield* persist(next, at);
          yield* PubSub.publish(yield* channel(next.threadId), next);
        }).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Dropped a Zerops lifecycle event", {
              threadId: event.threadId,
              cause,
            }),
          ),
        ),
      );

    // The ingest is the feed's only writer, so it must not end quietly: a
    // failure of the event stream itself is logged and the stream
    // resubscribed, backing off to one attempt every 30 s. A run that lasted
    // longer than that was healthy, so the failure that ended it starts the
    // backoff from the first rung again.
    yield* Effect.gen(function* () {
      let delay = INGEST_RESTART_FIRST;
      while (true) {
        const startedAt = yield* Clock.currentTimeMillis;
        const exit = yield* Effect.exit(Stream.runForEach(toolEvents, ingest));
        if (Exit.isSuccess(exit)) {
          return;
        }
        const ranFor = Duration.millis((yield* Clock.currentTimeMillis) - startedAt);
        if (Duration.isGreaterThan(ranFor, INGEST_RESTART_CAP)) {
          delay = INGEST_RESTART_FIRST;
        }
        yield* Effect.logError("Zerops lifecycle ingest failed; restarting it", {
          cause: exit.cause,
        });
        yield* Effect.sleep(delay);
        delay = Duration.min(Duration.times(delay, 2), INGEST_RESTART_CAP);
      }
    }).pipe(Effect.forkScoped);

    return {
      get: (threadId) => writeMutex.withPermits(1)(loadOrEmpty(threadId)),
      // Under the write mutex no update can land between the subscription and
      // the snapshot, so a subscriber misses nothing and sees nothing twice.
      subscribe: (threadId) =>
        writeMutex.withPermits(1)(
          Effect.gen(function* () {
            const subscription = yield* PubSub.subscribe(yield* channel(threadId));
            const latest = yield* loadOrEmpty(threadId);
            return { latest, changes: Stream.fromSubscription(subscription) };
          }),
        ),
      ingest,
    } satisfies ZeropsLifecycle["Service"];
  });

export const layer = Layer.effect(
  ZeropsLifecycle,
  Effect.gen(function* () {
    const bus = yield* ProviderRuntimeEventBus;
    const repository = yield* ZeropsThreadLifecycleRepository;
    return yield* make({ toolEvents: bus.events, repository });
  }),
);
