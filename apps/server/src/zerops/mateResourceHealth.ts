// @effect-diagnostics nodeBuiltinImport:off -- procfs, statfs and kernel notification boundary.
import { HostProcessPlatform } from "@t3tools/shared/hostProcess";
import * as NodeFSP from "node:fs/promises";
import * as NodeFS from "node:fs";
import * as NodeChildProcess from "node:child_process";
import * as NodePath from "node:path";
import type { MateResourceHealth, ResourcePressure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import * as Queue from "effect/Queue";

const numberOf = (text: string): number => {
  if (!/^\d+$/.test(text.trim())) throw new Error("Invalid kernel counter");
  const value = Number(text.trim());
  if (!Number.isSafeInteger(value)) throw new Error("Kernel counter exceeds wire precision");
  return value;
};
const limitOf = (text: string) => (text.trim() === "max" ? null : numberOf(text));
function pressureOf(text: string): ResourcePressure {
  const lines = new Map(
    text
      .trim()
      .split("\n")
      .map((line) => {
        const [kind, ...fields] = line.split(/\s+/);
        const values = Object.fromEntries(fields.map((field) => field.split("=")));
        const avg10 = Number(values.avg10);
        if (!Number.isFinite(avg10) || avg10 < 0 || avg10 > 100 || values.total === undefined)
          throw new Error("Invalid PSI");
        return [kind, { avg10, total: numberOf(values.total) }] as const;
      }),
  );
  const some = lines.get("some");
  if (some === undefined) throw new Error("Missing PSI some");
  return { some, full: lines.get("full") ?? null };
}
const growing = (value: number, previous: number | undefined) =>
  previous === undefined ? 0 : Math.max(0, value - previous);
const stalled = (psi: ResourcePressure | null) => psi !== null && psi.some.avg10 > 0;

/** Read the visible hierarchy: ancestor limits include sibling/container work, not only Mate's unit. */
export async function readResourceHealth(
  cgroups: ReadonlyArray<string>,
  stateDir: string,
  previous?: MateResourceHealth,
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
  const tightest = known.toSorted(
    (a, b) =>
      Math.min(a.high ?? Infinity, a.max ?? Infinity) -
      Math.min(b.high ?? Infinity, b.max ?? Infinity),
  )[0];
  const memory =
    tightest === undefined
      ? null
      : {
          ...tightest,
          growth: {
            high: growing(
              tightest.events.high,
              previous?.memory?.scope === tightest.scope ? previous.memory.events.high : undefined,
            ),
            oom: growing(
              tightest.events.oom,
              previous?.memory?.scope === tightest.scope ? previous.memory.events.oom : undefined,
            ),
            oomKill: growing(
              tightest.events.oomKill,
              previous?.memory?.scope === tightest.scope
                ? previous.memory.events.oomKill
                : undefined,
            ),
          },
        };
  const root = cgroups.at(-1);
  const [cpu, io, disk] = await Promise.all([
    root === undefined
      ? null
      : read(root, "cpu.pressure", pressureOf).then((value) => value ?? null),
    root === undefined
      ? null
      : read(root, "io.pressure", pressureOf).then((value) => value ?? null),
    NodeFSP.statfs(stateDir)
      .then((stat) => ({ free: stat.bavail * stat.bsize, total: stat.blocks * stat.bsize }))
      .catch(() => {
        unavailable.add("state-disk");
        return null;
      }),
  ]);
  if (cgroups.length === 0) unavailable.add("cgroup-v2");
  const resources: Array<"memory" | "disk" | "cpu"> = [];
  if (
    memory !== null &&
    ((memory.high !== null && memory.current >= memory.high) ||
      (memory.max !== null && memory.current >= memory.max) ||
      memory.growth.high > 0 ||
      memory.growth.oom > 0 ||
      memory.growth.oomKill > 0 ||
      stalled(memory.pressure))
  )
    resources.push("memory");
  if (disk?.free === 0 || stalled(io)) resources.push("disk");
  if (stalled(cpu)) resources.push("cpu");
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

/** No periodic sampler: initial evidence, kernel notifications, PSI wakes and state filesystem changes. */
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
          Effect.promise(async () => {
            const value = await readResourceHealth(groups, stateDir, previous);
            previous = value;
            if (!eventsUnavailable) return value;
            return {
              ...value,
              status: value.status === "ok" ? ("unknown" as const) : value.status,
              unavailable: [...value.unavailable, "kernel-events"],
            };
          }),
        ),
        Stream.changesWith((a, b) => {
          const key = (value: MateResourceHealth) =>
            value.status === "strained"
              ? value
              : {
                  status: value.status,
                  unavailable: value.unavailable,
                  high: value.memory?.high,
                  max: value.memory?.max,
                  swapMax: value.memory?.swapMax,
                };
          return JSON.stringify(key(a)) === JSON.stringify(key(b));
        }),
      );
    }),
  );
}
