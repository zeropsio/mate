/**
 * A page listing Mates demands each one's project inventory while it draws it: access is verified
 * and services read only for a demanded project, so a Mate nothing demands never shows its
 * container — no Restart, and no environment to add beside it.
 */
import type { ZeropsCandidate } from "@t3tools/client-runtime/zerops/candidates";
import {
  ZeropsAccountId,
  ZeropsOrganizationId,
  ZeropsProjectId,
  makeZeropsApiOrigin,
  projectKeyOf,
  type ProjectRef,
  type RuntimeInterestDescriptor,
  type ScopeAuthority,
} from "@t3tools/client-runtime/zerops/data";
import { RegistryContext } from "@effect/atom-react";
import { accountReadsAtom } from "@t3tools/client-runtime/data";
import * as Effect from "effect/Effect";
import { AtomRegistry } from "effect/unstable/reactivity";
import { act, createElement, useLayoutEffect } from "react";
import { create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { Inventory } from "./inventoryContext";
import { drawnMateProjects, useDrawnMates, useMatesInventory } from "./useMatesInventory";

const organization = {
  kind: "organization" as const,
  account: {
    apiOrigin: makeZeropsApiOrigin("https://api.example.test"),
    accountId: ZeropsAccountId.make("account"),
  },
  organizationId: ZeropsOrganizationId.make("org-1"),
};
const ref = (projectId: string): ProjectRef => ({
  kind: "project",
  organization,
  projectId: ZeropsProjectId.make(projectId),
});

const runtime = vi.hoisted(() => ({
  /** The projects whose inventory is held now. */
  held: [] as Array<string>,
  /** Every lease taken, in order. */
  acquired: [] as Array<string>,
  inventory: null as unknown,
}));
vi.mock("./zeropsDataContext", () => {
  // The account's runtime: one object for the account's life, as the real one is.
  const data = {
    runtime: {
      acquire: (descriptor: RuntimeInterestDescriptor) => {
        if (descriptor.kind !== "project-inventory") throw new Error(descriptor.kind);
        const { projectId } = descriptor.project;
        return Effect.acquireRelease(
          Effect.sync(() => {
            runtime.held.push(projectId);
            runtime.acquired.push(projectId);
          }),
          () =>
            Effect.sync(() => {
              runtime.held.splice(runtime.held.indexOf(projectId), 1);
            }),
        );
      },
    },
  };
  return { useZeropsData: () => data };
});
vi.mock("./inventoryContext", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useZeropsInventory: () => runtime.inventory,
}));

/** Ada, a Mate HQ places in an application; Bo, its production; Cy, a Mate HQ holds in none. */
const ADA = {
  project: { id: "p-ada", hq: { appId: "app-1", appName: "Shop", kind: "mate", mate: null } },
} as unknown as ZeropsCandidate;
const BO = {
  project: { id: "p-bo", hq: { appId: "app-1", appName: "Shop", kind: "production", mate: null } },
} as unknown as ZeropsCandidate;
const CY = {
  project: { id: "p-cy", hq: { appId: null, appName: null, kind: "mate", mate: {} } },
} as unknown as ZeropsCandidate;

const inventoryOf = (authority: ReadonlyMap<string, ScopeAuthority> = new Map()) =>
  ({
    projectRefs: new Map(["p-ada", "p-bo", "p-cy"].map((id) => [projectKeyOf(ref(id)), ref(id)])),
    authority: new Map([...authority].map(([id, value]) => [projectKeyOf(ref(id)), value])),
    account: { kind: "authorized" },
  }) as unknown as Inventory;

function Probe({ candidates }: { readonly candidates: ReadonlyArray<ZeropsCandidate> }) {
  useMatesInventory(drawnMateProjects(candidates));
  return null;
}

/** A surface whose rows say they are drawn, as the left menu's do. */
const rows: { drawn: (projectId: string) => () => () => void } = {
  drawn: () => () => () => {},
};
function RowsProbe() {
  const drawn = useDrawnMates();
  useLayoutEffect(() => {
    rows.drawn = drawn;
  });
  return null;
}

let tree: ReactTestRenderer | undefined;
const render = async (candidates: ReadonlyArray<ZeropsCandidate>) => {
  await act(async () => {
    if (tree === undefined) tree = create(createElement(Probe, { candidates }));
    else tree.update(createElement(Probe, { candidates }));
  });
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  runtime.held = [];
  runtime.acquired = [];
  runtime.inventory = inventoryOf();
});
afterEach(async () => {
  await act(async () => tree?.unmount());
  tree = undefined;
  vi.unstubAllGlobals();
});

describe("drawnMateProjects", () => {
  it("names each project HQ places a Mate in, and no other", () => {
    expect(drawnMateProjects([ADA, BO, CY, ADA])).toEqual(["p-ada", "p-cy"]);
  });
});

describe("useMatesInventory", () => {
  it("holds each drawn Mate's project inventory while the page draws it", async () => {
    await render([ADA, BO, CY]);
    expect(runtime.held.toSorted()).toEqual(["p-ada", "p-cy"]);

    await render([BO, CY]);
    expect(runtime.held).toEqual(["p-cy"]);

    await act(async () => tree?.unmount());
    tree = undefined;
    expect(runtime.held).toEqual([]);
  });

  // A row drawn or let go moves only its own project: the others keep their leases, and nothing
  // is read again for them.
  it("takes only the newly drawn Mate's lease and lets go only the one no longer drawn", async () => {
    await render([ADA]);
    await render([ADA, CY]);
    await render([CY]);
    expect(runtime.acquired).toEqual(["p-ada", "p-cy"]);
    expect(runtime.held).toEqual(["p-cy"]);
  });

  it("asks nothing again of a Mate whose project the platform refused, and still of one being verified", async () => {
    runtime.inventory = inventoryOf(
      new Map<string, ScopeAuthority>([
        ["p-ada", { kind: "withheld", reason: "access-denied", cause: null }],
        ["p-cy", { kind: "withheld", reason: "access-unverified", cause: null }],
      ]),
    );
    await render([ADA, CY]);
    expect(runtime.held).toEqual(["p-cy"]);
  });
});

describe("a drawn Mate's own project row", () => {
  // Whose a Mate is — its project's OWNER grant — comes only with the project's own row: it is
  // read while the Mate is drawn, and let go with it.
  it("is held while the Mate is drawn, for Mates only", async () => {
    const registry = AtomRegistry.make();
    const rowsHeld: string[] = [];
    /** Every hold taken, in order: a Mate still drawn is never held again. */
    const holds: string[] = [];
    registry.set(accountReadsAtom, {
      data: {} as never,
      orgId: "org-1",
      demandDetail: (demand) => {
        const key = `${demand.family}/${demand.listing}/${demand.ownerId}`;
        rowsHeld.push(key);
        holds.push(key);
        return () => rowsHeld.splice(rowsHeld.indexOf(key), 1);
      },
      renewHeld: () => {},
    });
    const probe = (candidates: ReadonlyArray<ZeropsCandidate>) =>
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement(Probe, { candidates }),
      );
    await act(async () => {
      tree = create(probe([ADA, BO, CY]));
    });
    expect(rowsHeld.toSorted()).toEqual(["project/project/p-ada", "project/project/p-cy"]);

    await act(async () => tree?.update(probe([CY])));
    expect(rowsHeld).toEqual(["project/project/p-cy"]);
    expect(holds).toHaveLength(2);

    await act(async () => tree?.unmount());
    tree = undefined;
    expect(rowsHeld).toEqual([]);
  });
});

describe("useDrawnMates", () => {
  it("reads a Mate's project while any row of it is drawn, and lets it go with the last", async () => {
    await act(async () => {
      tree = create(createElement(RowsProbe));
    });
    const drawnOnce = rows.drawn("p-ada");
    expect(rows.drawn("p-ada")).toBe(drawnOnce);
    let first: () => void = () => {};
    let second: () => void = () => {};
    await act(async () => {
      first = drawnOnce();
      second = rows.drawn("p-ada")();
    });
    expect(runtime.held).toEqual(["p-ada"]);

    await act(async () => first());
    expect(runtime.held).toEqual(["p-ada"]);
    await act(async () => second());
    expect(runtime.held).toEqual([]);
  });

  it("reads none while no row is drawn", async () => {
    await act(async () => {
      tree = create(createElement(RowsProbe));
    });
    expect(runtime.held).toEqual([]);
  });
});
