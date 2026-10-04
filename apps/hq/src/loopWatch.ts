// @effect-diagnostics nodeBuiltinImport:off -- the loop's delay, the process's CPU and its stdout are Node's own.
/**
 * Whether HQ's event loop runs, for `/health` (F22, 2026-10-03: on KRLS, `/health` answered after
 * 52.7 s, together with 40 GETs, though its database probe gives up at 2 s and it reads nothing of
 * Zerops — the loop itself did not run). Two measures:
 *
 * - **The loop's delay** over the last one to two minutes: its longest, and its 99th percentile
 *   (the higher of the two minutes').
 * - **A watchdog**: a tick every second; one that comes more than 2 s late is a stall, logged once
 *   the loop runs again and kept as the newest, with what tells its cause — the CPU HQ used in it
 *   (as long as the stall: HQ's own work), and its longest write to stdout (as long as the stall:
 *   a log reader that stopped reading, a synchronous write to stdout holding the whole process);
 *   neither: the process was not run at all. What stdout is — a pipe, a file — is logged at boot.
 *
 * @module loopWatch
 */
import * as NodeFS from "node:fs";
import * as NodePerfHooks from "node:perf_hooks";
import * as NodeProcess from "node:process";

import * as Clock from "effect/Clock";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Ref from "effect/Ref";

/** What the watch reads of the process; the Node ones are `nodeProbes`. */
export interface LoopProbes {
  /** A monotonic clock, ms: how late a tick came, as the process lived it. */
  readonly nowMs: () => number;
  /** The CPU time this process has used so far, ms. */
  readonly cpuMs: () => number;
  /** The longest write to stdout since this was last asked, ms. */
  readonly longestWriteMs: () => number;
  /** The loop's delay since it was last reset, ms: its longest, and its 99th percentile. */
  readonly lag: () => { readonly maxMs: number; readonly p99Ms: number };
  readonly resetLag: () => void;
}

/** A tick that came late: when, by how much, and the CPU and the longest stdout write in it. */
export interface Stall {
  readonly at: string;
  readonly lateMs: number;
  readonly cpuMs: number;
  readonly longestWriteMs: number;
}

export interface LoopStatus {
  readonly maxLagMs: number;
  readonly p99LagMs: number;
  readonly lastStall: Stall | null;
}

export class LoopWatch extends Context.Service<
  LoopWatch,
  { readonly status: Effect.Effect<LoopStatus> }
>()("@t3tools/hq/loopWatch") {}

const TICK = Duration.seconds(1);
/** How late a tick may come before it is a stall. */
const STALL_AFTER = Duration.seconds(2);
/** How long the loop's delay is gathered before it is the minute before. */
const LAG_WINDOW = Duration.minutes(1);

/** The watch over `probes`, its watchdog running for the scope. */
export const makeLoopWatch = (probes: LoopProbes) =>
  Effect.gen(function* () {
    const lastStall = yield* Ref.make<Stall | null>(null);
    const last = yield* Ref.make({ at: probes.nowMs(), cpu: probes.cpuMs() });
    probes.longestWriteMs();
    /** The delay gathered since `since`, beside the window before it. */
    const lagWindow = yield* Ref.make({ since: probes.nowMs(), before: { maxMs: 0, p99Ms: 0 } });
    const tick = Effect.gen(function* () {
      yield* Effect.sleep(TICK);
      const now = probes.nowMs();
      const cpu = probes.cpuMs();
      const longestWriteMs = probes.longestWriteMs();
      const before = yield* Ref.getAndSet(last, { at: now, cpu });
      const window = yield* Ref.get(lagWindow);
      if (now - window.since >= Duration.toMillis(LAG_WINDOW)) {
        yield* Ref.set(lagWindow, { since: now, before: probes.lag() });
        probes.resetLag();
      }
      const lateMs = now - before.at - Duration.toMillis(TICK);
      if (lateMs <= Duration.toMillis(STALL_AFTER)) return;
      const stall: Stall = {
        at: DateTime.formatIso(DateTime.makeUnsafe(yield* Clock.currentTimeMillis)),
        lateMs,
        cpuMs: Math.round(cpu - before.cpu),
        longestWriteMs: Math.round(longestWriteMs),
      };
      yield* Ref.set(lastStall, stall);
      yield* Effect.logWarning("the event loop stalled", stall);
    });
    yield* Effect.forkScoped(Effect.forever(tick));
    return LoopWatch.of({
      status: Effect.gen(function* () {
        const { before } = yield* Ref.get(lagWindow);
        const lag = probes.lag();
        return {
          maxLagMs: Math.round(Math.max(before.maxMs, lag.maxMs)),
          p99LagMs: Math.round(Math.max(before.p99Ms, lag.p99Ms)),
          lastStall: yield* Ref.get(lastStall),
        };
      }),
    });
  });

/**
 * `stream`'s writes timed while the scope lasts: the longest since it was last asked, ms. Its own
 * write is put back after.
 */
export const timeWrites = <W extends (...args: Array<never>) => boolean>(stream: { write: W }) =>
  Effect.map(
    Effect.acquireRelease(
      Effect.sync(() => {
        const original = stream.write;
        let longest = 0;
        const timed = (...args: Parameters<W>): boolean => {
          const started = NodePerfHooks.performance.now();
          try {
            return Reflect.apply(original, stream, args) as boolean;
          } finally {
            longest = Math.max(longest, NodePerfHooks.performance.now() - started);
          }
        };
        stream.write = timed as unknown as W;
        const longestWriteMs = () => {
          const taken = longest;
          longest = 0;
          return taken;
        };
        return { original, timed, longestWriteMs };
      }),
      // Only its own: a write timed since by another stays.
      ({ original, timed }) =>
        Effect.sync(() => {
          if (stream.write === (timed as unknown as W)) stream.write = original;
        }),
    ),
    ({ longestWriteMs }) => ({ longestWriteMs }),
  );

/** What the file descriptor `fd` is: stdout's, at boot, tells what a write to it may wait on. */
export const kindOf = (fd: number) =>
  Effect.try(() => {
    const stats = NodeFS.fstatSync(fd);
    if (stats.isFIFO()) return "pipe";
    if (stats.isSocket()) return "socket";
    if (stats.isFile()) return "file";
    if (stats.isCharacterDevice()) return "character device";
    return "other";
  }).pipe(Effect.orElseSucceed(() => "unknown"));

/** The probes of this process: its loop's delay, its CPU, and its stdout's writes, while the scope lasts. */
export const nodeProbes = Effect.gen(function* () {
  const delay = NodePerfHooks.monitorEventLoopDelay({ resolution: 20 });
  yield* Effect.acquireRelease(
    Effect.sync(() => delay.enable()),
    () => Effect.sync(() => delay.disable()),
  );
  const stdout = yield* timeWrites(NodeProcess.stdout);
  const probes: LoopProbes = {
    nowMs: () => NodePerfHooks.performance.now(),
    cpuMs: () => {
      const used = NodeProcess.cpuUsage();
      return (used.user + used.system) / 1000;
    },
    longestWriteMs: stdout.longestWriteMs,
    lag: () => ({ maxMs: delay.max / 1e6, p99Ms: delay.percentile(99) / 1e6 }),
    resetLag: () => delay.reset(),
  };
  return probes;
});

/** The watch over this process, what its stdout is logged as it starts. */
export const loopWatchLayer = Layer.effect(
  LoopWatch,
  Effect.gen(function* () {
    yield* Effect.logInfo("HQ's stdout", { kind: yield* kindOf(1) });
    return yield* makeLoopWatch(yield* nodeProbes);
  }),
);
