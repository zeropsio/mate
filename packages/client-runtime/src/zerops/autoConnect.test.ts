import { describe, expect, it } from "vite-plus/test";

import { selectAutoConnectTargets, type AutoConnectCandidate } from "./autoConnect.ts";
import type { ZeropsContainerHealth } from "./provisioning.ts";

function candidate(
  id: string,
  overrides: Partial<AutoConnectCandidate> = {},
): AutoConnectCandidate {
  return {
    key: `${id}:zcp`,
    project: { id, name: id, status: "ACTIVE", clientId: "org-1" },
    group: "ready",
    service: { id: "zcp", name: "zcp", status: "ACTIVE" },
    containerOrigin: `https://zcp-${id}-8080.prg1.zerops.app`,
    ...overrides,
  };
}

function health(entries: ReadonlyArray<readonly [string, ZeropsContainerHealth]>) {
  return new Map(entries.map(([id, verdict]) => [`${id}:zcp`, verdict] as const));
}

describe("selectAutoConnectTargets", () => {
  it("connects a ready container that answered ready and is not registered", () => {
    const targets = selectAutoConnectTargets({
      candidates: [candidate("a")],
      health: health([["a", "ready"]]),
      attempted: new Set(),
    });
    expect(targets.map((target) => target.projectId)).toEqual(["a"]);
    expect(targets[0]?.clientId).toBe("org-1");
  });

  it("waits for the health probe rather than waking a container", () => {
    // A container that has not answered, or answered anything but ready, is
    // left alone: half-installed and sleeping containers are not ours to poke.
    const targets = selectAutoConnectTargets({
      candidates: [candidate("silent"), candidate("old"), candidate("away")],
      health: health([
        ["old", "predates-mate"],
        ["away", "unreachable"],
      ]),
      attempted: new Set(),
    });
    expect(targets).toEqual([]);
  });

  it("skips environments that are registered already, whatever their socket is doing", () => {
    const targets = selectAutoConnectTargets({
      candidates: [
        candidate("live", { group: "connected", environmentId: "env-1" as never }),
        candidate("flaky", {
          connection: { phase: "reconnecting", error: "boom", traceId: null },
        }),
        candidate("fresh"),
      ],
      health: health([
        ["live", "ready"],
        ["flaky", "ready"],
        ["fresh", "ready"],
      ]),
      attempted: new Set(),
    });
    expect(targets.map((target) => target.projectId)).toEqual(["fresh"]);
  });

  it("never retries an origin this session already tried", () => {
    const fresh = candidate("fresh");
    const targets = selectAutoConnectTargets({
      candidates: [fresh],
      health: health([["fresh", "ready"]]),
      attempted: new Set([fresh.containerOrigin!]),
    });
    expect(targets).toEqual([]);
  });

  it("stops at the ceiling, counting what is registered already", () => {
    const targets = selectAutoConnectTargets({
      candidates: [
        candidate("one", { group: "connected", environmentId: "env-1" as never }),
        candidate("two"),
        candidate("three"),
      ],
      health: health([
        ["two", "ready"],
        ["three", "ready"],
      ]),
      attempted: new Set(),
      limit: 2,
    });
    expect(targets.map((target) => target.projectId)).toEqual(["two"]);
  });

  it("targets an origin once even when a project has two containers", () => {
    const targets = selectAutoConnectTargets({
      candidates: [
        candidate("p", { key: "p:zcp" }),
        candidate("p", { key: "p:zcp2", containerOrigin: "https://zcp-p-8080.prg1.zerops.app" }),
      ],
      health: new Map([
        ["p:zcp", "ready"],
        ["p:zcp2", "ready"],
      ]),
      attempted: new Set(),
    });
    expect(targets).toHaveLength(1);
  });
});
