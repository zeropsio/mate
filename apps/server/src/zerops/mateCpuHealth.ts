// @effect-diagnostics nodeBuiltinImport:off -- Linux cgroup/procfs evidence boundary.
import { sustainedPressureLevel, type MateResourceHealth } from "@t3tools/contracts";
import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import * as NodeChildProcess from "node:child_process";
import { numberOf, pressureOf } from "./mateResourceEvidence.ts";

// https://docs.kernel.org/accounting/psi.html: unprivileged PSI tracking windows are
// multiples of two seconds. Use its shortest window for fresh observations and recovery.
export const CPU_SAMPLE_WINDOW_USEC = 2_000_000;

function cpuCount(text: string) {
  const ranges = text.trim().split(",");
  let cpus = 0;
  let previousEnd = -1;
  for (const range of ranges) {
    if (!/^\d+(-\d+)?$/.test(range)) throw new Error("Invalid cpuset");
    const [startText, endText = startText] = range.split("-");
    const start = numberOf(startText!);
    const end = numberOf(endText!);
    if (end < start || start <= previousEnd) throw new Error("Invalid cpuset range");
    cpus += end - start + 1;
    previousEnd = end;
  }
  if (cpus === 0) throw new Error("Empty cpuset");
  return cpus;
}

interface ProcessSample {
  readonly pid: number;
  readonly start: string;
  readonly ticks: number;
  readonly name: string;
  readonly group: string;
}

async function processes(proc: string): Promise<ProcessSample[]> {
  const ids = await NodeFSP.readdir(proc);
  return (
    await Promise.all(
      ids
        .filter((id) => /^\d+$/.test(id))
        .map(async (id) => {
          try {
            // stat supplies process-wide user/system CPU (all threads). starttime fences PID reuse.
            const [stat, membership] = await Promise.all([
              NodeFSP.readFile(NodePath.join(proc, id, "stat"), "utf8"),
              NodeFSP.readFile(NodePath.join(proc, id, "cgroup"), "utf8"),
            ]);
            const end = stat.lastIndexOf(")");
            const fields = stat
              .slice(end + 2)
              .trim()
              .split(/\s+/);
            const group = membership
              .split("\n")
              .find((line) => line.startsWith("0::"))
              ?.slice(3);
            if (end < 0 || group === undefined || fields[19] === undefined) return null;
            return {
              pid: numberOf(id),
              start: fields[19],
              ticks: numberOf(fields[11]!) + numberOf(fields[12]!),
              name: stat.slice(stat.indexOf("(") + 1, end),
              group,
            };
          } catch {
            return null;
          } // A process that exited supplies no attributable current usage.
        }),
    )
  ).filter((value) => value !== null);
}

const clockTicks = () =>
  new Promise<number | null>((resolve) => {
    NodeChildProcess.execFile("getconf", ["CLK_TCK"], (error, stdout) => {
      try {
        resolve(error ? null : numberOf(stdout) || null);
      } catch {
        resolve(null);
      }
    });
  });

export function makeCpuSampler(
  groups: ReadonlyArray<string>,
  options: {
    readonly nowUsec?: () => number;
    readonly procRoot?: string;
    readonly ticksPerSecond?: number;
  } = {},
) {
  const nowUsec = options.nowUsec ?? (() => Number(process.hrtime.bigint() / 1000n));
  const proc = options.procRoot ?? "/proc";
  let ticks: Promise<number | null> | undefined;
  type Snapshot = {
    scope: string;
    at: number;
    usage: number;
    throttled: number;
    capacity: number;
    some: number;
    full: number | null;
    processes: ReadonlyArray<ProcessSample>;
  };
  type Window = NonNullable<NonNullable<MateResourceHealth["cpu"]>["window"]>;
  let previous = new Map<string, Snapshot>();
  return async (): Promise<{
    cpu: MateResourceHealth["cpu"];
    strained: boolean;
    unavailable: string[];
  }> => {
    if (groups.length === 0) return { cpu: null, strained: false, unavailable: ["cpu-allocation"] };
    try {
      const root = groups.at(-1)!;
      const rootCpus = cpuCount(
        await NodeFSP.readFile(NodePath.join(root, "cpuset.cpus.effective"), "utf8"),
      );
      const allocations = await Promise.all(
        groups.map(async (scope) => {
          const optionalFile = (file: string) =>
            NodeFSP.readFile(NodePath.join(scope, file), "utf8").catch((error: unknown) => {
              if (
                scope !== root &&
                error instanceof Error &&
                "code" in error &&
                error.code === "ENOENT"
              )
                return null;
              throw error;
            });
          // Undelegated child controllers may omit cpu.max/cpuset. Only an absent file
          // inherits the ancestor allocation; malformed or refused evidence fails closed.
          const [quota, cpuset] = await Promise.all([
            optionalFile("cpu.max"),
            optionalFile("cpuset.cpus.effective"),
          ]);
          let quotaCpus = Infinity;
          if (quota !== null) {
            const [max, period] = quota.trim().split(/\s+/);
            const periodUsec = numberOf(period!);
            if (periodUsec === 0) throw new Error("Zero CPU period");
            quotaCpus = max === "max" ? Infinity : numberOf(max!) / periodUsec;
          }
          const capacity = Math.min(cpuset?.trim() ? cpuCount(cpuset) : rootCpus, quotaCpus);
          // These are the visible CPU ceiling, not guaranteed throughput: cpu.weight is a
          // relative share and cannot be turned into cores without the host's sibling budgets.
          if (capacity <= 0) throw new Error("Zero CPU capacity");
          return { scope, capacity };
        }),
      );
      const [readings, consumers] = await Promise.all([
        Promise.all(
          allocations.map(async (allocation) => {
            const [statText, psiText] = await Promise.all([
              NodeFSP.readFile(NodePath.join(allocation.scope, "cpu.stat"), "utf8"),
              NodeFSP.readFile(NodePath.join(allocation.scope, "cpu.pressure"), "utf8"),
            ]);
            const stat = Object.fromEntries(
              statText
                .trim()
                .split("\n")
                .map((line) => line.split(/\s+/)),
            );
            const pressure = pressureOf(psiText);
            return {
              ...allocation,
              pressure,
              usage: numberOf(stat.usage_usec!),
              throttled: stat.nr_throttled === undefined ? 0 : numberOf(stat.nr_throttled),
              some: pressure.some.total,
              full: pressure.full?.total ?? null,
            };
          }),
        ),
        processes(proc).catch(() => []),
      ]);
      const at = nowUsec();
      const evaluated = readings.map(({ pressure, ...reading }) => {
        const current: Snapshot = { ...reading, at, processes: consumers };
        const before = previous.get(current.scope);
        const elapsedUsec = before === undefined ? 0 : current.at - before.at;
        let window: Window | null = null;
        if (
          before !== undefined &&
          before.capacity === current.capacity &&
          elapsedUsec > 0 &&
          current.usage >= before.usage &&
          current.some >= before.some &&
          current.throttled >= before.throttled &&
          !(current.full !== null && before.full !== null && current.full < before.full)
        ) {
          const usageUsec = current.usage - before.usage;
          const someUsec = current.some - before.some;
          // PSI "some" is wall time with at least one runnable task waiting, not lost CPU
          // percentage. Usage + some is a LOWER BOUND on runnable CPU demand: at least
          // one CPU is owed per stalled microsecond. Warn only when that demand reaches
          // this cgroup's cpuset/quota budget, including fractional quotas. Neither an
          // avg10 tail nor one throttled period establishes sustained exhaustion.
          window = {
            scope: current.scope,
            elapsedUsec,
            usageUsec,
            someUsec,
            fullUsec:
              current.full !== null && before.full !== null ? current.full - before.full : null,
            capacityCpus: current.capacity,
            throttledPeriods: current.throttled - before.throttled,
            saturated: someUsec > 0 && usageUsec + someUsec >= current.capacity * elapsedUsec,
            consumer: null,
          };
        }
        return { pressure, current, before, window };
      });
      previous = new Map(evaluated.map(({ current }) => [current.scope, current]));
      // Choose notice-eligible evidence before collapsing the hierarchy: a brief parent
      // spike cannot hide sustained child stalls. Equal eligibility keeps container-wide
      // attribution; raw current saturation and allocation remain the fallbacks.
      const containerFirst = evaluated.toReversed();
      const chosen =
        containerFirst.find(
          ({ window, pressure }) => window?.saturated && sustainedPressureLevel(pressure) >= 1,
        ) ??
        containerFirst.find(({ window }) => window?.saturated) ??
        containerFirst.toSorted((a, b) => a.current.capacity - b.current.capacity)[0]!;
      const { current, before, pressure, window } = chosen;
      const unavailable = evaluated.some(({ window }) => window === null) ? ["cpu-window"] : [];
      if (window === null)
        return { cpu: { ...pressure, window: null }, strained: false, unavailable };
      const { saturated, elapsedUsec } = window;
      let consumer: NonNullable<NonNullable<MateResourceHealth["cpu"]>["window"]>["consumer"] =
        null;
      if (saturated && before !== undefined) {
        ticks ??=
          options.ticksPerSecond === undefined
            ? clockTicks()
            : Promise.resolve(options.ticksPerSecond);
        const rate = await ticks;
        const old = new Map(before.processes.map((process) => [process.pid, process]));
        const scope = NodePath.relative(root, current.scope);
        const candidates = consumers
          .flatMap((process) => {
            const prior = old.get(process.pid);
            if (
              prior?.start !== process.start ||
              prior.name !== process.name ||
              prior.group !== process.group ||
              process.ticks <= prior.ticks ||
              (scope !== "" &&
                process.group !== `/${scope}` &&
                !process.group.startsWith(`/${scope}/`))
            )
              return [];
            return [{ process, ticks: process.ticks - prior.ticks }];
          })
          .toSorted((a, b) => b.ticks - a.ticks);
        const top = candidates[0];
        if (rate !== null && rate > 0 && top !== undefined) {
          const executable = await NodeFSP.readlink(
            NodePath.join(proc, String(top.process.pid), "exe"),
          )
            .then((path) => NodePath.basename(path))
            .catch(() => top.process.name);
          // Node's generic MainThread name needs its executable; npm and provider CLIs
          // set a useful comm themselves, which must survive the node executable lookup.
          const command = top.process.name === "MainThread" ? executable : top.process.name;
          const service = top.process.group.split("/").at(-1);
          const name =
            service === "zerops@mate.service"
              ? `Mate (${command})`
              : service === "zerops@vscode.service"
                ? `code-server (${command})`
                : command;
          consumer = {
            pid: top.process.pid,
            name,
            cpuCores: top.ticks / rate / (elapsedUsec / 1_000_000),
          };
        }
      }
      return {
        cpu: { ...pressure, window: { ...window, consumer } },
        strained: saturated,
        unavailable,
      };
    } catch {
      previous = new Map();
      return { cpu: null, strained: false, unavailable: ["cpu-allocation"] };
    }
  };
}
