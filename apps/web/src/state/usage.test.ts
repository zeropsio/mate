import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import type { Known } from "@t3tools/client-runtime/zerops/knowledge";
import { EnvironmentId, UsageDay, type UsageSummary } from "@t3tools/contracts";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { createUsageWindowReadAtoms } from "./usage";

const report = (summary: UsageSummary): Known<UsageSummary> => ({
  state: "known",
  value: summary,
  asOf: { ordinal: 1, atMs: 1 },
  coverage: "complete",
  freshness: { kind: "settled" },
});
const OPEN = EnvironmentId.make("open-mate");
const PARKED = EnvironmentId.make("parked-mate");
const WINDOW = JSON.stringify({
  input: {
    sinceDay: UsageDay.make("2026-10-01"),
    untilDay: UsageDay.make("2026-10-03"),
    timeZone: "Europe/Prague",
  },
});

const presentation = (label: string, phase: EnvironmentConnectionPhase) => ({
  entry: { target: { label } },
  connection: { phase },
});

describe("usage by window", () => {
  it("asks only the Mates it holds a socket to", () => {
    const asked: EnvironmentId[] = [];
    const usageByWindow = createUsageWindowReadAtoms({
      presentationsAtom: Atom.make(
        new Map([
          [OPEN, presentation("Fen", "connected")],
          [PARKED, presentation("Ida", "available")],
        ]),
      ),
      retainedUsageSummary: () => Atom.make({ state: "unread" as const, waitingFor: null }),
      usageSummary: ({ environmentId }) => {
        asked.push(environmentId);
        return Atom.make({ state: "unread" as const, waitingFor: null });
      },
    });
    const registry = AtomRegistry.make();

    const statuses = registry.get(usageByWindow(WINDOW));

    expect(statuses.map((status) => [status.environmentId, status.label])).toEqual([[OPEN, "Fen"]]);
    expect(asked).toEqual([OPEN]);
    registry.dispose();
  });
  it("keeps a disconnected Mate's last report visibly stale without waking it", () => {
    const summary: UsageSummary = {
      contractVersion: 1,
      readAt: "2026-10-03T00:00:00.000Z",
      timeZone: "UTC",
      sinceDay: UsageDay.make("2026-10-01"),
      untilDay: UsageDay.make("2026-10-03"),
      buckets: [],
      sources: [],
      pricing: { status: "fresh", source: "litellm", fetchedAt: null, knownModels: 0 },
      scanDurationMs: 0,
    };
    const lastReport: Known<UsageSummary> = {
      state: "known",
      value: summary,
      asOf: { ordinal: 1, atMs: 1 },
      coverage: "complete",
      freshness: { kind: "settled" },
    };
    const usageByWindow = createUsageWindowReadAtoms({
      presentationsAtom: Atom.make(new Map([[PARKED, presentation("Ida", "available")]])),
      retainedUsageSummary: () => Atom.make(lastReport),
      usageSummary: () => {
        throw new Error("A parked Mate must not be woken.");
      },
    });
    const registry = AtomRegistry.make();
    expect(registry.get(usageByWindow(WINDOW))).toMatchObject([
      { environmentId: PARKED, summary, isStale: true, isPending: false },
    ]);
    registry.dispose();
  });
});

it("retains a known snapshot during reconnect and drops it after blocked access", () => {
  const presentations = Atom.make(new Map([[OPEN, presentation("Fen", "connected")]]));
  const summary = {
    contractVersion: 1,
    readAt: "2026-10-07T12:00:00Z",
    timeZone: "UTC",
    sinceDay: UsageDay.make("2026-10-01"),
    untilDay: UsageDay.make("2026-10-03"),
    buckets: [],
    sources: [],
    pricing: { status: "fresh" as const, source: "test", fetchedAt: null, knownModels: 0 },
    scanDurationMs: 0,
  };
  const byWindow = createUsageWindowReadAtoms({
    presentationsAtom: presentations,
    retainedUsageSummary: () => Atom.make(report(summary)),
    usageSummary: () => Atom.make(report(summary)),
  });
  const registry = AtomRegistry.make();
  const atom = byWindow(WINDOW);
  registry.mount(atom);
  expect(registry.get(atom)[0]?.summary).toEqual(summary);
  registry.set(presentations, new Map([[OPEN, presentation("Fen", "reconnecting")]]));
  expect(registry.get(atom)[0]).toMatchObject({ summary, isStale: true });
  registry.set(presentations, new Map([[OPEN, presentation("Fen", "error")]]));
  expect(registry.get(atom)).toEqual([]);
  registry.dispose();
});

it("excludes warm connections outside the declared organization", () => {
  const asked: EnvironmentId[] = [];
  const byWindow = createUsageWindowReadAtoms({
    presentationsAtom: Atom.make(
      new Map([
        [OPEN, presentation("Fen", "connected")],
        [PARKED, presentation("Other org", "connected")],
      ]),
    ),
    retainedUsageSummary: () => Atom.make({ state: "unread" as const, waitingFor: null }),
    usageSummary: ({ environmentId }) => {
      asked.push(environmentId);
      return Atom.make({ state: "unread" as const, waitingFor: null });
    },
  });
  const registry = AtomRegistry.make();
  registry.get(byWindow(JSON.stringify({ ...JSON.parse(WINDOW), permitted: [OPEN] })));
  expect(asked).toEqual([OPEN]);
  registry.dispose();
});
