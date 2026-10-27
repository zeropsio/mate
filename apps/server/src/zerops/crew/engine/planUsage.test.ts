import type { ServerProviderUsageLimits, ServerProviderUsageWindow } from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";

import { CrewWorld, OPTIONS, OTHER, home, newTask, reader } from "./crewDecideFixture.ts";
import { planUsagePercent } from "./planUsage.ts";

const NOW = Date.parse("2026-10-11T08:20:00.000Z");

const window = (
  id: string,
  usedPercent: number,
  resetsAt = "2026-10-11T11:00:00.000Z",
): ServerProviderUsageWindow => ({
  id,
  kind: id === "five_hour" ? "session" : "weekly",
  label: id,
  usedPercent,
  resetsAt,
});

const usage = (
  windows: ReadonlyArray<ServerProviderUsageWindow>,
  unavailable?: ServerProviderUsageLimits["unavailable"],
): ServerProviderUsageLimits => ({
  checkedAt: "2026-10-11T08:19:48.000Z",
  windows,
  ...(unavailable === undefined ? {} : { unavailable }),
});

/** The account's windows as the plan read in the H10 run: Session 23 %, Weekly 39 %. */
const PLAN_23_39 = usage([
  window("five_hour", 23),
  window("seven_day", 39, "2026-10-14T15:00:00.000Z"),
  window("seven_day_fable", 0, "2026-10-14T15:00:00.000Z"),
]);

interface Row {
  readonly name: string;
  /** A reading the crew kept from before, as a restart leaves it. */
  readonly earlier?: number;
  readonly usage: ServerProviderUsageLimits | undefined;
  readonly run: "running" | "paused";
}

const rows: ReadonlyArray<Row> = [
  { name: "the plan at 23 % / 39 %", usage: PLAN_23_39, run: "running" },
  {
    name: "the plan at 23 % / 39 % after a reading of 100 % kept from before",
    earlier: 100,
    usage: PLAN_23_39,
    run: "running",
  },
  { name: "a window at 79 %", usage: usage([window("seven_day", 79)]), run: "running" },
  {
    name: "a window at 85 % that has since reset",
    usage: usage([window("five_hour", 85, "2026-10-11T08:00:00.000Z"), window("seven_day", 39)]),
    run: "running",
  },
  {
    name: "an agent that reports no usage, after a reading of 100 % kept from before",
    earlier: 100,
    usage: undefined,
    run: "running",
  },
  {
    name: "an account that can never report usage",
    earlier: 100,
    usage: usage([], { reason: "unsupported" }),
    run: "running",
  },
  {
    name: "a window at 80 %",
    usage: usage([window("five_hour", 23), window("seven_day", 80)]),
    run: "paused",
  },
  { name: "a window at 85 %", usage: usage([window("five_hour", 85)]), run: "paused" },
];

describe("the crew's usage stop reads the plan's windows", () => {
  it.each(rows)(
    "a crew working on its own keeps going while the plan is under its limit: $name",
    ({ earlier, usage: limits, run }) => {
      const w = new CrewWorld();
      w.apply(home(reader("reviewer")));
      if (earlier !== undefined) {
        w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: earlier });
      }
      w.tell({ _tag: "Gauge", login: "claudeAgent", usagePercent: planUsagePercent(limits, NOW) });
      w.press({ _tag: "start", ...OPTIONS, stopAtUsagePercent: 80 }, OTHER);
      w.quiet();
      newTask(w, "reviewer", "Read it");
      expect([w.state.run?.state, w.state.run?.reason ?? null]).toEqual(
        run === "running" ? ["running", null] : ["paused", "usage"],
      );
    },
  );
});
