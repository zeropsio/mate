// @effect-diagnostics nodeBuiltinImport:off -- procfs, statfs and kernel notification boundary.
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import { sustainedPressureLevel, type MateResourceHealth } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Clock from "effect/Clock";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import { numberOf, limitOf, pressureOf } from "./mateResourceEvidence.ts";
export const RESOURCE_HEALTH_SAMPLE_INTERVAL_MS = 2000;
export const OOM_NOTICE_DURATION_MS = 10 * 60 * 1000;
export const TASK_LIMIT_WARNING_RATIO = 0.9;

const growing = (value: number, previous: number | undefined) =>
  previous === undefined ? 0 : Math.max(0, value - previous);
/** Read the visible hierarchy: ancestor limits include sibling/container work, not only Mate's unit. */
export async function readResourceHealth(
  cgroups: ReadonlyArray<string>,
  stateDir: string,
  previous: MateResourceHealth | undefined,
  now: number,
): Promise<MateResourceHealth> {
  const unavailable = new Set<string>();
  async function read<T>(
    dir: string,
    file: string,
    decode: (text: string) => T,
  ): Promise<T | undefined> {
    try {
      return decode(await NodeFSP.readFile(NodePath.join(dir, file), "utf8"));
    } catch {
      unavailable.add(file);
      return undefined;
    }
  }
  const memories = await Promise.all(
    cgroups.map(async (dir) => {
      const [current, high, max, events, pressure, swapCurrent, swapMax] = await Promise.all([
        read(dir, "memory.current", numberOf),
        read(dir, "memory.high", limitOf),
        read(dir, "memory.max", limitOf),
        read(dir, "memory.events", (text) => {
          const fields = Object.fromEntries(
            text
              .trim()
              .split("\n")
              .map((line) => line.split(/\s+/)),
          );
          return {
            high: numberOf(fields.high ?? ""),
            max: numberOf(fields.max ?? ""),
            oom: numberOf(fields.oom ?? ""),
            oomKill: numberOf(fields.oom_kill ?? ""),
          };
        }),
        read(dir, "memory.pressure", pressureOf),
        read(dir, "memory.swap.current", numberOf),
        read(dir, "memory.swap.max", limitOf),
      ]);
      if (current === undefined || high === undefined || max === undefined || events === undefined)
        return null;
      return {
        scope: dir,
        current,
        high,
        max,
        events,
        pressure: pressure ?? null,
        swapCurrent: swapCurrent ?? null,
        swapMax: swapMax ?? null,
      };
    }),
  );
  // The root of a cgroup namespace can omit the memory controller. A readable descendant still
  // supplies evidence; unreadable ancestors stay explicitly unavailable.
  const known = memories.filter((memory) => memory !== null);
  // Usage, limits, hierarchical events and swap stay at the outermost readable
  // scope. A child's limit cannot describe the container's allocation. Events
  // cannot identify which threshold was crossed (memory.events is hierarchical).
  const container = known.at(-1);
  const root = cgroups.at(-1);
  // cgroup.pressure is independently configurable at each level. A quiet or
  // unreadable ancestor cannot erase measured descendant stalls. Keep the
  // strongest actual PSI reading, rather than summing overlapping accounting.
  // https://docs.kernel.org/admin-guide/cgroup-v2.html#core-interface-files
  const pressure =
    known
      .map((memory) => memory.pressure)
      .filter((value) => value !== null)
      .toSorted(
        (a, b) =>
          sustainedPressureLevel(b) - sustainedPressureLevel(a) || b.some.avg10 - a.some.avg10,
      )[0] ?? null;
  const memory =
    container === undefined
      ? null
      : {
          ...container,
          // A descendant fallback proves pressure, not the container's limits.
          max: container.scope === root ? container.max : null,
          high: container.scope === root ? container.high : null,
          pressure,
          swapGrowth: growing(
            container.swapCurrent ?? 0,
            previous?.memory?.scope === container.scope
              ? (previous.memory.swapCurrent ?? undefined)
              : undefined,
          ),
          oomKilledAt:
            growing(
              container.events.oomKill,
              previous?.memory?.scope === container.scope
                ? previous.memory.events.oomKill
                : undefined,
            ) > 0
              ? now
              : previous?.memory?.scope === container.scope &&
                  previous.memory.oomKilledAt != null &&
                  now - previous.memory.oomKilledAt < OOM_NOTICE_DURATION_MS
                ? previous.memory.oomKilledAt
                : null,
          growth: {
            max: growing(
              container.events.max,
              previous?.memory?.scope === container.scope ? previous.memory.events.max : undefined,
            ),
            high: growing(
              container.events.high,
              previous?.memory?.scope === container.scope ? previous.memory.events.high : undefined,
            ),
            oom: growing(
              container.events.oom,
              previous?.memory?.scope === container.scope ? previous.memory.events.oom : undefined,
            ),
            oomKill: growing(
              container.events.oomKill,
              previous?.memory?.scope === container.scope
                ? previous.memory.events.oomKill
                : undefined,
            ),
          },
        };
  const [pidReadings, ioReadings, disk] = await Promise.all([
    Promise.all(
      cgroups.map(async (dir) => {
        const [current, max] = await Promise.all([
          read(dir, "pids.current", numberOf),
          read(dir, "pids.max", limitOf),
        ]);
        return current === undefined || max === undefined ? null : { scope: dir, current, max };
      }),
    ),
    Promise.all(cgroups.map((dir) => read(dir, "io.pressure", pressureOf))),
    NodeFSP.statfs(stateDir)
      .then((stat) => ({ free: stat.bavail * stat.bsize, total: stat.blocks * stat.bsize }))
      .catch(() => {
        unavailable.add("state-disk");
        return null;
      }),
  ]);
  // I/O PSI accounting has the same independent enablement as memory PSI.
  const io =
    ioReadings
      .filter((value) => value !== undefined)
      .toSorted(
        (a, b) =>
          sustainedPressureLevel(b) - sustainedPressureLevel(a) || b.some.avg10 - a.some.avg10,
      )[0] ?? null;
  // Every visible ancestor enforces its own task cap, including sibling work.
  const pids =
    pidReadings
      .filter((value) => value !== null)
      .toSorted(
        (a, b) =>
          (b.max === null ? 0 : b.current / Math.max(1, b.max)) -
          (a.max === null ? 0 : a.current / Math.max(1, a.max)),
      )[0] ?? null;
  if (cgroups.length === 0) unavailable.add("cgroup-v2");
  // memory.high events and swap growth are normal autoscaling evidence. Only a
  // recent observed kill or sustained PSI proves a problem worth interrupting work.
  const resources: Array<MateResourceHealth["resources"][number]> = [];
  const killed = memory?.oomKilledAt != null;
  if (killed || sustainedPressureLevel(memory?.pressure ?? null) >= 1) resources.push("memory");
  if (disk?.free === 0) resources.push("disk");
  if (sustainedPressureLevel(io) >= 1) resources.push("io");
  if (pids !== null && pids.max !== null && pids.current >= pids.max * TASK_LIMIT_WARNING_RATIO)
    resources.push("pids");
  const critical = killed || disk?.free === 0;
  return {
    status: resources.length > 0 ? "strained" : unavailable.size > 0 ? "unknown" : "ok",
    severity: critical ? "critical" : "warning",
    resources,
    memory,
    pids,
    io,
    disk,
    unavailable: [...unavailable].sort(),
  };
}

/** Resolve the process's cgroup2 mount and visible ancestors, including namespaced root '/'. */
export async function ownCgroups(): Promise<ReadonlyArray<string>> {
  const [membership, mounts] = await Promise.all([
    NodeFSP.readFile("/proc/self/cgroup", "utf8"),
    NodeFSP.readFile("/proc/self/mountinfo", "utf8"),
  ]);
  const member = membership
    .split("\n")
    .find((line) => line.startsWith("0::"))
    ?.slice(3);
  const mount = mounts
    .split("\n")
    .find((line) => line.includes(" - cgroup2 "))
    ?.split(" ");
  if (member === undefined || mount === undefined) return [];
  const unescape = (text: string) =>
    text.replace(/\\([0-7]{3})/g, (_, octal: string) => String.fromCharCode(parseInt(octal, 8)));
  const root = unescape(mount[3] ?? "");
  const point = unescape(mount[4] ?? "");
  const suffix = member === "/" ? "" : NodePath.relative(root, member);
  if (suffix.startsWith("..")) throw new Error("Cgroup membership outside visible mount");
  const groups: string[] = [];
  for (let path = NodePath.resolve(point, suffix); ; path = NodePath.dirname(path)) {
    groups.push(path);
    if (path === point) return groups;
    if (path === NodePath.dirname(path)) throw new Error("Cgroup mount boundary missing");
  }
}

/** Kernel wakes and the existing observation cadence publish recovery and OOM expiry. */
export function resourceHealthChanges(
  stateDir: string,
  fixtureGroups?: ReadonlyArray<string>,
  requested?: Stream.Stream<unknown>,
): Stream.Stream<MateResourceHealth> {
  return Stream.unwrap(
    Effect.gen(function* () {
      const platform = yield* HostProcessPlatform;
      const groups = yield* Effect.promise(() =>
        fixtureGroups !== undefined
          ? Promise.resolve(fixtureGroups)
          : platform === "linux"
            ? ownCgroups().catch(() => [])
            : Promise.resolve([]),
      );
      const wake = yield* Queue.sliding<void>(1);
      // Retain the observation cadence for PSI recovery, task limits and OOM expiry.
      if (groups.length > 0)
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.sleep(RESOURCE_HEALTH_SAMPLE_INTERVAL_MS).pipe(
              Effect.andThen(Queue.offer(wake, undefined)),
            ),
          ),
        );
      if (requested !== undefined)
        yield* Effect.forkScoped(Stream.runForEach(requested, () => Queue.offer(wake, undefined)));
      const notify = () => {
        Queue.offerUnsafe(wake, undefined);
      };
      let eventsUnavailable = false;
      const watchers: Array<ReturnType<typeof NodeFS.watch>> = [];
      const files = [
        stateDir,
        ...groups.flatMap((dir) =>
          ["memory.events", "memory.high", "memory.max", "memory.swap.max"].map((file) =>
            NodePath.join(dir, file),
          ),
        ),
      ];
      for (const file of files) {
        try {
          const watcher = NodeFS.watch(file, { recursive: file === stateDir }, notify);
          watcher.on("error", () => {
            eventsUnavailable = true;
            notify();
          });
          watchers.push(watcher);
        } catch {
          eventsUnavailable = true;
        }
      }
      const helperPath = NodePath.join(import.meta.dirname, "health-events");
      const helper =
        fixtureGroups === undefined && platform === "linux" && groups.length > 0
          ? NodeChildProcess.spawn(helperPath, groups, { stdio: ["ignore", "pipe", "pipe"] })
          : null;
      helper?.stdout.on("data", notify);
      helper?.stderr.on("data", () => {
        eventsUnavailable = true;
        notify();
      });
      helper?.on("error", () => {
        eventsUnavailable = true;
        notify();
      });
      helper?.on("exit", () => {
        eventsUnavailable = true;
        notify();
      });
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          for (const watcher of watchers) watcher.close();
          helper?.kill();
        }),
      );
      let previous: MateResourceHealth | undefined;
      notify();
      return Stream.fromQueue(wake).pipe(
        Stream.mapEffect(() =>
          Effect.gen(function* () {
            const now = yield* Clock.currentTimeMillis;
            const value = yield* Effect.promise(() =>
              readResourceHealth(groups, stateDir, previous, now),
            );
            previous = value;
            if (!eventsUnavailable) return value;
            return {
              ...value,
              status: value.status === "ok" ? ("unknown" as const) : value.status,
              unavailable: [...value.unavailable, "kernel-events"],
            };
          }),
        ),
        Stream.changesWith((a, b) => !publishesAgain(a, b)),
      );
    }),
  );
}

/** Publish only changes to the verdict, its notice or read coverage. */
export function publishesAgain(previous: MateResourceHealth, next: MateResourceHealth): boolean {
  const said = (value: MateResourceHealth) => ({
    status: value.status,
    severity: value.status === "strained" ? value.severity : null,
    resources: value.resources,
    unavailable: value.unavailable,
    oomKill: value.memory?.oomKilledAt != null,
  });
  return JSON.stringify(said(previous)) !== JSON.stringify(said(next));
}

/**
 * At most one value a window, the latest: the first leaves at once, and whatever arrives while a
 * window runs is replaced by what follows it, the last leaving when the window ends. A Mate whose
 * kernel wakes it many times a second (memory events at its limit) publishes once a window.
 */
export const latestAtMostEvery =
  (millis: number) =>
  <A, E, R>(self: Stream.Stream<A, E, R>): Stream.Stream<A, E, R> =>
    self.pipe(
      Stream.buffer({ capacity: 1, strategy: "sliding" }),
      Stream.flatMap((value) =>
        Stream.concat(Stream.make(value), Stream.drain(Stream.fromEffect(Effect.sleep(millis)))),
      ),
    );
