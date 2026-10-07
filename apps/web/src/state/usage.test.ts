import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { EnvironmentId, UsageDay } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { createUsageByWindowAtomFamily } from "./usage";

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
    const usageByWindow = createUsageByWindowAtomFamily({
      presentationsAtom: Atom.make(
        new Map([
          [OPEN, presentation("Fen", "connected")],
          [PARKED, presentation("Ida", "available")],
        ]),
      ),
      usageSummary: ({ environmentId }) => {
        asked.push(environmentId);
        return Atom.make(AsyncResult.initial(true));
      },
    });
    const registry = AtomRegistry.make();

    const statuses = registry.get(usageByWindow(WINDOW));

    expect(statuses.map((status) => [status.environmentId, status.label])).toEqual([[OPEN, "Fen"]]);
    expect(asked).toEqual([OPEN]);
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
  const byWindow = createUsageByWindowAtomFamily({
    presentationsAtom: presentations,
    usageSummary: () => Atom.make(AsyncResult.success(summary)),
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
  const byWindow = createUsageByWindowAtomFamily({
    presentationsAtom: Atom.make(
      new Map([
        [OPEN, presentation("Fen", "connected")],
        [PARKED, presentation("Other org", "connected")],
      ]),
    ),
    usageSummary: ({ environmentId }) => {
      asked.push(environmentId);
      return Atom.make(AsyncResult.initial(true));
    },
  });
  const registry = AtomRegistry.make();
  registry.get(byWindow(JSON.stringify({ ...JSON.parse(WINDOW), permitted: [OPEN] })));
  expect(asked).toEqual([OPEN]);
  registry.dispose();
});
