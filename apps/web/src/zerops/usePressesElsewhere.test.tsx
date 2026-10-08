/**
 * B5, two browsers: whether a Mate's press in the other one is still at it is its hold at HQ and
 * its import's own process — drawn anew the moment its hold runs out, never by its project's age.
 */
import { RegistryContext } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqPressValue } from "@t3tools/client-runtime/data";
import { AtomRegistry } from "effect/reactivity";
import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { mountHqNavigation } from "./__fixtures__/hqNavigation";
import { usePressesElsewhere } from "./usePressesElsewhere";

const processes = vi.hoisted(() => ({
  /** Each project's processes, as its activity reads them. */
  of: new Map<string, ReadonlyArray<{ readonly id: string; readonly status: string }>>(),
  /** The projects whose processes were asked for, by the last render. */
  asked: [] as ReadonlyArray<string>,
}));
vi.mock("./activity/useProjectsProcesses", () => ({
  useProjectsProcesses: (projectIds: ReadonlyArray<string>) => {
    processes.asked = projectIds;
    return processes.of;
  },
}));

const NOW = Date.parse("2026-10-05T10:00:00.000Z");
/** A Mate whose project lists no container yet. */
const UNA = { key: "p-una", project: { id: "p-una" }, missingContainer: true } as ZeropsCandidate;

let tree: ReactTestRenderer | undefined;
/**
 * What the hook handed back last, and what each render said of Una: a hold running out is drawn
 * anew, not only read anew.
 */
const probe = { said: (_projectId: string): string => "", drawn: [] as Array<string> };
const said = (projectId: string) => probe.said(projectId);
function Probe() {
  const of = usePressesElsewhere([UNA]);
  useLayoutEffect(() => {
    probe.said = of;
    probe.drawn.push(of("p-una"));
  });
  return null;
}

/** HQ's presses as its navigation says them: each held for `heldForMs` from HQ's read. */
const mount = (presses: Readonly<Record<string, HqPressValue>> | null) => {
  const registry = AtomRegistry.make();
  if (presses !== null)
    mountHqNavigation(registry, "org-1", { structure: { ungrouped: [], apps: [] }, presses });
  act(() => {
    tree = create(
      createElement(RegistryContext.Provider, { value: registry }, createElement(Probe)),
    );
  });
};

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  processes.of = new Map();
  probe.drawn = [];
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("usePressesElsewhere", () => {
  it("reads a slow press as at it while its hold runs, and as stopped the moment it ran out", async () => {
    mount({ "p-una": { kind: "mate", heldForMs: 30_000, until: "2026-10-05T10:00:30.000Z" } });
    expect(said("p-una")).toBe("pressing");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(said("p-una")).toBe("stopped");
    expect(probe.drawn.at(-1)).toBe("stopped");
  });

  it("reads a press whose import failed as stopped at once, though its hold still runs", () => {
    processes.of = new Map([["p-una", [{ id: "imp-1", status: "FAILED" }]]]);
    mount({
      "p-una": {
        kind: "mate",
        heldForMs: 30_000,
        until: "2026-10-05T10:00:30.000Z",
        importProcessId: "imp-1",
      },
    });
    expect(processes.asked).toEqual(["p-una"]);
    expect(said("p-una")).toBe("stopped");
  });

  it("says nothing either way while HQ has said nothing of presses", () => {
    mount(null);
    expect(said("p-una")).toBe("unknown");
  });
});
