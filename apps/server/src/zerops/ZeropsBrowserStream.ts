/**
 * The live view of the container's agent-browser daemon (S8b) —
 * `../zcp/docs/spec-mate.md` §5 "Browser surface", §0 touchpoint "the
 * agent-browser daemon's published stream port".
 *
 * zcp learns nothing (§0 rule 3): this reads `~/.agent-browser/default.stream`
 * — a bare localhost port number the daemon itself publishes — fresh on
 * every connect attempt, and writes nothing back to it or to zcp. The daemon
 * socket is localhost-only and unauthenticated by design; the mate server is
 * its only client, and the WebSocket's own scopes (`AuthOrchestrationReadScope`
 * for the subscription, `AuthOrchestrationOperateScope` for input —
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
 * ## Unmeasured: the daemon's own message shapes
 *
 * No browser was open on the `z3-eval` rig at build time (verified.md,
 * 2026-09-04), so `parseAgentBrowserMessage`/`toDaemonInputMessage` below are
 * a documented GUESS at the daemon's wire shape, built from
 * `agent-browser stream --help` and the team's own measured summary (frames
 * are JSON with base64 JPEG plus device dimensions and scroll offset; input
 * goes back as `input_mouse`/`input_keyboard`/`input_touch`; the daemon
 * emits URL messages on navigation) — never from a live capture. The relay
 * and reconnect machinery around them does not depend on getting the exact
 * field names right; only frame/URL delivery and the ack seq number do. A
 * live pass must correct this doc comment and the two functions together.
 */
import * as NodeOS from "node:os";

import type {
  ZeropsBrowserInput,
  ZeropsBrowserStreamEvent,
  ZeropsBrowserStreamStatus,
} from "@t3tools/contracts";
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
import type * as Scope from "effect/Scope";
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

type SocketEvent =
  | { readonly _tag: "open" }
  | { readonly _tag: "message"; readonly raw: string }
  | { readonly _tag: "close" }
  | { readonly _tag: "error"; readonly error: unknown };

interface ParsedDaemonMessage {
  readonly event: ZeropsBrowserStreamEvent;
  /** Present on a frame message that carries its own sequence number — echoed straight back as `{"type":"ack","seq":N}` (`pacing=ack`). */
  readonly ackSeq?: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const decodeJsonUnknown = Schema.decodeUnknownResult(Schema.fromJsonString(Schema.Unknown));

/** See the module doc comment's "Unmeasured" section. */
const parseAgentBrowserMessage = (raw: string): ParsedDaemonMessage | undefined => {
  const decoded = decodeJsonUnknown(raw);
  if (Result.isFailure(decoded)) {
    return undefined;
  }
  const parsed = decoded.success;
  if (!isRecord(parsed)) {
    return undefined;
  }
  if (parsed.type === "frame" && typeof parsed.data === "string") {
    const width = typeof parsed.width === "number" ? parsed.width : 0;
    const height = typeof parsed.height === "number" ? parsed.height : 0;
    const scrollX = typeof parsed.scrollX === "number" ? parsed.scrollX : undefined;
    const scrollY = typeof parsed.scrollY === "number" ? parsed.scrollY : undefined;
    const seq = typeof parsed.seq === "number" ? parsed.seq : undefined;
    return {
      event: {
        type: "frame",
        data: parsed.data,
        width,
        height,
        ...(scrollX !== undefined ? { scrollX } : {}),
        ...(scrollY !== undefined ? { scrollY } : {}),
      },
      ...(seq !== undefined ? { ackSeq: seq } : {}),
    };
  }
  if (parsed.type === "url" && typeof parsed.url === "string") {
    return { event: { type: "state", status: "live", url: parsed.url } };
  }
  return undefined;
};

const ConfigMessage = Schema.Struct({
  type: Schema.Literal("config"),
  maxFps: Schema.Number,
  pacing: Schema.Literal("ack"),
});
const encodeConfigMessage = Schema.encodeSync(Schema.fromJsonString(ConfigMessage));

const AckMessage = Schema.Struct({ type: Schema.Literal("ack"), seq: Schema.Number });
const encodeAckMessage = Schema.encodeSync(Schema.fromJsonString(AckMessage));

/** See the module doc comment's "Unmeasured" section. */
const DaemonMouseInputMessage = Schema.Struct({
  type: Schema.Literal("input_mouse"),
  action: Schema.Literals(["move", "down", "up", "click"]),
  x: Schema.Number,
  y: Schema.Number,
  button: Schema.optional(Schema.Literals(["left", "middle", "right"])),
});
const encodeDaemonMouseInput = Schema.encodeSync(Schema.fromJsonString(DaemonMouseInputMessage));

/** See the module doc comment's "Unmeasured" section. */
const DaemonKeyboardInputMessage = Schema.Struct({
  type: Schema.Literal("input_keyboard"),
  action: Schema.Literals(["down", "up"]),
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
        action: input.action,
        x: input.x,
        y: input.y,
        ...(input.button !== undefined ? { button: input.button } : {}),
      })
    : encodeDaemonKeyboardInput({
        type: "input_keyboard",
        action: input.action,
        ...(input.key !== undefined ? { key: input.key } : {}),
        ...(input.text !== undefined ? { text: input.text } : {}),
      });

export const make = (options: ZeropsBrowserStreamOptions) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<ZeropsBrowserStreamEvent>();
    const subscriberCount = yield* Ref.make(0);
    const connectionFiber = yield* Ref.make<Fiber.Fiber<void, never> | undefined>(undefined);
    const activeSocket = yield* Ref.make<BrowserSocket | undefined>(undefined);
    const lastStatus = yield* Ref.make<ZeropsBrowserStreamStatus>("no-browser");
    const delays = options.reconnectDelaysMs ?? DEFAULT_RECONNECT_DELAYS_MS;

    const publish = (event: ZeropsBrowserStreamEvent) =>
      Effect.gen(function* () {
        if (event.type === "state") {
          yield* Ref.set(lastStatus, event.status);
        }
        yield* PubSub.publish(events, event);
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

    const handleDaemonMessage = (socket: BrowserSocket, raw: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        const parsedMessage = parseAgentBrowserMessage(raw);
        if (parsedMessage === undefined) {
          return;
        }
        yield* publish(parsedMessage.event);
        if (parsedMessage.ackSeq !== undefined) {
          socket.send(encodeAckMessage({ type: "ack", seq: parsedMessage.ackSeq }));
        }
      });

    /** One connection attempt: opens the socket, relays until it closes. Returns whether it ever reached `live`. */
    const runOneConnection = (port: number): Effect.Effect<boolean> =>
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
        yield* Ref.set(activeSocket, socket);

        const first = yield* Queue.take(queue);
        if (first._tag !== "open") {
          yield* closeSocketQuietly(socket);
          yield* Ref.set(activeSocket, undefined);
          return false;
        }

        socket.send(encodeConfigMessage({ type: "config", maxFps: 10, pacing: "ack" }));
        yield* publish({ type: "state", status: "live" });

        yield* Stream.fromQueue(queue).pipe(
          Stream.mapEffect((socketEvent) =>
            socketEvent._tag === "message"
              ? handleDaemonMessage(socket, socketEvent.raw).pipe(Effect.as(true))
              : Effect.succeed(false),
          ),
          Stream.takeWhile((keepGoing) => keepGoing),
          Stream.runDrain,
        );

        yield* closeSocketQuietly(socket);
        yield* Ref.set(activeSocket, undefined);
        return true;
      });

    /** Runs for as long as at least one subscriber exists — forked on 0→1, interrupted on 1→0. */
    const connectionLoop: Effect.Effect<void> = Effect.gen(function* () {
      let attempt = 0;
      while (true) {
        const port = yield* options.readStreamPort;
        let becameLive = false;
        if (port === undefined) {
          yield* publish({ type: "state", status: "no-browser" });
        } else {
          yield* publish({ type: "state", status: "connecting" });
          becameLive = yield* runOneConnection(port);
        }
        if (becameLive) {
          attempt = 0;
          continue;
        }
        const delayMs = delays[Math.min(attempt, delays.length - 1)]!;
        attempt += 1;
        yield* Effect.sleep(Duration.millis(delayMs));
      }
    });

    const subscribe: Effect.Effect<
      Stream.Stream<ZeropsBrowserStreamEvent>,
      never,
      Scope.Scope
    > = Effect.gen(function* () {
      const subscription = yield* PubSub.subscribe(events);
      const initialStatus = yield* Ref.get(lastStatus);
      const count = yield* Ref.updateAndGet(subscriberCount, (n) => n + 1);
      if (count === 1) {
        const fiber = yield* Effect.forkDetach(connectionLoop);
        yield* Ref.set(connectionFiber, fiber);
      }
      yield* Effect.addFinalizer(() =>
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
      );
      const initialEvent: ZeropsBrowserStreamEvent = { type: "state", status: initialStatus };
      return Stream.concat(Stream.make(initialEvent), Stream.fromSubscription(subscription));
    });

    const sendInput = (input: ZeropsBrowserInput): Effect.Effect<void> =>
      Effect.gen(function* () {
        const socket = yield* Ref.get(activeSocket);
        if (socket === undefined) {
          // Nothing connected right now — the panel disables input outside
          // `live`, so this is a race at worst, never a user-visible error.
          return;
        }
        socket.send(toDaemonInputMessage(input));
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
