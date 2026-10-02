import { describe, expect, it } from "vite-plus/test";

import {
  closeOffGate,
  zcpYoung,
  directMarkerOf,
  MARKER_RETRY_MS,
  markerRetryDelay,
  selectAutoConnectTargets,
  ZEROPS_AUTO_CONNECT_LIMIT,
  type AutoConnectCandidate,
} from "./autoConnect.ts";
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

  // Every row in the menu says what its Mate is doing without a click (the owner, 2026-10-02: a new
  // Mate past the twelfth sat asleep and empty until clicked — "that's stupid"). A kept session
  // makes a reconnect cost no mint, so the ceiling is only a bound no account comes near.
  it("connects every ready Mate the roster lists, far past a dozen", () => {
    const ids = Array.from({ length: 30 }, (_, index) => `m${index}`);
    const targets = selectAutoConnectTargets({
      candidates: ids.map((id) => candidate(id)),
      health: health(ids.map((id) => [id, "ready"] as const)),
    });
    expect(targets).toHaveLength(30);
    expect(ZEROPS_AUTO_CONNECT_LIMIT).toBeGreaterThanOrEqual(48);
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

// The gate on a Mate its press may have left open fails closed: only a marker read absent — an
// older Mate's — lets it connect without its project's mark (pass 28 review).
describe("closeOffGate — whether a Mate not marked closed off may be connected", () => {
  it.each([
    { marker: true, direct: undefined, young: false, want: "hold" },
    { marker: true, direct: undefined, young: true, want: "hold" },
    { marker: false, direct: undefined, young: true, want: "connect" },
    // A young container's marker not known yet holds it; it fails closed.
    { marker: "unread", direct: undefined, young: true, want: "hold" },
    { marker: "unknown", direct: undefined, young: true, want: "read-env" },
    { marker: "unknown", direct: "reading", young: true, want: "hold" },
    { marker: "unknown", direct: true, young: true, want: "hold" },
    { marker: "unknown", direct: "failed", young: true, want: "hold" },
    { marker: "unknown", direct: false, young: true, want: "connect" },
    // An older Mate is never held for its marker, whatever its stream says (pass 28 review).
    { marker: "unread", direct: undefined, young: false, want: "connect" },
    { marker: "unknown", direct: undefined, young: false, want: "connect" },
    { marker: "unknown", direct: "failed", young: false, want: "connect" },
  ] as const)(
    "$marker, read directly $direct, young $young: $want",
    ({ marker, direct, young, want }) => {
      expect(closeOffGate(marker, direct, young)).toBe(want);
    },
  );
});

describe("zcpYoung — a container a press may still be setting up", () => {
  const NOW = Date.parse("2026-09-23T10:00:00Z");
  it.each([
    { created: "2026-09-23T09:59:00Z", want: true },
    { created: "2026-09-23T08:01:00Z", want: true },
    { created: "2026-09-23T07:59:00Z", want: false },
    { created: undefined, want: false },
  ])("made $created: $want", ({ created, want }) => {
    expect(zcpYoung(created, NOW)).toBe(want);
  });
});

// The service's own variables, read once where the stream could not say: a viewer who may not read
// them is no reason to hold an older Mate for good (pass 28 review).
describe("directMarkerOf — the service's own variable names, as the gate reads them", () => {
  const known = (names: ReadonlyArray<string>) =>
    ({
      state: "known",
      value: names,
      asOf: { ordinal: 1, atMs: 0 },
      coverage: "complete",
      freshness: { kind: "settled" },
    }) as never;
  const failed = (failure: object) =>
    ({ state: "failed", failure, atMs: 0, attempt: 1, retryAtMs: null }) as never;
  it.each([
    {
      case: "the marker among them",
      shown: known(["MATE_SETUP_RUNTIMES", "ZCP_API_KEY"]),
      want: true,
    },
    { case: "no marker", shown: known(["ZCP_MATE_ENABLED"]), want: false },
    {
      case: "a 403: the viewer may not read them",
      shown: failed({ kind: "refused", code: "permission", words: "No." }),
      want: false,
    },
    {
      case: "a read that failed",
      shown: failed({ kind: "transport", detail: "down" }),
      want: "failed",
    },
  ])("$case: $want", ({ shown, want }) => {
    expect(directMarkerOf(shown)).toBe(want);
  });
});

describe("markerRetryDelay — a failed check, asked again later and later", () => {
  it("waits 30 s, then 2 min, then 10 min, and 10 min from then on", () => {
    expect([1, 2, 3, 4, 9].map(markerRetryDelay)).toEqual([
      30_000, 120_000, 600_000, 600_000, 600_000,
    ]);
    expect(MARKER_RETRY_MS).toEqual([30_000, 120_000, 600_000]);
  });
});
