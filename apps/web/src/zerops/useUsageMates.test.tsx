/**
 * Usage draws every Mate of the organization: while it stands it wants each one HQ names connected
 * (`AccountEnvironments.setDrawn`), lets them go when it closes, and says which it could not count.
 */
import { RegistryContext } from "@effect/atom-react";
import type { AccountEnvironments } from "@t3tools/client-runtime/zerops/account/runtime";
import type { Reachability } from "@t3tools/client-runtime/zerops/environments";
import { EnvironmentId } from "@t3tools/contracts";
import type { MateLiveView } from "@t3tools/shared/hqMates";
import { Atom, AtomRegistry } from "effect/unstable/reactivity";
import { act } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("./useZeropsCandidates", () => ({
  candidateListingAtom: Atom.make({ state: "known", value: [] }),
}));

import { zeropsSessionAtom } from "../state/zerops";
import { bindAccountEnvironments } from "./accountEnvironments";
import { usageMates, useUsageMates, type UsageMate } from "./useUsageMates";
import { mountHqNavigation } from "~/zerops/__fixtures__/hqNavigation";

const ENV_JUNO = EnvironmentId.make("env-juno");
const ENV_LENA = EnvironmentId.make("env-lena");
const ENV_FERN = EnvironmentId.make("env-fern");

const live = (environmentId: EnvironmentId | null): MateLiveView => ({
  presence: { online: true, since: "2026-10-04T08:00:00Z", overview: "live" },
  ...(environmentId === null
    ? {}
    : { identity: { environmentId, serverVersion: "0.13.2", update: null } }),
});

const ORG_MATES = new Map<string, MateLiveView>([
  ["p-juno", live(ENV_JUNO)],
  ["p-lena", live(ENV_LENA)],
  ["p-fern", live(ENV_FERN)],
  ["p-old", live(null)],
]);

describe("useUsageMates", () => {
  let renderer: ReactTestRenderer | null = null;
  let unbind: (() => void) | null = null;
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = null;
    unbind?.();
    unbind = null;
  });

  it("wants every Mate HQ names for the organization while mounted, and none once closed", () => {
    const drawn: Array<ReadonlyArray<EnvironmentId>> = [];
    const machines = new Map();
    unbind = bindAccountEnvironments({
      machines: () => machines,
      subscribe: () => () => undefined,
      setDrawn: (environmentIds: ReadonlyArray<EnvironmentId>) => {
        drawn.push(environmentIds);
      },
    } as unknown as AccountEnvironments);
    const registry = AtomRegistry.make();
    registry.set(zeropsSessionAtom, {
      status: "signed-in",
      organizationStatus: "selected",
      activeOrganization: { organizationId: "org-mate" },
    } as never);
    mountHqNavigation(registry, "org-mate", { mates: Object.fromEntries(ORG_MATES) });
    function Probe() {
      useUsageMates(new Set(), true);
      return null;
    }

    act(() => {
      renderer = create(
        <RegistryContext.Provider value={registry}>
          <Probe />
        </RegistryContext.Provider>,
      );
    });
    expect(drawn).toEqual([[ENV_FERN, ENV_JUNO, ENV_LENA]]);

    // HQ's next word on a Mate it already named changes no demand.
    act(() => {
      mountHqNavigation(registry, "org-mate", { mates: Object.fromEntries(ORG_MATES) });
    });
    expect(drawn).toHaveLength(1);

    act(() => renderer?.unmount());
    renderer = null;
    expect(drawn).toEqual([[ENV_FERN, ENV_JUNO, ENV_LENA], []]);
  });
});

describe("usageMates", () => {
  const verdicts = new Map<string, Reachability | null>([
    ["p-juno", { kind: "ready", notice: null }],
    ["p-lena", { kind: "connecting", waitingOn: "exchange" }],
    ["p-fern", { kind: "container", container: { level: "inactive", status: "STOPPED" } }],
  ]);
  const names = new Map([
    ["p-juno", "Juno"],
    ["p-lena", "Lena"],
    ["p-fern", "Fern"],
    ["p-old", "Old"],
  ]);
  const read = (
    listed: boolean,
    missingBefore: ReadonlySet<string> = new Set(),
  ): ReadonlyArray<UsageMate> =>
    usageMates({
      mates: ORG_MATES,
      names,
      connected: new Set([ENV_JUNO]),
      verdictOf: (projectId) => verdicts.get(projectId) ?? null,
      listed,
      missingBefore,
    });

  it("counts a connected Mate, waits on one on its way, and names the ones it cannot count", () => {
    expect(read(true)).toEqual([
      { projectId: "p-fern", name: "Fern", state: "missing" },
      { projectId: "p-juno", name: "Juno", state: "counted" },
      { projectId: "p-lena", name: "Lena", state: "connecting" },
      { projectId: "p-old", name: "Old", state: "missing" },
    ]);
  });

  // A Mate the driver retries reads connecting again on each attempt: once missing, it stays
  // missing until it is counted, so the totals do not drop to the skeleton on every retry.
  it("keeps a Mate it already called missing missing while it retries", () => {
    expect(read(true, new Set(["p-lena"])).find((mate) => mate.projectId === "p-lena")).toEqual({
      projectId: "p-lena",
      name: "Lena",
      state: "missing",
    });
  });
});
