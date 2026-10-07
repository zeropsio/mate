import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";
import { EnvironmentId, type MateHealth } from "@t3tools/contracts";
import { MateHealthMessage } from "./MateHealthNotice";
const health: MateHealth = {
  source: { environmentId: EnvironmentId.make("env"), epoch: 1, incarnation: "run", revision: 1 },
  sampledAt: "2026-10-07T12:00:00Z",
  evidence: {
    status: "strained",
    severity: "critical",
    resources: ["memory"],
    memory: {
      current: 1700000000,
      high: 1610612736,
      max: null,
      events: { high: 2, oom: 0, oomKill: 0 },
      growth: { high: 1, oom: 0, oomKill: 0 },
      pressure: null,
      swapCurrent: 536870912,
      swapMax: 536870912,
    },
    cpu: null,
    io: null,
    disk: { free: 1000, total: 2000 },
    unavailable: [],
  },
};
describe("Mate's visible resource warning", () => {
  it.each([true, false])("shows named memory evidence and action, with live=%s", (live) => {
    const text = renderToStaticMarkup(
      <MateHealthMessage
        name="Skákala"
        read={{ health, live, configuredMinimumBytes: 3 * 1024 ** 3 }}
      />,
    ).replaceAll("&#x27;", "'");
    expect(text).toContain("Skákala");
    expect(text).toContain("1.5 GB");
    expect(text).toContain("Close idle terminal agents");
    expect(text.includes("last-known health")).toBe(!live);
    expect(text.includes("hasn't reached the container")).toBe(live);
  });
  it("clears after source recovery and says nothing before a sample", () => {
    for (const value of [
      null,
      { ...health, evidence: { ...health.evidence, status: "ok" as const, resources: [] } },
    ])
      expect(
        renderToStaticMarkup(
          <MateHealthMessage
            name="Skákala"
            read={{ health: value, live: true, configuredMinimumBytes: null }}
          />,
        ),
      ).toBe("");
  });
});
