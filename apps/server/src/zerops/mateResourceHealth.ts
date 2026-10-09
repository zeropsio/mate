// @effect-diagnostics nodeBuiltinImport:off -- procfs, statfs and kernel notification boundary.
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import {
  cpuWarningQuote,
  sustainedPressureLevel,
  type MateResourceHealth,
  type ResourcePressure,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";
import { numberOf, limitOf, pressureOf } from "./mateResourceEvidence.ts";
import { makeCpuSampler, CPU_SAMPLE_WINDOW_USEC } from "./mateCpuHealth.ts";

const growing = (value: number, previous: number | undefined) =>
  previous === undefined ? 0 : Math.max(0, value - previous);
// PSI avg10 is the percentage of recent time tasks stalled on this resource. Any
// positive value is measured stall time, not an allocation/usage threshold.
// https://docs.kernel.org/accounting/psi.html
const stalled = (psi: ResourcePressure | null) =>
  psi !== null &&
  (psi.some.avg10 > 0 || (psi.full?.avg10 ?? 0) > 0 || sustainedPressureLevel(psi) >= 1);

/** Read the visible hierarchy: ancestor limits include sibling/container work, not only Mate's unit. */
export async function readResourceHealth(
  cgroups: ReadonlyArray<string>,
  stateDir: string,
  previous?: MateResourceHealth,
  sampleCpu = makeCpuSampler(cgroups),
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
  const [cpuRead, ioReadings, disk] = await Promise.all([
    sampleCpu(),
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
  const cpu = cpuRead.cpu;
  for (const file of cpuRead.unavailable) unavailable.add(file);
  if (cgroups.length === 0) unavailable.add("cgroup-v2");
  // memory.high triggers reclaim/throttling; memory.max is the hard limit. Usage
  // above either alone proves no stall. New high/max events mean active reclaim or
  // limit hits; OOM events mean failed allocation, swap growth means active swapping.
  // Historical counters and static swap occupancy do not establish current strain.
  // https://docs.kernel.org/admin-guide/cgroup-v2.html#memory-interface-files
  const resources: Array<"memory" | "disk" | "io" | "cpu"> = [];
  if (
    memory !== null &&
    (memory.growth.high > 0 ||
      memory.growth.max > 0 ||
      memory.swapGrowth > 0 ||
      memory.growth.oom > 0 ||
      memory.growth.oomKill > 0 ||
      stalled(memory.pressure))
  )
    resources.push("memory");
  if (disk?.free === 0) resources.push("disk");
  if (stalled(io)) resources.push("io");
  if (cpuRead.strained) resources.push("cpu");
  const critical =
    memory !== null &&
    (memory.growth.oom > 0 ||
      memory.growth.oomKill > 0 ||
      (resources.includes("memory") &&
        memory.swapMax !== null &&
        memory.swapMax > 0 &&
        memory.swapCurrent !== null &&
        memory.swapCurrent >= memory.swapMax));
  return {
    status: resources.length > 0 ? "strained" : unavailable.size > 0 ? "unknown" : "ok",
    severity: critical || disk?.free === 0 ? "critical" : "warning",
    resources,
    memory,
    cpu,
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

/** Kernel wakes plus a bounded current CPU window; quiet windows must also publish recovery. */
export function resourceHealthChanges(
  stateDir: string,
  fixtureGroups?: ReadonlyArray<string>,
  requested?: Stream.Stream<unknown>,
  cpuSampler?: ReturnType<typeof makeCpuSampler>,
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
      const sampleCpu = cpuSampler ?? makeCpuSampler(groups);
      let cpuDue = true;
      let cpuRead: Awaited<ReturnType<typeof sampleCpu>> | undefined;
      // PSI permits unprivileged notifications once per two-second tracking window. This is
      // observation cadence, not a timeout verdict: measured stalls and growth establish pressure.
      if (groups.length > 0)
        yield* Effect.forkScoped(
          Effect.forever(
            Effect.sleep(CPU_SAMPLE_WINDOW_USEC / 1000).pipe(
              Effect.andThen(
                Effect.sync(() => {
                  cpuDue = true;
                }),
              ),
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
      let observed: MateResourceHealth | undefined;
      notify();
      return Stream.fromQueue(wake).pipe(
        Stream.mapEffect(() =>
          Effect.promise(async () => {
            const observationDue = cpuDue;
            // Consume the tick once, before any await. A tick arriving during this
            // read remains pending for the next read, for both CPU and memory.
            if (observationDue) {
              cpuDue = false;
              previous = observed;
            }
            const value = await readResourceHealth(groups, stateDir, previous, async () => {
              // Requests and unrelated filesystem changes cannot replace the current CPU
              // window with a tiny interval or extend it beyond the declared cadence.
              if (observationDue || cpuRead === undefined) {
                cpuRead = await sampleCpu();
              }
              return cpuRead;
            });
            // Requests and unrelated wakes do not consume the memory/swap window.
            // The shared cadence observes swap growth and publishes quiet recovery.
            if (observationDue) {
              observed = value;
              previous ??= value;
            }
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

/**
 * Whether a sample says something the last published one did not: the warning itself (its status,
 * severity, strained resources, what could not be read, the RAM and swap caps) or a number it
 * quotes. Only the CPU warning quotes numbers, so a Mate under CPU strain publishes each window
 * whose quote moved and a Mate strained otherwise publishes only when its warning changes.
 */
export function publishesAgain(previous: MateResourceHealth, next: MateResourceHealth): boolean {
  const said = (value: MateResourceHealth) => {
    const window = value.cpu?.window;
    return {
      status: value.status,
      severity: value.status === "strained" ? value.severity : null,
      resources: value.resources,
      unavailable: value.unavailable,
      high: value.memory?.high,
      max: value.memory?.max,
      swapMax: value.memory?.swapMax,
      quote: value.resources.includes("cpu") && window != null ? cpuWarningQuote(window) : null,
    };
  };
  return JSON.stringify(said(previous)) !== JSON.stringify(said(next));
}
