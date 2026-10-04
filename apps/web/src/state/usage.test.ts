import type { EnvironmentConnectionPhase } from "@t3tools/client-runtime/connection";
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";
import { describe, expect, it } from "vite-plus/test";

import { createUsageByWindowAtomFamily } from "./usage";

const OPEN = EnvironmentId.make("open-mate");
const PARKED = EnvironmentId.make("parked-mate");
const WINDOW = JSON.stringify({
  sinceDay: "2026-10-01",
  untilDay: "2026-10-03",
  timeZone: "Europe/Prague",
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
