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

describe("selectAutoConnectTargets: auto-connect's WANT (DESIGN §4.4)", () => {
  const rows: ReadonlyArray<{
    readonly name: string;
    readonly candidate: AutoConnectCandidate;
    readonly health?: ZeropsContainerHealth;
    readonly closeOffPending?: boolean;
    readonly wanted: boolean;
  }> = [
    {
      name: "a ready container that answered ready and is not registered",
      candidate: candidate("a"),
      health: "ready",
      wanted: true,
    },
    {
      name: "a container the health probe has not answered for",
      candidate: candidate("a"),
      wanted: false,
    },
    {
      name: "a container that predates Mate",
      candidate: candidate("a"),
      health: "predates-mate",
      wanted: false,
    },
    {
      name: "a container that does not answer",
      candidate: candidate("a"),
      health: "unreachable",
      wanted: false,
    },
    {
      name: "a registered environment, whatever its socket is doing",
      candidate: candidate("a", {
        connection: { phase: "reconnecting", error: "boom", traceId: null },
      }),
      health: "ready",
      wanted: false,
    },
    {
      // Its press stopped before the mark: its container carries the press's marker and its
      // project no `mate:closed-off`. Nobody is let in until Finish setup closes it off.
      name: "a Mate whose press has not closed its project off",
      candidate: candidate("a"),
      health: "ready",
      closeOffPending: true,
      wanted: false,
    },
    {
      name: "a container with no address",
      candidate: (({ containerOrigin: _origin, ...noAddress }) => noAddress)(candidate("a")),
      health: "ready",
      wanted: false,
    },
  ];

  it.each(rows.map((row) => [row.name, row] as const))("%s", (_name, row) => {
    const targets = selectAutoConnectTargets({
      candidates: [row.candidate],
      health: health(row.health === undefined ? [] : [["a", row.health]]),
      closeOffPendingProjectIds: new Set(row.closeOffPending === true ? ["a"] : []),
    });
    expect(targets).toEqual(row.wanted ? ["a:zcp"] : []);
  });

  it("keeps wanting a target it selected, however its exchange went", () => {
    // Attempts are the target machine's to remember: a failed exchange backs off and retries,
    // a refused one waits for an input change. The selection itself never shrinks on its own.
    const input = {
      candidates: [candidate("fresh")],
      health: health([["fresh", "ready"]]),
    };
    expect(selectAutoConnectTargets(input)).toEqual(["fresh:zcp"]);
    expect(selectAutoConnectTargets(input)).toEqual(["fresh:zcp"]);
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
      limit: 2,
    });
    expect(targets).toEqual(["two:zcp"]);
  });

  // The ceiling is for Mates not on screen: the one whose page is open is wanted past it (a live
  // run, 2026-10-01: a browser with 21 registered stayed on "coming up" for an hour).
  it("wants the Mate on screen past the ceiling, and first", () => {
    const targets = selectAutoConnectTargets({
      candidates: [
        candidate("one", { group: "connected", environmentId: "env-1" as never }),
        candidate("two"),
        candidate("shown"),
      ],
      health: health([
        ["two", "ready"],
        ["shown", "ready"],
      ]),
      limit: 1,
      onScreenProjectId: "shown",
    });
    expect(targets).toEqual(["shown:zcp"]);
  });

  it("the Mate on screen still waits for its health and its close-off", () => {
    for (const [shownHealth, pending] of [
      [undefined, false],
      ["initializing", false],
      ["ready", true],
    ] as const) {
      const targets = selectAutoConnectTargets({
        candidates: [candidate("shown")],
        health: health(shownHealth === undefined ? [] : [["shown", shownHealth]]),
        closeOffPendingProjectIds: new Set(pending ? ["shown"] : []),
        limit: 0,
        onScreenProjectId: "shown",
      });
      expect(targets).toEqual([]);
    }
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
    });
    expect(targets).toEqual(["p:zcp"]);
  });
});
