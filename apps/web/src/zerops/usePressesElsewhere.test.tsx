/**
 * B5, two browsers: whether a Mate's press in the other one is still at it is its hold at HQ and
 * its import's own process — HQ's word, never its project's age or this browser's clock.
 */
import { RegistryContext } from "@effect/atom-react";
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import type { HqPresses } from "@t3tools/client-runtime/zerops/hq";
import { AtomRegistry } from "effect/unstable/reactivity";
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

const mount = (presses: HqPresses | null) => {
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
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  processes.of = new Map();
  probe.drawn = [];
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("usePressesElsewhere", () => {
  it.each([
    {
      name: "at it while HQ holds its press",
      presses: { "p-una": { kind: "mate" } },
      says: "pressing",
    },
    { name: "stopped once HQ holds no press of it", presses: {}, says: "stopped" },
  ] as const)("reads a slow press as $name", ({ presses, says }) => {
    mount(presses);
    expect(said("p-una")).toBe(says);
    expect(probe.drawn.at(-1)).toBe(says);
  });

  it("reads a press whose import failed as stopped at once, though its hold still runs", () => {
    processes.of = new Map([["p-una", [{ id: "imp-1", status: "FAILED" }]]]);
    mount({ "p-una": { kind: "mate", importProcessId: "imp-1" } });
    expect(processes.asked).toEqual(["p-una"]);
    expect(said("p-una")).toBe("stopped");
  });

  it("says nothing either way while HQ has said nothing of presses", () => {
    mount(null);
    expect(said("p-una")).toBe("unknown");
  });
});
