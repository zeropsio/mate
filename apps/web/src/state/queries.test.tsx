// @vitest-environment happy-dom

import { RegistryContext } from "@effect/atom-react";
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult, Atom, AtomRegistry } from "effect/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  areProjectPathSearchTargetsEqual,
  connectedEnvironmentIds,
  useThreadSearch,
} from "./queries";

const searches = vi.hoisted(() => ({ asked: [] as unknown[] }));

vi.mock("./presentation", async () => {
  const { Atom: Atoms } = await import("effect/reactivity");
  return {
    environmentPresentations: {
      presentationsAtom: Atoms.make(
        new Map([
          ["open-mate", { connection: { phase: "connected" } }],
          ["parked-mate", { connection: { phase: "available" } }],
        ]),
      ),
    },
  };
});

vi.mock("./orchestration", () => ({
  orchestrationEnvironment: {
    threadSearch: ({ environmentId }: { environmentId: unknown }) => {
      searches.asked.push(environmentId);
      return Atom.make(AsyncResult.initial(true));
    },
  },
}));

describe("areProjectPathSearchTargetsEqual", () => {
  const target = {
    environmentId: EnvironmentId.make("environment-a"),
    cwd: "/project-a",
    query: "index",
  };

  it("requires the environment, workspace, query, entry kind, and image filter to match", () => {
    expect(areProjectPathSearchTargetsEqual(target, target)).toBe(true);
    expect(
      areProjectPathSearchTargetsEqual(target, {
        ...target,
        environmentId: EnvironmentId.make("environment-b"),
      }),
    ).toBe(false);
    expect(areProjectPathSearchTargetsEqual(target, { ...target, cwd: "/project-b" })).toBe(false);
    expect(areProjectPathSearchTargetsEqual(target, { ...target, query: "readme" })).toBe(false);
    expect(areProjectPathSearchTargetsEqual(target, { ...target, kind: "file" })).toBe(false);
    expect(areProjectPathSearchTargetsEqual(target, { ...target, imageOnly: true })).toBe(false);
  });
});

describe("connectedEnvironmentIds", () => {
  const OPEN = EnvironmentId.make("open-mate");
  const PARKED = EnvironmentId.make("parked-mate");
  const COMING = EnvironmentId.make("coming-mate");
  const UNKNOWN = EnvironmentId.make("unknown-mate");
  const presentations = new Map([
    [OPEN, { connection: { phase: "connected" as const } }],
    [PARKED, { connection: { phase: "available" as const } }],
    [COMING, { connection: { phase: "connecting" as const } }],
  ]);

  it("searches only connected Mates", () => {
    expect(connectedEnvironmentIds([PARKED, OPEN, COMING, UNKNOWN], presentations)).toEqual([OPEN]);
  });
});

describe("useThreadSearch", () => {
  const mounted: ReactTestRenderer[] = [];

  afterEach(() => {
    for (const renderer of mounted.splice(0)) act(() => renderer.unmount());
    searches.asked = [];
  });

  function Probe({ environmentIds }: { environmentIds: ReadonlyArray<EnvironmentId> }) {
    useThreadSearch(environmentIds, "checkout");
    return null;
  }

  // Every caller may pass every Mate it lists: the hook leaves out those with no socket.
  it("asks only the connected Mates of those it is given", () => {
    const registry = AtomRegistry.make();
    act(() => {
      mounted.push(
        create(
          <RegistryContext.Provider value={registry}>
            <Probe
              environmentIds={[EnvironmentId.make("open-mate"), EnvironmentId.make("parked-mate")]}
            />
          </RegistryContext.Provider>,
        ),
      );
    });

    expect(searches.asked).toEqual(["open-mate"]);
  });
});
