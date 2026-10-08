// @vitest-environment happy-dom
import type { ResourceTelemetryProcess, ResourceTelemetrySnapshot } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vite-plus/test";
import { ResourceTelemetryDiagnostics } from "./ResourceTelemetryDiagnostics";
const reads = vi.hoisted(() => ({
  error: null as string | null,
  pending: false,
  snapshot: null as ResourceTelemetrySnapshot | null,
}));
vi.mock("../../state/environments", () => ({ usePrimaryEnvironment: () => null }));
vi.mock("../../lib/resourceTelemetryState", () => ({
  useResourceTelemetry: () => ({
    data: reads.snapshot,
    error: reads.error,
    isPending: reads.pending,
    refresh: () => {},
    retry: async () => {},
  }),
  useResourceTelemetryHistory: () => ({
    data: null,
    error: reads.error,
    isPending: reads.pending,
    refresh: () => {},
  }),
}));
function sections() {
  const root = document.createElement("div");
  root.innerHTML = renderToStaticMarkup(<ResourceTelemetryDiagnostics />);
  return new Map(
    Array.from(root.querySelectorAll("section"), (section) => [
      section.querySelector("h2")?.textContent,
      section,
    ]),
  );
}
it.each([
  { name: "failed", error: "Telemetry refused.", pending: false },
  { name: "loading", error: null, pending: true },
])("each telemetry collection reports $name within its own section", ({ error, pending }) => {
  Object.assign(reads, { error, pending, snapshot: null });
  const rendered = sections();
  for (const [title, messages, empty] of [
    [
      "Resource timeline",
      [error ?? "Loading resource history...", error ?? "Loading resource history..."],
      "No retained process samples in this window.",
    ],
    [
      "Live process tree",
      [error ?? "Loading live processes..."],
      "Waiting for the native process monitor",
    ],
    [
      "Instrumented application I/O",
      [error ?? "Loading application I/O..."],
      "No instrumented application I/O has been recorded yet.",
    ],
  ] as const) {
    const section = rendered.get(title)!;
    expect(
      Array.from(section.querySelectorAll('[role="status"]'), (status) => status.textContent),
    ).toEqual(messages);
    expect(section.textContent).not.toContain(empty);
  }
});
const now = DateTime.makeUnsafe("2026-10-08T12:00:00Z");
const process: ResourceTelemetryProcess = {
  identity: { pid: 101, startTimeMs: 10 },
  ppid: 0,
  childPids: [],
  depth: 0,
  name: "retained-worker",
  command: "retained-worker",
  status: "Running",
  category: "server",
  cpuPercent: 0,
  cpuTimeMs: 0,
  residentBytes: 1024,
  peakResidentBytes: 1024,
  virtualBytes: 2048,
  ioReadBytes: 0,
  ioWriteBytes: 0,
  ioReadBytesPerSecond: 0,
  ioWriteBytesPerSecond: 0,
  ioSemantics: "storage",
  runTimeMs: 1000,
  firstSeenAt: now,
  lastSeenAt: now,
};
const aggregate = {
  processCount: 0,
  currentCpuPercent: 0,
  cpuTimeMs: 0,
  currentRssBytes: 0,
  peakRssBytes: 0,
  ioReadBytes: 0,
  ioWriteBytes: 0,
  ioReadBytesPerSecond: 0,
  ioWriteBytesPerSecond: 0,
  processStarts: 0,
  processExits: 0,
};
function snapshot(
  processes: ReadonlyArray<ResourceTelemetryProcess>,
  failed: boolean,
): ResourceTelemetrySnapshot {
  return {
    readAt: now,
    sampleIntervalMs: 1000,
    processes,
    groups: { backend: aggregate, electron: aggregate, monitor: aggregate, allT3: aggregate },
    power: {
      source: "unknown",
      idle: "unknown",
      idleSeconds: null,
      locked: "unknown",
      suspended: false,
      onBattery: "unknown",
      lowPowerMode: "unknown",
      thermalState: "unknown",
      stale: false,
      updatedAt: now,
    },
    speedLimitPercent: Option.none(),
    attribution: { readAt: now, entries: [] },
    health: {
      native: {
        status: failed ? "degraded" : "healthy",
        lastSampleAt: Option.some(now),
        lastError: failed ? Option.some("Native collector stopped.") : Option.none(),
      },
      desktop: { status: "unavailable", lastSampleAt: Option.none(), lastError: Option.none() },
      sidecarVersion: Option.none(),
      sidecarPid: Option.none(),
      restartCount: 0,
      collectionDurationMicros: 0,
      scannedProcessCount: 0,
      retainedProcessCount: processes.length,
      inaccessibleProcessCount: 0,
    },
  };
}
it.each([
  { name: "empty collector failure", processes: [], failed: true },
  { name: "retained collector failure", processes: [process], failed: true },
  { name: "healthy empty snapshot", processes: [], failed: false },
])("live tree presents $name from a successful delivered snapshot", ({ processes, failed }) => {
  Object.assign(reads, { error: null, pending: false, snapshot: snapshot(processes, failed) });
  const rendered = sections();
  const tree = rendered.get("Live process tree")!;
  expect(
    Array.from(tree.querySelectorAll('[role="status"]'), (status) => status.textContent),
  ).toEqual(
    failed
      ? [
          processes.length
            ? "Native collector stopped. Showing last-known data."
            : "Native collector stopped.",
        ]
      : [],
  );
  expect(tree.textContent?.includes("Waiting for the native process monitor")).toBe(!failed);
  if (processes.length) expect(tree.textContent).toContain("retained-worker");
  // Native collection does not own application attribution.
  expect(rendered.get("Instrumented application I/O")?.textContent).toContain(
    "No instrumented application I/O has been recorded yet.",
  );
});
