/**
 * The live view of the app an agent opened on the paired Mac: the right
 * panel's Mac tab. A sibling of {@link ./ZeropsBrowserStream.ts} with the same
 * shape: `subscribe` for frames and state, `sendInput` for a click or text.
 *
 * On demand: the first subscriber starts one ssh connection to the Mac that
 * streams the app's window from the Mac's view helper
 * (`mac/macViewScript.ts`); the last one's leaving ends it. While a subscriber
 * remains, a dropped or refused connection is retried with backoff, re-reading
 * the pairing (`~/.t3/mac/host.json`) and the app to show
 * (`~/.t3/mac/view.json`, written by `mac open` and `mac device open`) on every attempt, so a
 * new pairing or a newly opened app is picked up without a restart.
 *
 * Input goes through the same in-use guard as `mac device`: while someone is
 * working on the Mac a click would take over their screen, so it is refused
 * on the Mac (exit 75) and the view says the Mac is in use instead.
 *
 * @module ZeropsMacStream
 */
import type {
  ZeropsMacFrame,
  ZeropsMacInput,
  ZeropsMacStateEvent,
  ZeropsMacStreamEvent,
  ZeropsMacStreamStatus,
} from "@t3tools/contracts";
import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";
import * as Stream from "effect/Stream";
import * as ChildProcess from "effect/process/ChildProcess";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";

import { ServerConfig } from "../config.ts";
import {
  decodeMacHostRecord,
  decodeMacViewRecord,
  MAC_VIEW_NO_HELPER_EXIT,
  macDeviceCommand,
  macHostPaths,
  type MacHostRecord,
  macPairCommands,
  macScreenPoint,
  macSshArgs,
  type MacViewRecord,
  macViewStreamCommand,
} from "./mac/MacHost.ts";
import { makeMacViewParser, type MacViewMessage } from "./mac/macViewWire.ts";

/** One running stream from the Mac: its stdout, then how it exited (255: ssh could not connect). */
export interface MacStreamProcess {
  readonly output: Stream.Stream<Uint8Array>;
  readonly exitCode: Effect.Effect<number>;
}

export interface ZeropsMacStreamOptions {
  /** The commands that pair a Mac with this Mate, handed to the person while a step of theirs is due. */
  readonly pairCommands: ReadonlyArray<string>;
  /** The pairing, read fresh on every attempt; `undefined` when no Mac is paired. */
  readonly readRecord: Effect.Effect<MacHostRecord | undefined>;
  /** The app to show, read fresh on every attempt and while streaming. */
  readonly readView: Effect.Effect<MacViewRecord | undefined>;
  /** Starts streaming `app`'s window from the Mac; closing the scope ends it. */
  readonly openStream: (
    record: MacHostRecord,
    app: string,
  ) => Effect.Effect<MacStreamProcess, never, Scope.Scope>;
  /** Runs one guarded agent-device command on the Mac; its exit code (75: someone is using the Mac). */
  readonly runDevice: (record: MacHostRecord, args: ReadonlyArray<string>) => Effect.Effect<number>;
  /** Backoff while a subscriber remains and the view is not live; the last entry repeats. */
  readonly retryDelaysMs?: ReadonlyArray<number>;
  /** How often the app to show is re-read while streaming, and the stream checked for silence. */
  readonly pollMs?: number;
  /** A stream silent this long is dead (the Mac slept, the VPN dropped): it is dropped and retried. */
  readonly stallMs?: number;
}

export class ZeropsMacStream extends Context.Service<
  ZeropsMacStream,
  {
    /** Reaches the Mac on the first subscription, lets go when the last one's scope closes. */
    readonly subscribe: Effect.Effect<Stream.Stream<ZeropsMacStreamEvent>, never, Scope.Scope>;
    /** A click or text for the app; a no-op without a pairing or (for a click) a frame. */
    readonly sendInput: (input: ZeropsMacInput) => Effect.Effect<void>;
  }
>()("t3/zerops/ZeropsMacStream") {}

const DEFAULT_RETRY_DELAYS_MS = [500, 1000, 2000, 5000] as const;
const DEFAULT_POLL_MS = 1000;
// Above the helper's slowest step (a 12 s capture), so a slow frame is never taken for a dead Mac.
const DEFAULT_STALL_MS = 20_000;
/**
 * The frames per second asked of the view helper: enough to follow an app as it moves. The smooth
 * streamer sends a frame only when the window changed, so a still app costs a tick a second; a Mac
 * without it captures at most 5 a second, as fast as launchd lets it.
 */
export const MAC_VIEW_FPS = 12;
/** `mac device`'s guard: someone is working on the Mac. */
const IN_USE_EXIT = 75;
const SSH_FAILED_EXIT = 255;

type InternalEvent =
  | { readonly kind: "state"; readonly event: ZeropsMacStateEvent }
  | { readonly kind: "frameChanged" };
const FRAME_CHANGED: InternalEvent = { kind: "frameChanged" };

type ConnectionOutcome =
  | { readonly kind: "exit"; readonly code: number }
  | { readonly kind: "view-changed" }
  | { readonly kind: "stalled" }
  | { readonly kind: "broken" };

const toBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64");

/** The states the view waits on the person for: pairing, reaching the Mac, or pairing again. */
const PERSON_STEP: ReadonlySet<ZeropsMacStreamStatus> = new Set([
  "not-paired",
  "unreachable",
  "no-helper",
]);

const INITIAL_STATE: ZeropsMacStateEvent = { type: "state", status: "connecting", inUse: false };

const sameState = (left: ZeropsMacStateEvent, right: ZeropsMacStateEvent) =>
  left.status === right.status &&
  left.macName === right.macName &&
  left.app === right.app &&
  left.inUse === right.inUse;

export const make = (options: ZeropsMacStreamOptions) =>
  Effect.gen(function* () {
    const events = yield* PubSub.unbounded<InternalEvent>();
    const subscriberCount = yield* Ref.make(0);
    const connectionFiber = yield* Ref.make<Fiber.Fiber<void, never> | undefined>(undefined);
    const lifecycleMutex = yield* Semaphore.make(1);
    // Clicks and text reach the Mac in the order the person made them.
    const inputMutex = yield* Semaphore.make(1);
    const lastState = yield* Ref.make<ZeropsMacStateEvent>(INITIAL_STATE);
    const latestFrame = yield* Ref.make<ZeropsMacFrame | undefined>(undefined);
    const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
    const stallMs = options.stallMs ?? DEFAULT_STALL_MS;

    const publishState = (patch: Partial<Omit<ZeropsMacStateEvent, "type">>) =>
      Effect.gen(function* () {
        const current = yield* Ref.get(lastState);
        const { pairCommands: _stale, ...rest } = { ...current, ...patch };
        // Only a step for the person on the Mac comes with the commands for it.
        const next: ZeropsMacStateEvent = PERSON_STEP.has(rest.status)
          ? { ...rest, type: "state", pairCommands: options.pairCommands }
          : { ...rest, type: "state" };
        // A frame from an earlier app or session never shows under a state that is not live.
        if (next.status !== "live") yield* Ref.set(latestFrame, undefined);
        if (sameState(current, next)) return;
        yield* Ref.set(lastState, next);
        yield* PubSub.publish(events, { kind: "state", event: next });
      });

    const handleMessage = (message: MacViewMessage) => {
      switch (message.type) {
        case "tick":
          return publishState({ inUse: message.inUse });
        case "state":
          return publishState({
            status: message.status === "no-capture" ? "no-helper" : "no-app",
            inUse: message.inUse,
          });
        case "frame":
          return Effect.gen(function* () {
            yield* publishState({ status: "live", inUse: message.inUse });
            const frame: ZeropsMacFrame = {
              type: "frame",
              mimeType: message.mimeType,
              data: toBase64(message.bytes),
              width: message.width,
              height: message.height,
              bounds: message.bounds,
            };
            yield* Ref.set(latestFrame, frame);
            yield* PubSub.publish(events, FRAME_CHANGED);
          });
      }
    };

    /** One ssh stream of `view.app`'s window, until it ends, stalls, breaks or the app to show changes. */
    const runOneConnection = (record: MacHostRecord, view: MacViewRecord) =>
      Effect.scoped(
        Effect.gen(function* () {
          const process = yield* options.openStream(record, view.app);
          const parser = makeMacViewParser();
          const lastHeardAt = yield* Ref.make(yield* Clock.currentTimeMillis);
          const consume: Effect.Effect<ConnectionOutcome> = Stream.runForEach(
            process.output,
            (chunk) =>
              Effect.gen(function* () {
                yield* Ref.set(lastHeardAt, yield* Clock.currentTimeMillis);
                for (const message of parser.push(chunk)) yield* handleMessage(message);
                if (parser.broken) return yield* Effect.fail("broken" as const);
              }),
          ).pipe(
            Effect.andThen(process.exitCode),
            Effect.map((code): ConnectionOutcome => ({ kind: "exit", code })),
            Effect.catch(() => Effect.succeed<ConnectionOutcome>({ kind: "broken" })),
          );
          const watch: Effect.Effect<ConnectionOutcome> = Effect.gen(function* () {
            while (true) {
              yield* Effect.sleep(Duration.millis(pollMs));
              const now = yield* Clock.currentTimeMillis;
              if (now - (yield* Ref.get(lastHeardAt)) >= stallMs) return { kind: "stalled" };
              const current = yield* options.readView;
              if (current?.app !== view.app) return { kind: "view-changed" };
            }
          });
          return yield* Effect.raceFirst(consume, watch);
        }),
      );

    /** Runs while at least one subscriber exists: forked on 0→1, interrupted on 1→0. */
    const connectionLoop: Effect.Effect<void> = Effect.gen(function* () {
      let attempt = 0;
      while (true) {
        const record = yield* options.readRecord;
        if (record === undefined) {
          yield* publishState({ status: "not-paired", inUse: false });
          yield* Effect.sleep(Duration.millis(pollMs));
          continue;
        }
        const macName = record.name;
        const view = yield* options.readView;
        if (view === undefined) {
          yield* publishState({ status: "no-app", macName, inUse: false });
          yield* Effect.sleep(Duration.millis(pollMs));
          continue;
        }
        const current = yield* Ref.get(lastState);
        // A retry keeps saying what the last attempt found; only a first try or a new app connects.
        if (current.app !== view.app || current.macName !== macName) {
          yield* publishState({ status: "connecting", macName, app: view.app });
        } else if (current.status === "not-paired" || current.status === "no-app") {
          yield* publishState({ status: "connecting" });
        }
        const startedAt = yield* Clock.currentTimeMillis;
        const outcome = yield* runOneConnection(record, view);
        if (outcome.kind === "view-changed") {
          attempt = 0;
          continue;
        }
        if (outcome.kind === "exit" && outcome.code === SSH_FAILED_EXIT) {
          yield* publishState({ status: "unreachable", inUse: false });
        } else if (outcome.kind === "exit" && outcome.code === MAC_VIEW_NO_HELPER_EXIT) {
          yield* publishState({ status: "no-helper", inUse: false });
        } else if (outcome.kind === "stalled") {
          yield* publishState({ status: "unreachable", inUse: false });
        }
        // A connection that streamed a while counts as recovered: its next try starts quick.
        if ((yield* Clock.currentTimeMillis) - startedAt >= stallMs) attempt = 0;
        const delayMs = delays[Math.min(attempt, delays.length - 1)]!;
        attempt += 1;
        yield* Effect.sleep(Duration.millis(delayMs));
      }
    });

    const subscribe: Effect.Effect<
      Stream.Stream<ZeropsMacStreamEvent>,
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
            yield* Ref.set(connectionFiber, yield* Effect.forkDetach(connectionLoop));
          }
        }),
      );
      yield* Effect.addFinalizer(() =>
        lifecycleMutex.withPermits(1)(
          Effect.gen(function* () {
            const remaining = yield* Ref.updateAndGet(subscriberCount, (n) => n - 1);
            if (remaining > 0) return;
            const fiber = yield* Ref.get(connectionFiber);
            yield* Ref.set(connectionFiber, undefined);
            if (fiber !== undefined) yield* Fiber.interrupt(fiber);
            // The next first subscriber starts from nothing known, never this session's view.
            yield* Ref.set(lastState, INITIAL_STATE);
            yield* Ref.set(latestFrame, undefined);
          }),
        ),
      );

      const initialEvents: ReadonlyArray<InternalEvent> = [
        { kind: "state", event: initialState },
        ...(initialFrame !== undefined ? [FRAME_CHANGED] : []),
      ];
      // Per subscriber: a backlog of frame markers converges on the latest frame, sent once.
      const lastEmittedFrame = yield* Ref.make<ZeropsMacFrame | undefined>(undefined);
      return Stream.concat(
        Stream.fromIterable(initialEvents),
        Stream.fromSubscription(subscription),
      ).pipe(
        Stream.mapEffect((internal): Effect.Effect<ZeropsMacStreamEvent | undefined> => {
          if (internal.kind === "state") return Effect.succeed(internal.event);
          return Effect.gen(function* () {
            const current = yield* Ref.get(latestFrame);
            if (current === undefined || current === (yield* Ref.get(lastEmittedFrame))) {
              return undefined;
            }
            yield* Ref.set(lastEmittedFrame, current);
            return current;
          });
        }),
        Stream.filter((event): event is ZeropsMacStreamEvent => event !== undefined),
      );
    });

    const sendInput = (input: ZeropsMacInput): Effect.Effect<void> =>
      inputMutex.withPermits(1)(
        Effect.gen(function* () {
          const record = yield* options.readRecord;
          if (record === undefined) return;
          let args: ReadonlyArray<string>;
          if (input.kind === "click") {
            const frame = yield* Ref.get(latestFrame);
            // The view disables input outside live; a click without a frame is a race at worst.
            if (frame === undefined) return;
            const point = macScreenPoint(frame.bounds, frame, input);
            args = ["press", String(point.x), String(point.y)];
          } else {
            args = ["type", input.text];
          }
          const code = yield* options.runDevice(record, args);
          if (code === IN_USE_EXIT) yield* publishState({ inUse: true });
        }),
      );

    return { subscribe, sendInput } satisfies ZeropsMacStream["Service"];
  });

/** A process that never ran: no output, exit as ssh's own failure. */
const failedProcess: MacStreamProcess = {
  output: Stream.empty,
  exitCode: Effect.succeed(SSH_FAILED_EXIT),
};

/** An agent-device press or type is quick; one that runs this long has hung. */
const DEVICE_TIMEOUT = Duration.seconds(30);

export const layer = Layer.effect(
  ZeropsMacStream,
  Effect.gen(function* () {
    const config = yield* ServerConfig;
    const fs = yield* FileSystem.FileSystem;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const paths = macHostPaths(config.baseDir);
    const readDecoded = <A>(file: string, decode: (json: string) => A | undefined) =>
      fs.readFileString(file).pipe(
        Effect.map(decode),
        Effect.orElseSucceed(() => undefined),
      );
    const ssh = (record: MacHostRecord, remoteCommand: string) =>
      spawner.spawn(ChildProcess.make("ssh", [...macSshArgs(record, paths, remoteCommand)]));
    return yield* make({
      pairCommands: macPairCommands(
        config.zerops?.projectId ?? process.env["projectId"] ?? "<project id>",
        process.env["hostname"] ?? "zcp",
      ),
      readRecord: readDecoded(paths.record, decodeMacHostRecord),
      readView: readDecoded(paths.view, decodeMacViewRecord),
      openStream: (record, app) =>
        ssh(record, macViewStreamCommand(record, app, MAC_VIEW_FPS)).pipe(
          Effect.tap((process) => Effect.forkScoped(Stream.runDrain(process.stderr))),
          Effect.map((process): MacStreamProcess => ({
            output: process.stdout.pipe(Stream.catch(() => Stream.empty)),
            exitCode: process.exitCode.pipe(
              Effect.map(Number),
              Effect.orElseSucceed(() => SSH_FAILED_EXIT),
            ),
          })),
          Effect.orElseSucceed(() => failedProcess),
        ),
      runDevice: (record, args) =>
        Effect.scoped(
          Effect.gen(function* () {
            const process = yield* ssh(record, macDeviceCommand(record, args));
            const [, , code] = yield* Effect.all(
              [Stream.runDrain(process.stdout), Stream.runDrain(process.stderr), process.exitCode],
              { concurrency: "unbounded" },
            );
            return Number(code);
          }),
        ).pipe(
          Effect.timeoutOrElse({
            duration: DEVICE_TIMEOUT,
            orElse: () => Effect.succeed(SSH_FAILED_EXIT),
          }),
          Effect.orElseSucceed(() => SSH_FAILED_EXIT),
        ),
    });
  }),
);
