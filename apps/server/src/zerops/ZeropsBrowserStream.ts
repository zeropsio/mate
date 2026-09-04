/**
 * The live view of the container's agent-browser daemon (S8b) —
 * `../zcp/docs/spec-mate.md` §5 "Browser surface", §0 touchpoint "the
 * agent-browser daemon's published stream port".
 *
 * zcp learns nothing (§0 rule 3): this reads `~/.agent-browser/default.stream`
 * — a bare localhost port number the daemon itself publishes — fresh on
 * every connect attempt, and writes nothing back to it or to zcp. The daemon
 * socket is localhost-only and unauthenticated by design; it refuses a
 * browser-origin client with 403 (its own CORS-style guard), but accepts the
 * mate server, which — being Node, not a browser — sends no `Origin` header
 * at all. The WebSocket's own scopes (`AuthOrchestrationReadScope` for the
 * subscription, `AuthOrchestrationOperateScope` for input —
 * `apps/server/src/auth/RpcAuthorization.ts`) are the authorization for
 * everyone else.
 *
 * On demand: connects on the FIRST subscriber, disconnects on the LAST
 * unsubscribe — never keeps a browser session alive for the user's sake
 * (spec §0 rule 3). While at least one subscriber remains, a dropped
 * connection (daemon restart, no browser open yet) retries with backoff,
 * re-reading the port file every attempt, so a daemon that comes back on a
 * new port is picked up without restarting mate.
 *
 * ## Wire shapes — agent-browser's own streaming reference
 *
 * Cited from `/usr/lib/node_modules/agent-browser/skill-data/core/references/streaming.md`
 * on the rig, plus a live capture through `?pacing=ack&maxFps=5` (verified.md,
 * 2026-09-04). Server→client, every message JSON with `type`:
 * - `frame`: `{type:"frame", seq, data:"<base64 jpeg>", metadata:{deviceWidth,
 *   deviceHeight, pageScaleFactor, offsetTop, scrollOffsetX, scrollOffsetY,
 *   timestamp}}` — `seq` is monotonic and stable across relaunches; a static
 *   page produces exactly one frame, never a steady stream, so the panel
 *   shows the LAST frame rather than expecting continuous delivery.
 * - `status`: connection/engine/recording/screencasting/viewport info, sent
 *   on connect and on change.
 * - `tabs`: the open tabs, each `{active, label, tabId, targetId, title,
 *   type, url}` — the active one's `url`/`title` is this relay's source for
 *   "what page" (`url` on its own arrives only on navigation).
 * - `console`: page console output — not read here; this slice has no
 *   console surface.
 *
 * Client→daemon, CDP `Input.dispatch*Event` vocabulary verbatim (see
 * `packages/contracts/src/zerops.ts`'s `ZeropsBrowserMouseInput`/
 * `ZeropsBrowserKeyboardInput` doc comments): `input_mouse`/`input_keyboard`/
 * `input_touch` (touch unused — no touch UI in this slice), `config`, `ack`.
 *
 * ## Ack pacing is FORWARDED, never generated on receipt
 *
 * The reference is explicit: "with a proxy in the path, forward the
 * renderer's acks; acks generated on receipt leave frames queued on the far
 * side" — and acks are cumulative. So a frame's `{"type":"ack","seq":N}` is
 * sent to the daemon only when a subscriber's own downstream consumer (the
 * mate client, over the RPC subscription's own Ack flow control — spec
 * §5.5) actually pulls a frame off its stream, inside {@link subscribe}'s
 * `Stream.mapEffect` — never inside the daemon-message handler itself. A
 * client that stops acking simply stops receiving new frames (the daemon
 * pauses, since it never gets the ack it is waiting for) while `status`/
 * `tabs`/`url` keep flowing untouched.
 *
 * ## Multiple subscribers never duplicate acks or pile up frames
 *
 * Frames are never queued as payloads on the shared bus: a frame publishes
 * only a lightweight "changed" marker (`InternalEvent`'s `"frameChanged"`
 * kind), and each subscriber's own `Stream.mapEffect` re-reads whatever the
 * CURRENT frame is (`latestFrame`) at the moment it consumes that marker —
 * so a subscriber that fell behind and is holding a backlog of stale
 * markers converges on the single latest frame instead of replaying every
 * intermediate one, and never emits the same frame to itself twice in a row
 * (`lastEmittedSeq`, per subscriber). The daemon-facing ack is deduplicated
 * globally (`lastAckedSeq`, shared): acks are cumulative, so whichever
 * subscriber's pull reaches a given seq first is the only one that sends
 * anything for it — a second, slower subscriber's later pull of the same
 * (already-superseded) seq is a no-op.
 */
import * as NodeOS from "node:os";

import type {
  ZeropsBrowserFrame,
  ZeropsBrowserInput,
  ZeropsBrowserStateEvent,
  ZeropsBrowserStreamEvent,
  ZeropsBrowserStreamStatus,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";

/**
 * The subset of the browser (and Node's native) `WebSocket` API this module
 * needs, injectable so a test never opens a real socket. The real
 * implementation at {@link layer} is `new WebSocket(url)` cast through this —
 * Node's native WebSocket satisfies every member here.
 */
export interface BrowserSocket {
  send(data: string): void;
  close(): void;
  onopen: (() => void) | null;
  onmessage: ((event: { readonly data: unknown }) => void) | null;
  onclose: (() => void) | null;
  onerror: ((event: unknown) => void) | null;
}

export type ConnectSocket = (url: string) => BrowserSocket;

export interface ZeropsBrowserStreamOptions {
  /** Reads `~/.agent-browser/default.stream`; `undefined` when absent or unparsable. Called fresh on every connect attempt — never cached. */
  readonly readStreamPort: Effect.Effect<number | undefined>;
  readonly connect: ConnectSocket;
  /** Backoff schedule while a subscriber remains and the daemon is unreachable; the last entry repeats. Defaults to {@link DEFAULT_RECONNECT_DELAYS_MS}. */
  readonly reconnectDelaysMs?: ReadonlyArray<number>;
  /** How long a connection must stay open to count as recovered (resets backoff to the first delay). Defaults to {@link DEFAULT_CONNECTION_STABLE_THRESHOLD_MS}. */
  readonly connectionStableThresholdMs?: number;
}

export class ZeropsBrowserStream extends Context.Service<
  ZeropsBrowserStream,
  {
    /** Connects on the first subscription, disconnects when the last one's scope closes. */
    readonly subscribe: Effect.Effect<Stream.Stream<ZeropsBrowserStreamEvent>, never, Scope.Scope>;
    /** Forwards one input event to the daemon's current connection; a no-op (never throws) when nothing is connected. */
    readonly sendInput: (input: ZeropsBrowserInput) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsBrowserStream") {}

const DEFAULT_RECONNECT_DELAYS_MS = [200, 500, 1000, 2000, 5000] as const;

/** A connection open for less than this never resets backoff — otherwise a daemon that opens then immediately closes (repeatedly) would spin with no delay at all between attempts. */
export const DEFAULT_CONNECTION_STABLE_THRESHOLD_MS = 5000;

/** Pure: whether a connection that stayed open for `openedForMs` counts as recovered. */
export const isConnectionStable = (openedForMs: number, thresholdMs: number): boolean =>
  openedForMs >= thresholdMs;

type SocketEvent =
  | { readonly _tag: "open" }
  | { readonly _tag: "message"; readonly raw: string }
  | { readonly _tag: "close" }
  | { readonly _tag: "error"; readonly error: unknown };

/**
 * One event published on the shared bus. A frame publishes only a
 * "changed" marker, never the frame itself — see the module doc comment's
 * "Multiple subscribers" section.
 */
type InternalEvent =
  | { readonly kind: "state"; readonly event: ZeropsBrowserStateEvent }
  | { readonly kind: "frameChanged" };

/** The daemon message kinds this relay acts on; everything else (`status`, `console`, unrecognized) is silently ignored. */
type DaemonMessage =
  | { readonly kind: "frame"; readonly seq: number; readonly frame: ZeropsBrowserFrame }
  | { readonly kind: "page"; readonly url?: string; readonly title?: string }
  | { readonly kind: "ignored" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const readString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const readNumber = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const decodeJsonUnknown = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

/** See the module doc comment's "Wire shapes" section. */
const parseAgentBrowserMessage = (raw: string): DaemonMessage => {
  const decoded = decodeJsonUnknown(raw);
  if (Result.isFailure(decoded)) {
    return { kind: "ignored" };
  }
  const parsed = decoded.success;
  if (!isRecord(parsed)) {
    return { kind: "ignored" };
  }
  if (parsed.type === "frame") {
    const data = readString(parsed.data);
    const seq = readNumber(parsed.seq);
    if (data === undefined || seq === undefined) {
      return { kind: "ignored" };
    }
    const metadata = isRecord(parsed.metadata) ? parsed.metadata : undefined;
    const width = readNumber(metadata?.deviceWidth) ?? 0;
    const height = readNumber(metadata?.deviceHeight) ?? 0;
    const pageScaleFactor = readNumber(metadata?.pageScaleFactor);
    const scrollX = readNumber(metadata?.scrollOffsetX);
    const scrollY = readNumber(metadata?.scrollOffsetY);
    return {
      kind: "frame",
      seq,
      frame: {
        type: "frame",
        data,
        width,
        height,
        ...(pageScaleFactor !== undefined ? { pageScaleFactor } : {}),
        ...(scrollX !== undefined ? { scrollX } : {}),
        ...(scrollY !== undefined ? { scrollY } : {}),
      },
    };
  }
  if (parsed.type === "tabs" && Array.isArray(parsed.tabs)) {
    const active = parsed.tabs.find(
      (tab): tab is Record<string, unknown> => isRecord(tab) && tab.active === true,
    );
    const url = readString(active?.url);
    const title = readString(active?.title);
    return url === undefined && title === undefined
      ? { kind: "ignored" }
      : {
          kind: "page",
          ...(url !== undefined ? { url } : {}),
          ...(title !== undefined ? { title } : {}),
        };
  }
  if (parsed.type === "url") {
    const url = readString(parsed.url);
    return url === undefined ? { kind: "ignored" } : { kind: "page", url };
  }
  // `status` and `console` are real, recognized daemon messages this relay
  // does not act on — ignored, not an error.
  return { kind: "ignored" };
};

const ConfigMessage = Schema.Struct({
  type: Schema.Literal("config"),
  maxFps: Schema.Number,
  pacing: Schema.Literal("ack"),
});
const encodeConfigMessage = Schema.encodeSync(Schema.fromJsonString(ConfigMessage));

const AckMessage = Schema.Struct({ type: Schema.Literal("ack"), seq: Schema.Number });
const encodeAckMessage = Schema.encodeSync(Schema.fromJsonString(AckMessage));

const DaemonMouseInputMessage = Schema.Struct({
  type: Schema.Literal("input_mouse"),
  eventType: Schema.Literals(["mouseMoved", "mousePressed", "mouseReleased"]),
  x: Schema.Number,
  y: Schema.Number,
  button: Schema.optional(Schema.Literals(["left", "middle", "right", "none"])),
  clickCount: Schema.optional(Schema.Number),
});
const encodeDaemonMouseInput = Schema.encodeSync(Schema.fromJsonString(DaemonMouseInputMessage));

const DaemonKeyboardInputMessage = Schema.Struct({
  type: Schema.Literal("input_keyboard"),
  eventType: Schema.Literals(["keyDown", "keyUp", "char"]),
  key: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
});
const encodeDaemonKeyboardInput = Schema.encodeSync(
  Schema.fromJsonString(DaemonKeyboardInputMessage),
);

const toDaemonInputMessage = (input: ZeropsBrowserInput): string =>
  input.kind === "mouse"
    ? encodeDaemonMouseInput({
        type: "input_mouse",
        eventType: input.eventType,
        x: input.x,
        y: input.y,
        ...(input.button !== undefined ? { button: input.button } : {}),
        ...(input.clickCount !== undefined ? { clickCount: input.clickCount } : {}),
      })
    : encodeDaemonKeyboardInput({
        type: "input_keyboard",
        eventType: input.eventType,
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
      });

export const make = (options: ZeropsBrowserStreamOptions) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<InternalEvent>();
    const subscriberCount = yield* Ref.make(0);
    const connectionFiber = yield* Ref.make<Fiber.Fiber<void, never> | undefined>(undefined);
    // Serializes every subscribe-start (0→1: fork) and subscribe-end (1→0:
    // interrupt) transition so a resubscribe racing the outgoing unsubscribe
    // can never fork a new loop and then have the FINISHING subscriber's
    // finalizer interrupt that new fiber instead of its own (a bare
    // check-then-act on separate Refs would allow exactly that race).
    const lifecycleMutex = yield* Semaphore.make(1);
    // Set only once the socket has genuinely reached OPEN (never while
    // CONNECTING) — Node's WebSocket throws synchronously on `send` before
    // that, which would otherwise surface as a thrown defect from inside a
    // subscriber's own Stream and kill its subscription.
    const activeSocket = yield* Ref.make<BrowserSocket | undefined>(undefined);
    const lastState = yield* Ref.make<ZeropsBrowserStateEvent>({
      type: "state",
      status: "no-browser",
    });
    const latestFrame = yield* Ref.make<
      { readonly seq: number; readonly frame: ZeropsBrowserFrame } | undefined
    >(undefined);
    /** Shared across every subscriber — acks are cumulative, so the daemon only ever needs the highest seq any subscriber has reached. */
    const lastAckedSeq = yield* Ref.make<number | undefined>(undefined);
    const delays = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;
    const stableThresholdMs =
      options.connectionStableThresholdMs ?? DEFAULT_CONNECTION_STABLE_THRESHOLD_MS;

    const sendQuietly = (socket: BrowserSocket, data: string): Effect.Effect<void> =>
      Effect.sync(() => {
        try {
          socket.send(data);
        } catch {
          // Best-effort — a send raced with the socket closing or a
          // reconnect; the connection loop already notices the close/error
          // and retries, so this never needs to propagate.
        }
      });

    const publishState = (patch: {
      readonly status?: ZeropsBrowserStreamStatus;
      readonly url?: string;
      readonly title?: string;
    }) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(lastState);
        const status = patch.status ?? current.status;
        const event: ZeropsBrowserStateEvent = {
          type: "state",
          status,
          // Sticky: every published state event carries the complete known
          // page info, not just what this particular patch changed — a late
          // subscriber's own initial read (below) then never has to guess.
          ...(patch.url !== undefined
            ? { url: patch.url }
            : current.url !== undefined
              ? { url: current.url }
              : {}),
          ...(patch.title !== undefined
            ? { title: patch.title }
            : current.title !== undefined
              ? { title: current.title }
              : {}),
        };
        yield* Ref.set(lastState, event);
        if (status !== "live") {
          // A stale frame from a previous session must never be handed to a
          // subscriber that joins after the connection has already dropped.
          yield* Ref.set(latestFrame, undefined);
        }
        yield* PubSub.publish(events, { kind: "state", event });
      });

    const publishFrame = (frame: ZeropsBrowserFrame, seq: number) =>
      Effect.gen(function* () {
        yield* Ref.set(latestFrame, { seq, frame });
        yield* PubSub.publish(events, { kind: "frameChanged" });
      });

    const closeSocketQuietly = (socket: BrowserSocket | undefined) =>
      Effect.sync(() => {
        if (socket === undefined) {
          return;
        }
        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.onerror = null;
        try {
          socket.close();
        } catch {
          // Best-effort — the daemon connection is going away regardless.
        }
      });

    const handleDaemonMessage = (raw: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const parsedMessage = parseAgentBrowserMessage(raw);
        if (parsedMessage.kind === "frame") {
          yield* publishFrame(parsedMessage.frame, parsedMessage.seq);
        } else if (parsedMessage.kind === "page") {
          yield* publishState({
            ...(parsedMessage.url !== undefined ? { url: parsedMessage.url } : {}),
            ...(parsedMessage.title !== undefined ? { title: parsedMessage.title } : {}),
          });
        }
      });

    /** One connection attempt: opens the socket, relays until it closes. Returns how long it stayed open, in ms (`0` when it never even opened). */
    const runOneConnection = (port: number): Effect.Effect<number> =>
      Effect.gen(function* () {
        const queue = yield* Queue.unbounded<SocketEvent>();
        const socket = options.connect(`ws://127.0.0.1:${port}/?pacing=ack&maxFps=10`);
        socket.onopen = () => Queue.offerUnsafe(queue, { _tag: "open" });
        socket.onmessage = (event) =>
          Queue.offerUnsafe(queue, {
            _tag: "message",
            raw: typeof event.data === "string" ? event.data : String(event.data),
          });
        socket.onclose = () => Queue.offerUnsafe(queue, { _tag: "close" });
        socket.onerror = (error) => Queue.offerUnsafe(queue, { _tag: "error", error });

        const first = yield* Queue.take(queue);
        if (first._tag !== "open") {
          yield* closeSocketQuietly(socket);
          return 0;
        }

        const openedAt = yield* Clock.currentTimeMillis;
        yield* Ref.set(activeSocket, socket);
        yield* sendQuietly(
          socket,
          encodeConfigMessage({ type: "config", maxFps: 10, pacing: "ack" }),
        );
        yield* publishState({ status: "live" });

        yield* Stream.fromQueue(queue).pipe(
          Stream.mapEffect((socketEvent) =>
            socketEvent._tag === "message"
              ? handleDaemonMessage(socketEvent.raw).pipe(Effect.as(true))
              : Effect.succeed(false),
          ),
          Stream.takeWhile((keepGoing) => keepGoing),
          Stream.runDrain,
        );

        yield* closeSocketQuietly(socket);
        yield* Ref.set(activeSocket, undefined);
        return (yield* Clock.currentTimeMillis) - openedAt;
      });

    /** Runs for as long as at least one subscriber exists — forked on 0→1, interrupted on 1→0. */
    const connectionLoop: Effect.Effect<void> = Effect.gen(function* () {
      let attempt = 0;
      while (true) {
        const port = yield* options.readStreamPort;
        let openedForMs = 0;
        if (port === undefined) {
          yield* publishState({ status: "no-browser" });
        } else {
          yield* publishState({ status: "connecting" });
          openedForMs = yield* runOneConnection(port);
        }
        if (isConnectionStable(openedForMs, stableThresholdMs)) {
          attempt = 0;
          continue;
        }
        const delayMs = delays[Math.min(attempt, delays.length - 1)]!;
        attempt += 1;
        yield* Effect.sleep(Duration.millis(delayMs));
      }
    });

    /** Sent from inside a subscriber's own stream, only once THAT subscriber actually pulls the marker — see the module doc comment's "Ack pacing" section. Deduplicated across subscribers via `lastAckedSeq` (acks are cumulative). */
    const ackDaemonFrame = (seq: number): Effect.Effect<void> =>
      Effect.gen(function* () {
        const already = yield* Ref.get(lastAckedSeq);
        if (already !== undefined && seq <= already) {
          return;
        }
        yield* Ref.set(lastAckedSeq, seq);
        const socket = yield* Ref.get(activeSocket);
        if (socket === undefined) {
          return;
        }
        yield* sendQuietly(socket, encodeAckMessage({ type: "ack", seq }));
      });

    const subscribe: Effect.Effect<
      Stream.Stream<ZeropsBrowserStreamEvent>,
      never,
      Scope.Scope
    > = Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(events);
      const initialState = yield* Ref.get(lastState);
      const initialFrame = yield* Ref.get(latestFrame);

      yield* lifecycleMutex.withPermits(1)(
        Effect.gen(function* () {
          const count = yield* Ref.updateAndGet(subscriberCount, (n) => n + 1);
          if (count === 1) {
            const fiber = yield* Effect.forkDetach(connectionLoop);
            yield* Ref.set(connectionFiber, fiber);
          }
        }),
      );
      yield* Effect.addFinalizer(() =>
        lifecycleMutex.withPermits(1)(
          Effect.gen(function* () {
            const remaining = yield* Ref.updateAndGet(subscriberCount, (n) => n - 1);
            if (remaining > 0) {
              return;
            }
            const fiber = yield* Ref.get(connectionFiber);
            yield* Ref.set(connectionFiber, undefined);
            if (fiber !== undefined) {
              yield* Fiber.interrupt(fiber);
            }
            const socket = yield* Ref.get(activeSocket);
            yield* closeSocketQuietly(socket);
            yield* Ref.set(activeSocket, undefined);
          }),
        ),
      );

      // A late subscriber gets the current status AND, when one is already
      // known, the current frame right behind it — a static page produces
      // exactly one frame ever, so waiting for a fresh one could mean
      // waiting forever.
      const initialEvents: ReadonlyArray<InternalEvent> = [
        { kind: "state", event: initialState },
        ...(initialFrame !== undefined ? [{ kind: "frameChanged" as const }] : []),
      ];
      const rawStream = Stream.concat(
        Stream.fromIterable(initialEvents),
        Stream.fromSubscription(subscription),
      );

      // Per-subscriber: the seq this subscriber last actually emitted, so a
      // backlog of "frameChanged" markers this subscriber fell behind on
      // converges on the single latest frame instead of re-emitting every
      // intermediate one.
      const lastEmittedSeq = yield* Ref.make<number | undefined>(undefined);

      return rawStream.pipe(
        Stream.mapEffect((internal): Effect.Effect<ZeropsBrowserStreamEvent | undefined> => {
          if (internal.kind === "state") {
            return Effect.succeed(internal.event);
          }
          return Effect.gen(function* () {
            const current = yield* Ref.get(latestFrame);
            if (current === undefined) {
              return undefined;
            }
            const already = yield* Ref.get(lastEmittedSeq);
            if (already === current.seq) {
              return undefined;
            }
            yield* Ref.set(lastEmittedSeq, current.seq);
            yield* ackDaemonFrame(current.seq);
            return current.frame;
          });
        }),
        Stream.filter((event): event is ZeropsBrowserStreamEvent => event !== undefined),
      );
    });

    const sendInput = (input: ZeropsBrowserInput): Effect.Effect<void> =>
      Effect.gen(function* () {
        const socket = yield* Ref.get(activeSocket);
        if (socket === undefined) {
          // Nothing connected right now — the panel disables input outside
          // `live`, so this is a race at worst, never a user-visible error.
          return;
        }
        yield* sendQuietly(socket, toDaemonInputMessage(input));
      });

    return { subscribe, sendInput } satisfies ZeropsBrowserStream["Service"];
  });

const STREAM_PORT_FILE_SEGMENTS = [".agent-browser", "default.stream"] as const;

const readStreamPortFromFile = (
  fs: FileSystem.FileSystem,
  path: Path.Path,
  homeDir: string,
): Effect.Effect<number | undefined> =>
  fs.readFileString(path.join(homeDir, ...STREAM_PORT_FILE_SEGMENTS)).pipe(
    Effect.map((raw) => {
      const trimmed = raw.trim();
      const port = Number.parseInt(trimmed, 10);
      return Number.isInteger(port) && port > 0 && port < 65536 && String(port) === trimmed
        ? port
        : undefined;
    }),
    Effect.orElseSucceed(() => undefined),
  );

const connectReal: ConnectSocket = (url) => new WebSocket(url) as unknown as BrowserSocket;

export const layer = Layer.effect(
  ZeropsBrowserStream,
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    return yield* make({
      readStreamPort: readStreamPortFromFile(fs, path, NodeOS.homedir()),
      connect: connectReal,
    });
  }),
);
