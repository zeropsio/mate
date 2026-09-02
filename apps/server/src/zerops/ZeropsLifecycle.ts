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
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
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

import {
  ZeropsThreadLifecycleRepository,
  type ZeropsThreadLifecycleRow,
} from "../persistence/ZeropsThreadLifecycle.ts";
import { ProviderRuntimeEventBus } from "../spi/ProviderRuntimeEventBus.ts";
import { subscribeBeforeSnapshot } from "../utils/subscribeBeforeSnapshot.ts";
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

export interface ZeropsLifecycleOptions {
  readonly toolEvents: Stream.Stream<SpiEvent>;
  readonly repository: ZeropsThreadLifecycleRepository["Service"];
}

export const make = (options: ZeropsLifecycleOptions) =>
  Effect.gen(function* () {
    const { toolEvents, repository } = options;
    const changes = yield* PubSub.sliding<ZeropsLifecycleState>(32);
    const subscribeMutex = yield* Semaphore.make(1);
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

    const load = (threadId: ThreadId): Effect.Effect<ZeropsLifecycleState> =>
      Effect.gen(function* () {
        const cached = (yield* Ref.get(cache)).get(threadId);
        if (cached !== undefined) {
          return cached;
        }
        // A read failure is not worth propagating: the client's fallback is one
        // `zerops_workflow action="status"` call, which is the same recovery
        // path a compacted thread already takes.
        const stored = yield* repository.getByThreadId(threadId).pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("Could not read stored Zerops lifecycle state", {
              threadId,
              cause,
            }).pipe(Effect.as(Option.none<ZeropsThreadLifecycleRow>())),
          ),
        );
        const state = Option.match(stored, {
          onNone: () => emptyState(threadId),
          onSome: fromRow,
        });
        yield* Ref.update(cache, (current) => new Map(current).set(threadId, state));
        return state;
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
          yield* PubSub.publish(changes, next);
        }),
      );

    yield* toolEvents.pipe(
      Stream.runForEach(ingest),
      Effect.catchCause(() => Effect.void),
      Effect.forkScoped,
    );

    return {
      get: load,
      subscribe: (threadId) =>
        subscribeBeforeSnapshot(changes, load(threadId), subscribeMutex).pipe(
          Effect.map(({ latest, changes: allChanges }) => ({
            latest,
            changes: Stream.filter(allChanges, (state) => state.threadId === threadId),
          })),
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
